export type TrackedStatus = 'ACTIVE' | 'DORMANT' | 'SHORTED' | 'CLOSED' | 'ARCHIVED';

export interface TrackedTokenView {
  id: string;
  symbol: string;
  base: string;
  status: TrackedStatus;
  firstDetectedAt: string;
  lastSeenPumpingAt: string;
  archivedAt: string | null;
  peakScore: number;
  peakRsi: number;
  peakChange24h: number;
  peakPrice: number;
  peakAt: string;
  daysActive: number;
  scansActive: number;
  reappearances: number;
  /** Score actual del último scan en que apareció (solo si ACTIVE) */
  currentScore: number | null;
  /** Verdict actual */
  currentVerdict: string | null;
  /**
   * Grades del último scan — usado por LearningService al cerrar el trade.
   * Estructura `Grades` (ver scoring.ts) pero serializada como JSON neutral.
   */
  currentGrades: Record<string, unknown> | null;
  /** ID del Trade SHORT vinculado (si status=SHORTED o CLOSED) */
  tradeId: string | null;

  // ── Matured-verdict tracking (Fase 4 — schema base) ─────
  // Las columnas existen en BD pero la lógica que las puebla llega en Fase 5.

  /** True si el grade RSI llegó a passed=true en algún scan del período. */
  rsiEverPassed: boolean;
  /** Timestamp del primer scan donde RSI passed=true (ISO 8601). */
  rsiPassedAt: string | null;
  fundingEverPassed: boolean;
  fundingPassedAt: string | null;
  divergenceEverPassed: boolean;
  divergencePassedAt: string | null;
  redCandlesEverPassed: boolean;
  redCandlesPassedAt: string | null;

  /** Veredicto "maduro": 'GO_SHORT' o null. Separado del verdict instantáneo. */
  maturedVerdict: string | null;
  /** Timestamp de la primera maduración (ISO 8601). */
  maturedAt: string | null;
  /** Timestamp del envío de la alerta MADURA — dedup persistente. */
  maturedAlertedAt: string | null;

  /** Precio del último scan (no high-water; valor instantáneo). */
  currentPrice: number | null;
  /** Milisegundos activos acumulados — reloj pausado durante DORMANT. */
  activeMs: number;
}
