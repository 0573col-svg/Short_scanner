import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import type { Mode, Thresholds, Weights } from '@short-scanner/shared-types';
import { CryptoService } from '../../common/crypto.service';
import { DEFAULT_USER_ID } from '../../common/single-user';
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
} from '../scoring/scoring.constants';
import { UserEntity } from './user.entity';
import { TelegramConfigEntity } from './telegram-config.entity';
import { TrackedTokenEntity } from '../tracking/tracked-token.entity';

export interface DecryptedTelegramConfig {
  token: string;
  chatId: string;
  nearAlertsEnabled: boolean;
}

/** TTL del cache in-memory de UserEntity. Invalidación explícita en updates. */
const USER_CACHE_TTL_MS = 5_000;

interface CachedUser {
  user: UserEntity;
  expiresAt: number;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  private readonly userCache = new Map<string, CachedUser>();

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(TelegramConfigEntity)
    private readonly tgConfigs: Repository<TelegramConfigEntity>,
    private readonly crypto: CryptoService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.ensureDefaultUser();
    } catch (err) {
      this.logger.warn(`ensureDefaultUser failed (puede ser que la BD aún no esté lista): ${err}`);
    }
  }

  /**
   * Asegura el DEFAULT_USER legacy. Este user NO tiene passwordHash, no
   * participa del scanner loop (se excluye en listAll) y solo existe para
   * que el flujo `claim-default` pueda mover sus datos heredados.
   */
  async ensureDefaultUser(): Promise<UserEntity> {
    let user = await this.users.findOne({ where: { id: DEFAULT_USER_ID } });
    if (!user) {
      user = await this.users.save(
        this.users.create({
          id: DEFAULT_USER_ID,
          email: 'default@local',
          passwordHash: null,
          mode: 'STRICT',
          thresholds: DEFAULT_THRESHOLDS,
          weights: DEFAULT_WEIGHTS,
        }),
      );
      this.logger.log(`default user creado: ${user.id}`);
    }
    return user;
  }

  /** Cache hit-and-miss simple para reducir SELECTs por request. */
  async getById(userId: string): Promise<UserEntity> {
    const now = Date.now();
    const cached = this.userCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.user;
    const u = await this.users.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException(`user ${userId} no encontrado`);
    this.userCache.set(userId, { user: u, expiresAt: now + USER_CACHE_TTL_MS });
    return u;
  }

  private invalidateCache(userId: string): void {
    this.userCache.delete(userId);
  }

  /**
   * Lista usuarios REALES (con passwordHash). Excluye el DEFAULT_USER legacy
   * y futuros usuarios "imported-only" sin auth. El scanner solo scorea estos.
   */
  async listAll(): Promise<UserEntity[]> {
    return this.users.find({ where: { passwordHash: Not(IsNull()) } });
  }

  /** Primer user creado (passwordHash NOT NULL, ORDER BY createdAt ASC). */
  private async findFirstRealUser(): Promise<UserEntity | null> {
    const rows = await this.users.find({
      where: { passwordHash: Not(IsNull()) },
      order: { createdAt: 'ASC' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  /**
   * Reasigna datos del DEFAULT_USER_ID al targetUserId.
   * Solo el PRIMER usuario real puede ejecutarlo. Idempotente (si ya está
   * vacío, devuelve counts=0).
   *
   * Merge de tracked_tokens: si el target ya tiene un row para el mismo
   * symbol, se fusionan en lugar de duplicar (high-water marks + suma de
   * contadores + firstDetectedAt más antiguo). El del default se borra.
   */
  async claimDefaultUserData(targetUserId: string): Promise<{
    trades: number;
    trackedTokens: { moved: number; merged: number };
    telegramReassigned: boolean;
  }> {
    if (targetUserId === DEFAULT_USER_ID) {
      throw new ForbiddenException('No se puede reasignar el default a sí mismo');
    }
    const firstReal = await this.findFirstRealUser();
    if (!firstReal || firstReal.id !== targetUserId) {
      throw new ForbiddenException(
        'Solo el primer usuario registrado puede reclamar los datos legacy',
      );
    }

    return this.users.manager.transaction(async (mgr) => {
      // ── Trades: simple UPDATE, sin constraint conflict ──
      const tradesRes = await mgr.query(
        `UPDATE trades SET "userId" = $1 WHERE "userId" = $2`,
        [targetUserId, DEFAULT_USER_ID],
      );
      const trades = tradesRes[1] ?? 0;

      // ── Tracked tokens: merge symbol-by-symbol ──
      const trackedRepo = mgr.getRepository(TrackedTokenEntity);
      const defaultTracked = await trackedRepo.find({ where: { userId: DEFAULT_USER_ID } });
      let moved = 0;
      let merged = 0;
      for (const src of defaultTracked) {
        const existing = await trackedRepo.findOne({
          where: { userId: targetUserId, symbol: src.symbol },
        });
        if (!existing) {
          // No conflicto → simple reassign
          await trackedRepo.update(src.id, { userId: targetUserId });
          moved++;
        } else {
          // Merge: high-water marks + sumar contadores + firstDetectedAt más antiguo
          Object.assign(existing, {
            firstDetectedAt:
              src.firstDetectedAt < existing.firstDetectedAt
                ? src.firstDetectedAt
                : existing.firstDetectedAt,
            lastSeenPumpingAt:
              src.lastSeenPumpingAt > existing.lastSeenPumpingAt
                ? src.lastSeenPumpingAt
                : existing.lastSeenPumpingAt,
            peakScore: Math.max(existing.peakScore, src.peakScore),
            peakRsi: Math.max(existing.peakRsi, src.peakRsi),
            peakChange24h: Math.max(existing.peakChange24h, src.peakChange24h),
            peakPrice: Math.max(existing.peakPrice, src.peakPrice),
            peakAt:
              src.peakScore > existing.peakScore ? src.peakAt : existing.peakAt,
            scansActive: existing.scansActive + src.scansActive,
            reappearances: existing.reappearances + src.reappearances,
            daysActive: Math.max(existing.daysActive, src.daysActive),
          });
          await trackedRepo.save(existing);
          await trackedRepo.delete(src.id);
          merged++;
        }
      }

      // ── Telegram: mover solo si target no tiene ──
      const targetHasTg = await mgr.query(
        `SELECT 1 FROM telegram_configs WHERE "userId" = $1`,
        [targetUserId],
      );
      let telegramReassigned = false;
      if (targetHasTg.length === 0) {
        const tgRes = await mgr.query(
          `UPDATE telegram_configs SET "userId" = $1 WHERE "userId" = $2`,
          [targetUserId, DEFAULT_USER_ID],
        );
        telegramReassigned = (tgRes[1] ?? 0) > 0;
      }

      // ── Weights/mode/thresholds: copiar si target sigue con defaults ──
      const defaultUser = await mgr.findOne(UserEntity, { where: { id: DEFAULT_USER_ID } });
      const targetUser = await mgr.findOne(UserEntity, { where: { id: targetUserId } });
      if (defaultUser && targetUser) {
        const targetIsPristine =
          JSON.stringify(targetUser.weights) === JSON.stringify(DEFAULT_WEIGHTS);
        if (targetIsPristine) {
          targetUser.weights = defaultUser.weights;
          targetUser.mode = defaultUser.mode;
          targetUser.thresholds = defaultUser.thresholds;
          await mgr.save(targetUser);
          this.invalidateCache(targetUserId);
        }
      }

      this.logger.log(
        `claim-default: target=${targetUserId} trades=${trades} tracked.moved=${moved} tracked.merged=${merged} tg=${telegramReassigned}`,
      );
      return {
        trades,
        trackedTokens: { moved, merged },
        telegramReassigned,
      };
    });
  }

  async getWeights(userId: string): Promise<Weights> {
    return (await this.getById(userId)).weights;
  }

  async updateWeights(userId: string, weights: Weights): Promise<void> {
    await this.users.update(userId, { weights });
    this.invalidateCache(userId);
  }

  async updateSettings(
    userId: string,
    patch: { mode?: Mode; thresholds?: Partial<Thresholds> },
  ): Promise<UserEntity> {
    const u = await this.users.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException(`user ${userId} no encontrado`);
    if (patch.mode) u.mode = patch.mode;
    if (patch.thresholds) u.thresholds = { ...u.thresholds, ...patch.thresholds };
    const saved = await this.users.save(u);
    this.invalidateCache(userId);
    return saved;
  }

  async getDecryptedTelegram(userId: string): Promise<DecryptedTelegramConfig | null> {
    const cfg = await this.tgConfigs.findOne({ where: { userId } });
    if (!cfg) return null;
    return {
      token: this.crypto.decrypt(cfg.token),
      chatId: cfg.chatId,
      nearAlertsEnabled: cfg.nearAlertsEnabled,
    };
  }

  async setTelegram(
    userId: string,
    plain: { token: string; chatId: string; nearAlertsEnabled?: boolean },
  ): Promise<void> {
    const encrypted = this.crypto.encrypt(plain.token);
    await this.tgConfigs.upsert(
      {
        userId,
        token: encrypted,
        chatId: plain.chatId,
        nearAlertsEnabled: plain.nearAlertsEnabled ?? false,
      },
      ['userId'],
    );
  }

  async deleteTelegram(userId: string): Promise<void> {
    await this.tgConfigs.delete({ userId });
  }
}
