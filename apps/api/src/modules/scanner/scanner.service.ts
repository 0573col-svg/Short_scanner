import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { ScoredToken, TokenSnapshot } from '@short-scanner/shared-types';
import { BinanceService } from '../binance/binance.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { ScoringService } from '../scoring/scoring.service';
import { STABLE_BASES } from '../scoring/scoring.constants';
import { ScannerStateStore } from './scanner.state';
import { ScansGateway } from './scans.gateway';
import { TrackingService } from '../tracking/tracking.service';
import { AlertDispatcher } from '../alerts/alert-dispatcher.service';
import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/user.entity';

const SYM_RE = /^[A-Z0-9]{2,15}$/;
const SCAN_CRON = '*/2 * * * *';

@Injectable()
export class ScannerService implements OnModuleInit {
  private readonly logger = new Logger(ScannerService.name);
  private readonly intervalMs: number;

  constructor(
    private readonly binance: BinanceService,
    private readonly indicators: IndicatorsService,
    private readonly scoring: ScoringService,
    private readonly state: ScannerStateStore,
    private readonly gateway: ScansGateway,
    private readonly tracking: TrackingService,
    private readonly alerts: AlertDispatcher,
    private readonly users: UsersService,
    cfg: ConfigService,
  ) {
    // Cron */2 * * * * → 120s
    this.intervalMs = cfg.get<number>('SCAN_INTERVAL_MS', 120_000);
  }

  async onModuleInit(): Promise<void> {
    // Saltarse el scan inicial en test
    if (process.env.NODE_ENV === 'test') return;
    void this.runScan().catch((err) => this.logger.error('initial scan failed', err));
  }

  @Cron(SCAN_CRON, { name: 'scanner-tick' })
  async cronTick(): Promise<void> {
    await this.runScan();
  }

  /**
   * Multi-user scan loop:
   *  1. Fetch shared: tickers + BTC trend
   *  2. Cargar TODOS los usuarios
   *  3. Determinar el universo COMÚN de candidates (más permisivo entre todos):
   *     - vol mínimo = MIN(thresholds.minVolUsd) entre users
   *     - topN     = MAX(thresholds.topN) entre users
   *  4. Enriquecer ese universo UNA SOLA VEZ (shared)
   *  5. Por cada user: re-score con SUS weights/mode/pumpPct, reconcile tracking,
   *     dispatch alerts, emit WS update a su room
   *
   * Garantía: 1 fetch Binance compartido sin importar cuántos users.
   */
  async runScan(): Promise<void> {
    if (this.state.getGlobal().running) {
      this.logger.debug('scan already in progress, skipping');
      return;
    }
    this.state.setRunning(true);
    this.gateway.emitTick({ secondsToNext: 0, status: 'scanning' });
    const started = Date.now();
    let enrichedCount = 0;
    let userCount = 0;
    let totalAlerts = 0;

    try {
      const tickers = await this.binance.fetchAll24hr();

      // BTC trend (shared)
      const btcRow = tickers.find((t) => t.symbol === 'BTCUSDT');
      if (btcRow) {
        const change = parseFloat(btcRow.priceChangePercent);
        this.state.setBtc({ change, falling: change <= -2 });
      }
      const btc = this.state.getGlobal().btc;

      // Cargar users activos
      const allUsers = await this.users.listAll();
      userCount = allUsers.length;
      if (allUsers.length === 0) {
        this.logger.warn('no users registered; scan completes without per-user scoring');
        return;
      }

      // Universo común — más permisivo
      const minVol = Math.min(...allUsers.map((u) => u.thresholds.minVolUsd));
      const maxTopN = Math.max(...allUsers.map((u) => u.thresholds.topN));

      const candidates = tickers
        .filter((t) => {
          if (!t.symbol.endsWith('USDT')) return false;
          const base = t.symbol.slice(0, -4);
          if (STABLE_BASES.has(base)) return false;
          if (!SYM_RE.test(base)) return false;
          if (parseFloat(t.quoteVolume) < minVol) return false;
          return true;
        })
        .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
        .slice(0, maxTopN);

      // Enriquecimiento shared
      const enriched = await this.binance.batchedMap(candidates, async (t): Promise<TokenSnapshot> => {
        const base = t.symbol.slice(0, -4);
        const [klines, fr] = await Promise.all([
          this.binance.fetchKlines(t.symbol, '4h', 50),
          this.binance.fetchFundingRate(t.symbol),
        ]);
        return {
          symbol: t.symbol,
          base,
          price: parseFloat(t.lastPrice),
          change: parseFloat(t.priceChangePercent),
          vol: parseFloat(t.quoteVolume),
          fundingRate: fr,
          rsi: this.indicators.rsi(klines, 14),
          divergence: this.indicators.bearishDivergence(klines, 30),
          candleColors: this.indicators.candleColors(klines, 5),
          redCount: this.indicators.countLastRedCandles(klines),
          ts: Date.now(),
        };
      });
      enrichedCount = enriched.length;
      this.state.setEnriched(enriched);

      const nextAt = Date.now() + this.intervalMs;

      // Por cada user: score + reconcile + alertar
      for (const user of allUsers) {
        const userAlerts = await this.processUser(user, enriched, btc, nextAt);
        totalAlerts += userAlerts;
      }

      const ms = Date.now() - started;
      const fails = this.binance.drainFailures();
      const klinesOk = enrichedCount - fails.klines;
      const summary = `scan done in ${ms}ms · ${enrichedCount} tokens · klines ${klinesOk}/${enrichedCount} · funding fails ${fails.funding} · ${userCount} users · ${totalAlerts} new alerts · BTC ${btc.change.toFixed(2)}%`;
      if (enrichedCount > 0 && fails.klines / enrichedCount > 0.2) this.logger.warn(summary);
      else this.logger.log(summary);
    } catch (err) {
      this.logger.error('scan failed', err);
      this.gateway.emitTick({
        secondsToNext: 0,
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      const leftover = this.binance.drainFailures();
      if (leftover.klines || leftover.funding) {
        this.logger.warn(
          `scan partial · descarted residual failures: klines=${leftover.klines} funding=${leftover.funding}`,
        );
      }
      this.state.setRunning(false);
      this.gateway.emitTick({
        secondsToNext: Math.max(0, Math.round(this.intervalMs / 1000)),
        status: 'idle',
      });
    }
  }

  /**
   * Procesa el resultado del enrich para UN usuario:
   *  - score con SUS weights/mode/pumpPct
   *  - reconcile tracking (per-user)
   *  - dispatch alerts Telegram (per-user)
   *  - emit WS update a su room
   */
  private async processUser(
    user: UserEntity,
    enriched: TokenSnapshot[],
    btc: { change: number; falling: boolean },
    nextAt: number,
  ): Promise<number> {
    const scored: ScoredToken[] = enriched.map((snapshot) =>
      this.scoring.score({
        snapshot,
        weights: user.weights,
        mode: user.mode,
        pumpThreshold: user.thresholds.pumpPct,
        btc,
      }),
    );

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.passedCount !== a.passedCount) return b.passedCount - a.passedCount;
      return b.snapshot.change - a.snapshot.change;
    });

