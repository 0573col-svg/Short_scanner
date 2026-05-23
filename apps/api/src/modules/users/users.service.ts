import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Mode, Thresholds, Weights } from '@short-scanner/shared-types';
import { CryptoService } from '../../common/crypto.service';
import { DEFAULT_USER_ID } from '../../common/single-user';
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
} from '../scoring/scoring.constants';
import { UserEntity } from './user.entity';
import { TelegramConfigEntity } from './telegram-config.entity';

export interface DecryptedTelegramConfig {
  token: string;
  chatId: string;
  nearAlertsEnabled: boolean;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(TelegramConfigEntity)
    private readonly tgConfigs: Repository<TelegramConfigEntity>,
    private readonly crypto: CryptoService,
  ) {}

  /** En modo single-user, asegurar que el row default exista al boot. */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.ensureDefaultUser();
    } catch (err) {
      this.logger.warn(`ensureDefaultUser failed (puede ser que la BD aún no esté lista): ${err}`);
    }
  }

  async ensureDefaultUser(): Promise<UserEntity> {
    let user = await this.users.findOne({ where: { id: DEFAULT_USER_ID } });
    if (!user) {
      user = await this.users.save(
        this.users.create({
          id: DEFAULT_USER_ID,
          email: 'default@local',
          mode: 'STRICT',
          thresholds: DEFAULT_THRESHOLDS,
          weights: DEFAULT_WEIGHTS,
        }),
      );
      this.logger.log(`default user creado: ${user.id}`);
    }
    return user;
  }

  async getById(userId: string): Promise<UserEntity> {
    const u = await this.users.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException(`user ${userId} no encontrado`);
    return u;
  }

  async getWeights(userId: string): Promise<Weights> {
    return (await this.getById(userId)).weights;
  }

  async updateWeights(userId: string, weights: Weights): Promise<void> {
    await this.users.update(userId, { weights });
  }

  async updateSettings(
    userId: string,
    patch: { mode?: Mode; thresholds?: Partial<Thresholds> },
  ): Promise<UserEntity> {
    const u = await this.getById(userId);
    if (patch.mode) u.mode = patch.mode;
    if (patch.thresholds) u.thresholds = { ...u.thresholds, ...patch.thresholds };
    return this.users.save(u);
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
