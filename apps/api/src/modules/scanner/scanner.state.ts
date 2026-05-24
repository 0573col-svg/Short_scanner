import { Injectable } from '@nestjs/common';
import type {
  BtcTrend,
  Mode,
  ScanAlert,
  ScanState,
  ScoredToken,
  Thresholds,
  TokenSnapshot,
} from '@short-scanner/shared-types';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '../scoring/scoring.constants';

/**
 * Estado in-memory del scanner.
 *
 * Layout (Sprint 4 — multi-user):
 *   GLOBAL (shared)         per-user (Map<userId, ...>)
 *   ───────────────         ───────────────────────────
 *   enrichedSnapshot[]      lastResults: ScoredToken[]
 *   btc, ranAt, nextAt      alertedSet: Set<string>
 *   running
 *
 * El enrich (fetch klines + funding) es compartido — se hace UNA vez por scan.
 * El score, dedup, alertas y reconcile son per-user (cada user tiene sus weights).
 */
interface PerUserState {
  results: ScoredToken[];
  alertedSet: Set<string>;
}

@Injectable()
export class ScannerStateStore {
  // ── Global ───────────────────────────────────────────
  private btc: BtcTrend = { change: 0, falling: false };
  private ranAt = 0;
  private nextAt = 0;
  private running = false;
  /** Snapshot enriquecido sin scorear (compartido) — base para re-score per-user */
  private enriched: TokenSnapshot[] = [];

  // ── Por usuario ──────────────────────────────────────
  private perUser = new Map<string, PerUserState>();

  // ── Cache de mode/thresholds del último scan que se ejecutó por user ─
  // (Para que GET /scans/current devuelva un ScanState legible incluso si
  // el user no ha cambiado settings — usa los del User entity como source of truth)

  /** Estado mínimo compartido — usado por healthcheck y el cron */
  getGlobal(): {
    ranAt: number;
    nextAt: number;
    running: boolean;
    btc: BtcTrend;
    enriched: TokenSnapshot[];
  } {
    return {
      ranAt: this.ranAt,
      nextAt: this.nextAt,
      running: this.running,
      btc: this.btc,
      enriched: this.enriched,
    };
  }

  /** Para HealthService — solo necesita ranAt */
  get(): { ranAt: number } {
    return { ranAt: this.ranAt };
  }

  /**
   * Devuelve el ScanState completo para un usuario específico.
   * Compone: shared (btc, ranAt) + per-user (results) + del User entity (mode, thresholds).
   */
  getForUser(userId: string, mode: Mode, thresholds: Thresholds): ScanState {
    const u = this.perUser.get(userId);
    return {
      ranAt: this.ranAt,
      nextAt: this.nextAt,
      running: this.running,
      btc: this.btc,
      mode,
      thresholds,
      results: u?.results ?? [],
    };
  }

  setRunning(running: boolean): void {
    this.running = running;
  }

  setBtc(btc: BtcTrend): void {
    this.btc = btc;
  }

  /** Llamado tras el enrich shared. Reemplaza el snapshot enriquecido. */
  setEnriched(snapshot: TokenSnapshot[]): void {
    this.enriched = snapshot;
  }

  /**
   * Aplica los resultados scoreados para UN usuario. Devuelve las alertas
   * nuevas (verdict GO_SHORT/CERCA que no se hayan reportado en este 4h-block).
   */
  applyUserResults(userId: string, results: ScoredToken[], nextAt: number): ScanAlert[] {
    const now = Date.now();
    this.ranAt = now;
    this.nextAt = nextAt;

    const state = this.perUser.get(userId) ?? { results: [], alertedSet: new Set<string>() };
    state.results = results;
    this.perUser.set(userId, state);

    const currentBlock = block4h(now);

    // Cleanup del alertedSet si crece demasiado (anclado al final del ID)
    if (state.alertedSet.size > 500) {
      const filtered = new Set<string>();
      state.alertedSet.forEach((id) => {
        const m = /_(\d+)$/.exec(id);
        if (!m) return;
        const block = parseInt(m[1]!, 10);
        if (Number.isFinite(block) && currentBlock - block <= 2) filtered.add(id);
      });
      state.alertedSet = filtered;
    }

    const newAlerts: ScanAlert[] = [];
    for (const r of results) {
      const prefix = r.verdict === 'GO_SHORT' ? 'GO' : r.verdict === 'CERCA' ? 'NR' : null;
      if (!prefix) continue;
      const id = `${prefix}_${r.snapshot.base}_${currentBlock}`;
      if (!state.alertedSet.has(id)) {
        state.alertedSet.add(id);
        newAlerts.push(toAlert(r, now));
      }
    }
    return newAlerts;
  }

  /** Helper de testing */
  _debugSeedAlerts(userId: string, ids: string[]): void {
    const state = this.perUser.get(userId) ?? { results: [], alertedSet: new Set<string>() };
    for (const id of ids) state.alertedSet.add(id);
    this.perUser.set(userId, state);
  }

  _debugGetAlerts(userId: string): Set<string> {
    return new Set(this.perUser.get(userId)?.alertedSet ?? []);
  }

  /** Cuando un usuario se borra (delete account) — liberar memoria */
  forgetUser(userId: string): void {
    this.perUser.delete(userId);
  }

  /** Backward-compat para tests / endpoints legacy que usaban defaults */
  getWeights() {
    return { ...DEFAULT_WEIGHTS };
  }

  getThresholds() {
    return { ...DEFAULT_THRESHOLDS };
  }
}

function toAlert(r: ScoredToken, ts: number): ScanAlert {
  return {
    symbol: r.snapshot.symbol,
    base: r.snapshot.base,
    verdict: r.verdict,
    score: r.score,
    change: r.snapshot.change,
    rsi: r.snapshot.rsi,
    ts,
  };
}

function block4h(ms: number): number {
  return Math.floor(ms / (4 * 3600 * 1000));
}
