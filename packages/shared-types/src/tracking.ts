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
}
