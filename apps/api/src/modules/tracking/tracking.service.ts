import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Not, Repository } from 'typeorm';
import type {
  ScoredToken,
  TrackedStatus,
  TrackedTokenView,
} from '@short-scanner/shared-types';
import { TrackedTokenEntity } from './tracked-token.entity';

/** Tras N horas en DORMANT sin reaparecer → ARCHIVED. */
const DORMANT_TTL_HOURS = 24;

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @InjectRepository(TrackedTokenEntity)
    private readonly repo: Repository<TrackedTokenEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Reconcilia el resultado de un scan contra el estado persistente.
   * Llamado al final de cada ciclo de scan por ScannerService.
   *
   * Comportamiento:
   *  1. Tokens nuevos en el scan → crear como ACTIVE
   *  2. Tokens existentes en el scan → actualizar high-water marks, contadores
   *     y status (DORMANT → ACTIVE si reapareció)
   *  3. Tokens ACTIVE que no aparecieron → DORMANT
   *  4. Tokens DORMANT > DORMANT_TTL_HOURS → ARCHIVED
   *
   * SHORTED/CLOSED no se tocan automáticamente — los maneja el flujo de Trades.
   */
  async reconcile(userId: string, scanResults: ScoredToken[]): Promise<{
    upserts: number;
    activated: number;
    dormanted: number;
    archived: number;
  }> {
    const now = new Date();
    const detectedSymbols = new Set(scanResults.map((s) => s.snapshot.symbol));
    let upserts = 0;
    let activated = 0;
    let dormanted = 0;
    let archived = 0;

    await this.dataSource.transaction(async (mgr) => {
      const repo = mgr.getRepository(TrackedTokenEntity);

      // 1) + 2) Crear o actualizar tokens detectados en este scan
      for (const r of scanResults) {
        const existing = await repo.findOne({
          where: { userId, symbol: r.snapshot.symbol, status: Not(In(['ARCHIVED', 'CLOSED'])) },
        });

        if (!existing) {
          await repo.save(
            repo.create({
              userId,
              symbol: r.snapshot.symbol,
              base: r.snapshot.base,
              status: 'ACTIVE',
              firstDetectedAt: now,
              lastSeenPumpingAt: now,
              firstDetectionSnapshot: r.snapshot as unknown as Record<string, unknown>,
              peakScore: r.score,
              peakRsi: r.snapshot.rsi ?? 0,
              peakChange24h: r.snapshot.change,
              peakPrice: r.snapshot.price,
              peakAt: now,
              currentScore: r.score,
              currentVerdict: r.verdict,
              currentGrades: r.grades as unknown as Record<string, unknown>,
              daysActive: 1,
              scansActive: 1,
              reappearances: 0,
              tradeId: null,
              archivedAt: null,
            }),
          );
          upserts++;
        } else {
          const wasDormant = existing.status === 'DORMANT';
          const reactivate = wasDormant;
          const peakRsiNew = Math.max(existing.peakRsi, r.snapshot.rsi ?? 0);
          const peakScoreNew = Math.max(existing.peakScore, r.score);
          const peakChange = Math.max(existing.peakChange24h, r.snapshot.change);
          const peakPrice = Math.max(existing.peakPrice, r.snapshot.price);
          // Recompute peakAt si cualquier high-water mark se actualizó
          const peakChanged =
            peakScoreNew > existing.peakScore ||
            peakRsiNew > existing.peakRsi ||
            peakChange > existing.peakChange24h ||
            peakPrice > existing.peakPrice;

          // No tocar SHORTED — el ciclo de vida lo gobiernan los Trades
          const nextStatus: TrackedStatus =
            existing.status === 'SHORTED' ? 'SHORTED' : 'ACTIVE';

          // Update directo a la entity (save preserva tipos jsonb sin pelearse
          // con _QueryDeepPartialEntity de TypeORM)
          Object.assign(existing, {
            lastSeenPumpingAt: now,
            status: nextStatus,
            peakScore: peakScoreNew,
            peakRsi: peakRsiNew,
            peakChange24h: peakChange,
            peakPrice: peakPrice,
            peakAt: peakChanged ? now : existing.peakAt,
            currentScore: r.score,
            currentVerdict: r.verdict,
            currentGrades: r.grades as unknown as Record<string, unknown>,
            daysActive: daysSinceUtc(existing.firstDetectedAt, now),
            scansActive: existing.scansActive + 1,
            reappearances: reactivate ? existing.reappearances + 1 : existing.reappearances,
          });
          await repo.save(existing);
          upserts++;
          if (reactivate) activated++;
        }
      }

      // 3) ACTIVE que NO aparecieron en este scan → DORMANT
      // (No tocar los recién creados/actualizados arriba — pero como ya están
      // marcados ACTIVE con lastSeenPumpingAt=now, los excluimos por symbol.)
      const previouslyActive = await repo.find({
        where: { userId, status: 'ACTIVE' },
      });
      for (const t of previouslyActive) {
        if (!detectedSymbols.has(t.symbol)) {
          await repo.update(t.id, { status: 'DORMANT' });
          dormanted++;
        }
      }

      // 4) DORMANT viejos → ARCHIVED
      const ttlCutoff = new Date(now.getTime() - DORMANT_TTL_HOURS * 3600 * 1000);
      const stale = await repo.find({
        where: { userId, status: 'DORMANT', lastSeenPumpingAt: LessThan(ttlCutoff) },
      });
      for (const t of stale) {
        await repo.update(t.id, { status: 'ARCHIVED', archivedAt: now });
        archived++;
      }
    });

    if (upserts || activated || dormanted || archived) {
      this.logger.log(
        `tracking reconcile · upserts=${upserts} reactivated=${activated} dormanted=${dormanted} archived=${archived}`,
      );
    }
    return { upserts, activated, dormanted, archived };
  }

  async listByStatus(userId: string, statuses: TrackedStatus[]): Promise<TrackedTokenView[]> {
    const rows = await this.repo.find({
      where: { userId, status: In(statuses) },
      order: { peakScore: 'DESC', lastSeenPumpingAt: 'DESC' },
    });
    return rows.map(toView);
  }

  async getById(userId: string, id: string): Promise<TrackedTokenView> {
    const row = await this.repo.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException(`tracked token ${id} no encontrado`);
    return toView(row);
  }

  async markShorted(userId: string, id: string, tradeId: string): Promise<TrackedTokenView> {
    const row = await this.repo.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException(`tracked token ${id} no encontrado`);
    await this.repo.update(id, { status: 'SHORTED', tradeId });
    return this.getById(userId, id);
  }

  async markClosed(userId: string, id: string): Promise<void> {
    await this.repo.update({ id, userId }, { status: 'CLOSED' });
  }

  async deleteOne(userId: string, id: string): Promise<void> {
    const row = await this.repo.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException(`tracked token ${id} no encontrado`);
    await this.repo.remove(row);
  }
}

function toView(t: TrackedTokenEntity): TrackedTokenView {
  return {
    id: t.id,
    symbol: t.symbol,
    base: t.base,
    status: t.status,
    firstDetectedAt: t.firstDetectedAt.toISOString(),
    lastSeenPumpingAt: t.lastSeenPumpingAt.toISOString(),
    archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
    peakScore: t.peakScore,
    peakRsi: t.peakRsi,
    peakChange24h: t.peakChange24h,
    peakPrice: t.peakPrice,
    peakAt: t.peakAt.toISOString(),
    daysActive: t.daysActive,
    scansActive: t.scansActive,
    reappearances: t.reappearances,
    currentScore: t.currentScore,
    currentVerdict: t.currentVerdict,
    currentGrades: t.currentGrades,
    tradeId: t.tradeId,
  };
}

function daysSinceUtc(start: Date, now: Date): number {
  const startUtc = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  );
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((nowUtc - startUtc) / (24 * 3600 * 1000)) + 1; // día 1 desde el inicio
}