    const newAlerts = this.state.applyUserResults(user.id, scored, nextAt, user.mode, btc.change);

    try {
      await this.tracking.reconcile(user.id, scored);
    } catch (err) {
      this.logger.error(`tracking reconcile failed for user ${user.id} (continuing)`, err);
    }

    this.gateway.emitScanUpdateForUser(user.id, {
      ranAt: Date.now(),
      results: scored,
      newAlerts,
    });

    for (const alert of newAlerts) {
      this.gateway.emitAlertForUser(user.id, alert);
      void this.alerts.dispatch(user.id, alert);
    }

    return newAlerts.length;
  }

  /**
   * Score on-demand para UN usuario usando el ÚLTIMO enriched snapshot que ya
   * está cacheado en memoria. NO toca Binance ni emite alertas — solo puebla
   * `state.perUser[userId].results` para que la UI tenga algo que mostrar
   * inmediatamente al conectarse, sin esperar al próximo cron.
   *
   * Útil cuando un user nuevo se loguea, o se reconecta tras estar offline.
   * Devuelve true si pudo scorear, false si no había snapshot cacheado.
   */
  async scoreUserFromCache(userId: string): Promise<boolean> {
    const global = this.state.getGlobal();
    if (global.enriched.length === 0) {
      // No hay snapshot — el primer scan aún no terminó
      return false;
    }
    const user = await this.users.getById(userId);
    const scored: ScoredToken[] = global.enriched.map((snapshot) =>
      this.scoring.score({
        snapshot,
        weights: user.weights,
        mode: user.mode,
        pumpThreshold: user.thresholds.pumpPct,
        btc: global.btc,
      }),
    );
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.passedCount !== a.passedCount) return b.passedCount - a.passedCount;
      return b.snapshot.change - a.snapshot.change;
    });
    // No genera alertas — el dedup ya fue aplicado en el scan original
    this.state.applyUserResults(userId, scored, global.nextAt, user.mode, global.btc.change);
    return true;
  }
}
