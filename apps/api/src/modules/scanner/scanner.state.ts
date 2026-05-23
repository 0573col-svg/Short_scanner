import { Injectable } from '@nestjs/common';
import type {
  BtcTrend,
  Mode,
  ScanAlert,
  ScanState,
  ScoredToken,
  Thresholds,
} from '@short-scanner/shared-types';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '../scoring/scoring.constants';

/**
 * Estado in-memory del scanner. Single-user, no persistencia (Fase 1).
 * Reemplazable por un repositorio cuando entren los entities de Fase 2.
 */
@Injectable()
export class ScannerStateStore {
  private state: ScanState = {
    ranAt: 0,
    nextAt: 0,
    running: false,
    btc: { change: 0, falling: false },
    thresholds: { ...DEFAULT_THRESHOLDS },
    mode: 'STRICT',
    results: [],
  };

  private alertedSet = new Set<string>();
  private weights = { ...DEFAULT_WEIGHTS };

  get(): ScanState {
    return this.state;
  }

  getWeights() {
    return this.weights;
  }

  setRunning(running: boolean): void {
    this.state = { ...this.state, running };
  }

  setBtc(btc: BtcTrend): void {
    this.state = { ...this.state, btc };
  }

  setMode(mode: Mode): void {
    this.state = { ...this.state, mode };
  }

  setThresholds(thresholds: Partial<Thresholds>): void {
    this.state = { ...this.state, thresholds: { ...this.state.thresholds, ...thresholds } };
  }

  /**
   * Aplica los resultados de un ciclo. Devuelve las alertas NUEVAS
   * (verdict GO_SHORT/CERCA que no se hayan reportado en este 4h-block).
   */
  applyScanResults(results: ScoredToken[], nextAt: number): ScanAlert[] {
    const ranAt = Date.now();
    this.state = { ...this.state, results, ranAt, nextAt };

    const currentBlock = block4h(ranAt);

    // Limpiar entradas viejas si el set crece demasiado.
    // El ID tiene prefijo de verdict ("GO"/"NR") y termina en `${base}_${block}`,
    // pero el split sería frágil — mejor extraer el block con regex anclado al final.
    if (this.alertedSet.size > 500) {
      const filtered = new Set<string>();
      this.alertedSet.forEach((id) => {
        const m = /_(\d+)$/.exec(id);
        if (!m) return;
        const block = parseInt(m[1]!, 10);
        if (Number.isFinite(block) && currentBlock - block <= 2) filtered.add(id);
      });
      this.alertedSet = filtered;
    }

    const newAlerts: ScanAlert[] = [];
    for (const r of results) {
      const prefix = r.verdict === 'GO_SHORT' ? 'GO' : r.verdict === 'CERCA' ? 'NR' : null;
      if (!prefix) continue;
      const id = `${prefix}_${r.snapshot.base}_${currentBlock}`;
      if (!this.alertedSet.has(id)) {
        this.alertedSet.add(id);
        newAlerts.push(toAlert(r, ranAt));
      }
    }
    return newAlerts;
  }

  /** Helper de testing: insertar ids para verificar el cleanup. */
  _debugSeedAlerts(ids: string[]): void {
    for (const id of ids) this.alertedSet.add(id);
  }

  /** Helper de testing: leer ids actuales. */
  _debugGetAlerts(): Set<string> {
    return new Set(this.alertedSet);
  }
}

function block4h(ms: number): number {
  return Math.floor(ms / (4 * 3600 * 1000));
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
