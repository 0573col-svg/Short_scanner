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
import { DEFAULT_USER_ID } from '../../common/single-user';

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
    // Saltarse el scan inicial en test para no pegarle a Binance ni dejar handles abiertos
    if (process.env.NODE_ENV === 'test') return;
    // Primer scan al boot para no esperar 2 min en blanco
    void this.runScan().catch((err) => this.logger.error('initial scan failed', err));
  }

  @Cron(SCAN_CRON, { name: 'scanner-tick' })
  async cronTick(): Promise<void> {
    await this.runScan();
  }

  async runScan(): Promise<void> {
    if (this.state.get().running) {
      this.logger.debug('scan already in progress, skipping');
      return;
    }
    this.state.setRunning(true);
    this.gateway.emitTick({ secondsToNext: 0, status: 'scanning' });
    const started = Date.now();
    let scoredCount = 0;

    try {
      const tickers = await this.binance.fetchAll24hr();

      // BTC trend
      const btcRow = tickers.find((t) => t.symbol === 'BTCUSDT');
      if (btcRow) {
        const change = parseFloat(btcRow.priceChangePercent);
        this.state.setBtc({ change, falling: change <= -2 });
      }

      const { thresholds, mode, btc } = this.state.get();
      // Lee los pesos recalibrados del User (LearningService los actualiza al cerrar trades).
      // Si la BD aún no está lista, cae al default in-memory.
      let weights = this.state.getWeights();
      try {
        weights = (await this.users.getById(DEFAULT_USER_ID)).weights;
      } catch (err) {
        this.logger.debug(`User.weights no disponible, usando defaults: ${err}`);
      }

      // Filtro: USDT pair, no-stable, vol mínimo, símbolo válido
      const candidates = tickers
        .filter((t) => {
          if (!t.symbol.endsWith('USDT')) return false;
          const base = t.symbol.slice(0, -4);
          if (STABLE_BASES.has(base)) return false;
          if (!SYM_RE.test(base)) return false;
          if (parseFloat(t.quoteVolume) < thresholds.minVolUsd) return false;
          return true;
        })
        .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
        .slice(0, thresholds.topN);

      // Enriquecer con klines + funding rate en lotes
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

      // Score
      const scored: ScoredToken[] = enriched.map((snapshot) =>
        this.scoring.score({
          snapshot,
          weights,
          mode,
          pumpThreshold: thresholds.pumpPct,
          btc,
        }),
      );

      // Ordenar igual que el v22: score desc, passedCount desc, change desc
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.passedCount !== a.passedCount) return b.passedCount - a.passedCount;
        return b.snapshot.change - a.snapshot.change;
      });

      const nextAt = Date.now() + this.intervalMs;
      const newAlerts = this.state.applyScanResults(scored, nextAt);
      scoredCount = scored.length;

      // Reconciliar el estado persistente de tracking (Sprint 2).
      // No bloqueamos el scan si esto falla — la BD podría estar caída.
      try {
        await this.tracking.reconcile(DEFAULT_USER_ID, scored);
      } catch (err) {
        this.logger.error('tracking reconcile failed (continuing scan)', err);
      }

      this.gateway.emitScanUpdate({ ranAt: Date.now(), results: scored, newAlerts });
      for (const alert of newAlerts) {
        this.gateway.emitAlert(alert);
        // Encolar para Telegram (el processor decide si mandar según config del user)
        void this.alerts.dispatch(DEFAULT_USER_ID, alert);
      }

      const ms = Date.now() - started;
      const fails = this.binance.drainFailures();
      const klinesOk = scoredCount - fails.klines;
      const summary = `scan done in ${ms}ms · ${scoredCount} tokens · klines ${klinesOk}/${scoredCount} · funding fails ${fails.funding} · ${newAlerts.length} new alerts · BTC ${btc.change.toFixed(2)}%`;
      // Si más del 20% de klines fallaron, levantar a warn
      if (scoredCount > 0 && fails.klines / scoredCount > 0.2) this.logger.warn(summary);
      else this.logger.log(summary);
    } catch (err) {
      this.logger.error('scan failed', err);
      this.gateway.emitTick({
        secondsToNext: 0,
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      // Drenar SIEMPRE el contador para que un scan a medias no contamine al siguiente.
      // (En el happy path ya se drenó arriba — el segundo drain devuelve 0,0.)
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
}
