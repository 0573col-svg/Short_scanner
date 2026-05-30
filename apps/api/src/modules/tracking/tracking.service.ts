import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import type {
  MaturedAlert,
  Mode,
  ScoredToken,
  TrackedStatus,
  TrackedTokenView,
} from '@short-scanner/shared-types';
import { TrackedTokenEntity } from './tracked-token.entity';
import {
  applyMaturedVerdict,
  incrementActiveMs,
  shouldExpireByWindow,
  updateEverFlags,
} from './maturity';
import { AlertDispatcher } from '../alerts/alert-dispatcher.service';

/** Tras N horas en DORMANT sin reaparecer → ARCHIVED. */
const DORMANT_TTL_HOURS = 24;

/** Filtro mínimo de pump para que un token NUEVO entre al tracking (Fase 4). */
const TRACKING_ENTRY_MIN_CHANGE_PCT = 50;

/**
 * Intervalo del cron de scan, hardcoded para evitar acoplar tracking ↔
 * scanner config. Si el cron del scanner cambia, este valor debe seguirlo.
 * Vale 120000 ms — coincide con `*​/2 * * * *` en scanner.service.ts.
 */
const SCAN_INTERVAL_MS = 120_000;

/**
 * Máximo delta entre scans consecutivos para que se considere "continuo"
 * y se sume al activeMs. Sobre ese delta, el token estuvo DORMANT y el
 * reloj queda pausado. 1.5× del intervalo cubre 1 scan faltante ocasional.
 */
const CONTINUITY_THRESHOLD_MS = SCAN_INTERVAL_MS * 1.5;

/**
 * Ratio de precio respecto al peak para considerar que el activo "sigue
 * cerca del pico" — uno de los gates del verdict maduro.
 */
const PRICE_NEAR_PEAK_RATIO = 0.8;

/**
 * Window default (96h en ms) para la maduración. Override via env
 * MATURED_WINDOW_MS — útil para QA con valores chicos (ej. 300000 = 5min).
 */
const MATURED_WINDOW_MS_DEFAULT = 96 * 3600 * 1000;

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @InjectRepository(TrackedTokenEntity)
    private readonly repo: Repository<TrackedTokenEntity>,
    private readonly dataSource: DataSource,
    private readonly cfg: ConfigService,
    private readonly dispatcher: AlertDispatcher,
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
  async reconcile(userId: string, scanResults: ScoredToken[], mode: Mode = 'STRICT', btcChange: number = 0): Promise<{
    upserts: number;
    activated: number;
    dormanted: number;
    archived: number;
    windowExpired: number;
    maturedDispatched: number;
  }> {
    const now = new Date();
    const maturedWindowMs = this.cfg.get<number>('MATURED_WINDOW_MS', MATURED_WINDOW_MS_DEFAULT);
    const detectedSymbols = new Set(scanResults.map((s) => s.snapshot.symbol));
    let upserts = 0;
    let activated = 0;
    let dormanted = 0;
    let archived = 0;
    let windowExpired = 0;
    // Acumulamos las maturedAlerts a dispatchar DESPUÉS de cerrar la
    // transacción de BD. Setear maturedAlertedAt es dentro de la tx para
    // garantizar idempotencia; el dispatch real va fuera para evitar
    // rollback de toda la reconcile si Redis cae.
    const pendingMaturedDispatches: MaturedAlert[] = [];

    await this.dataSource.transaction(async (mgr) => {
      const repo = mgr.getRepository(TrackedTokenEntity);

      // 1) + 2) Crear o actualizar tokens detectados en este scan
      for (const r of scanResults) {
        const existing = await repo.findOne({
          where: { userId, symbol: r.snapshot.symbol, status: Not(In(['ARCHIVED', 'CLOSED'])) },
        });

        // Filtro de entrada (Fase 4): tokens nuevos solo se persisten si
        // change24h >= 50%. Existentes siguen actualizándose hasta morir por
        // DORMANT TTL — no los desalojamos retroactivamente.
        if (!existing && r.snapshot.change < TRACKING_ENTRY_MIN_CHANGE_PCT) {
          continue;
        }

        if (!existing) {
          // Tokens nuevos: si alguno de los 4 grades passed=true en este
          // primer scan, se setea el Ever-flag desde el principio.
          const fresh = repo.create({
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
            currentPrice: r.snapshot.price,
            daysActive: 1,
            scansActive: 1,
            reappearances: 0,
            tradeId: null,
            archivedAt: null,
            // ── Matured-verdict (Fase 5) ──────────────────────
            rsiEverPassed: false,
            rsiPassedAt: null,
            fundingEverPassed: false,
            fundingPassedAt: null,
            divergenceEverPassed: false,
            divergencePassedAt: null,
            redCandlesEverPassed: false,
            redCandlesPassedAt: null,
            maturedVerdict: null,
            maturedAt: null,
            maturedAlertedAt: null,
            activeMs: 0,
          });
          // Aplicar Ever-flags si alguno passed en el primer scan.
          // No corremos incrementActiveMs (no hay lastSeenPumpingAt previo
          // real — recién acaba de ser creado). No corremos applyMaturedVerdict
          // (activeMs=0, casi imposible que las 4 condiciones estén true en
          // el primer scan; en el peor caso se prende en el próximo scan).
          updateEverFlags(fresh, r.grades, now);
          await repo.save(fresh);
          upserts++;
        } else {
          const wasDormant = existing.status === 'DORMANT';
          const reactivate = wasDormant;
          const peakRsiNew = Math.max(existing.peakRsi, r.snapshot.rsi ?? 0);
          const peakScoreNew = Math.max(existing.peakScore, r.score);
          const peakChange = Math.max(existing.peakChange24h, r.snapshot.change);
          const peakPriceNew = Math.max(existing.peakPrice, r.snapshot.price);
          // Recompute peakAt si cualquier high-water mark se actualizó
          const peakChanged =
            peakScoreNew > existing.peakScore ||
            peakRsiNew > existing.peakRsi ||
            peakChange > existing.peakChange24h ||
            peakPriceNew > existing.peakPrice;

          // No tocar SHORTED — el ciclo de vida lo gobiernan los Trades
          const nextStatus: TrackedStatus =
            existing.status === 'SHORTED' ? 'SHORTED' : 'ACTIVE';

          // ── Matured-verdict (Fase 5) ──────────────────────────────
          // Orden importante:
          //  1. incrementActiveMs ANTES de actualizar lastSeenPumpingAt
          //     (necesita el delta contra el VALOR VIEJO).
          //  2. updateEverFlags lee grades.passed actuales.
          //  3. Pre-setear peakPrice nuevo para que applyMaturedVerdict
          //     compare currentPrice contra el peak correcto.
          //  4. applyMaturedVerdict — solo dispara la transición null→GO_SHORT
          //     una vez (idempotente si ya maturedVerdict !== null).
          incrementActiveMs(existing, now, CONTINUITY_THRESHOLD_MS);
          updateEverFlags(existing, r.grades, now);
          existing.peakPrice = peakPriceNew;
          const wasNotMatured = existing.maturedVerdict === null;
          applyMaturedVerdict(
            existing,
            r.snapshot.price,
            now,
            maturedWindowMs,
            PRICE_NEAR_PEAK_RATIO,
          );

          // ── Detectar transición null → 'GO_SHORT' (Fase 6) ─────────
          // Solo dispatchamos en la transición exacta. maturedAlertedAt
          // se setea acá DENTRO de la tx — dedup persistente garantizado
          // aunque el dispatch a Redis falle luego (queda perdido pero
          // no se duplica).
          if (
            wasNotMatured &&
            existing.maturedVerdict === 'GO_SHORT' &&
            existing.maturedAlertedAt === null
          ) {
            existing.maturedAlertedAt = now;
            pendingMaturedDispatches.push(buildMaturedAlert(existing, r, mode, now, btcChange));
          }

          // Update directo a la entity (save preserva tipos jsonb sin pelearse
          // con _QueryDeepPartialEntity de TypeORM)
          Object.assign(existing, {
            lastSeenPumpingAt: now,
            status: nextStatus,
            peakScore: peakScoreNew,
            peakRsi: peakRsiNew,
            peakChange24h: peakChange,
            peakPrice: peakPriceNew,
            peakAt: peakChanged ? now : existing.peakAt,
            currentScore: r.score,
            currentVerdict: r.verdict,
            currentGrades: r.grades as unknown as Record<string, unknown>,
            currentPrice: r.snapshot.price,
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

      // 4) Window expirado (Fase 5): tokens cuyo activeMs superó el window
      // sin haber madurado → ARCHIVED. Tokens con maturedAt!=null están
      // exentos (siguen vivos hasta DORMANT TTL natural).
      const windowExpiredRows = await repo.find({
        where: {
          userId,
          status: In(['ACTIVE', 'DORMANT']),
          activeMs: MoreThan(maturedWindowMs),
          maturedAt: IsNull(),
        },
      });
      for (const t of windowExpiredRows) {
        // Doble check defensivo: shouldExpireByWindow encapsula la regla
        // y mantiene la lógica probada por unit test consistente con el caller.
        if (shouldExpireByWindow(t, maturedWindowMs)) {
          await repo.update(t.id, { status: 'ARCHIVED', archivedAt: now });
          windowExpired++;
        }
      }

      // 5) DORMANT viejos → ARCHIVED
      const ttlCutoff = new Date(now.getTime() - DORMANT_TTL_HOURS * 3600 * 1000);
      const stale = await repo.find({
        where: { userId, status: 'DORMANT', lastSeenPumpingAt: LessThan(ttlCutoff) },
      });
      for (const t of stale) {
        await repo.update(t.id, { status: 'ARCHIVED', archivedAt: now });
        archived++;
      }
    });

    // ── Dispatch MADURO FUERA de la transacción (Fase 6) ───────────
    // maturedAlertedAt ya fue persistido dentro de la tx (idempotente).
    // Si dispatchMatured tira (Redis caído), la alerta se pierde pero NO
    // se duplica en el próximo scan — el row ya tiene maturedAlertedAt != null.
    for (const matured of pendingMaturedDispatches) {
      try {
        await this.dispatcher.dispatchMatured(userId, matured);
      } catch (err) {
        this.logger.error(
          `dispatchMatured failed for ${matured.base} (user=${userId}); alert lost, dedup persistirá`,
          err,
        );
      }
    }
    const maturedDispatched = pendingMaturedDispatches.length;

    if (upserts || activated || dormanted || archived || windowExpired || maturedDispatched) {
      this.logger.log(
        `tracking reconcile · upserts=${upserts} reactivated=${activated} dormanted=${dormanted} archived=${archived} windowExpired=${windowExpired} maturedDispatched=${maturedDispatched}`,
      );
    }
    return { upserts, activated, dormanted, archived, windowExpired, maturedDispatched };
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
    rsiEverPassed: t.rsiEverPassed,
    rsiPassedAt: t.rsiPassedAt ? t.rsiPassedAt.toISOString() : null,
    fundingEverPassed: t.fundingEverPassed,
    fundingPassedAt: t.fundingPassedAt ? t.fundingPassedAt.toISOString() : null,
    divergenceEverPassed: t.divergenceEverPassed,
    divergencePassedAt: t.divergencePassedAt ? t.divergencePassedAt.toISOString() : null,
    redCandlesEverPassed: t.redCandlesEverPassed,
    redCandlesPassedAt: t.redCandlesPassedAt ? t.redCandlesPassedAt.toISOString() : null,
    maturedVerdict: t.maturedVerdict,
    maturedAt: t.maturedAt ? t.maturedAt.toISOString() : null,
    maturedAlertedAt: t.maturedAlertedAt ? t.maturedAlertedAt.toISOString() : null,
    currentPrice: t.currentPrice,
    activeMs: t.activeMs,
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

/**
 * Construye un `MaturedAlert` desde la entity recién mutada + el ScoredToken
 * del scan actual. Asume que los 4 PassedAt están seteados (precondición
 * verificada por el caller: detectó la transición a 'GO_SHORT', que exige
 * las 4 Ever-flags en true).
 */
function buildMaturedAlert(
  row: TrackedTokenEntity,
  scored: ScoredToken,
  mode: Mode,
  now: Date,
  btcChange: number,
): MaturedAlert {
  return {
    symbol: row.symbol,
    base: row.base,
    ts: now.getTime(),
    mode,
    price: scored.snapshot.price,
    peakPrice: row.peakPrice,
    vol: scored.snapshot.vol,
    rsi: scored.snapshot.rsi,
    fundingRate: scored.snapshot.fundingRate,
    redCount: scored.snapshot.redCount,
    btcChange,
    everPassedAt: {
      rsi: row.rsiPassedAt?.getTime() ?? 0,
      funding: row.fundingPassedAt?.getTime() ?? 0,
      divergence: row.divergencePassedAt?.getTime() ?? 0,
      redCandles: row.redCandlesPassedAt?.getTime() ?? 0,
    },
    firstDetectedAt: row.firstDetectedAt.getTime(),
    activeMs: row.activeMs,
  };
}
