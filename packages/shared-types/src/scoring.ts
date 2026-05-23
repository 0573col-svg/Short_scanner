export type Mode = 'STRICT' | 'FLEX';

export type Verdict = 'GO_SHORT' | 'CERCA' | 'VIGILAR' | 'BTC_DOWN' | 'NONE';

export type GradeState = 'ok' | 'near' | 'fail';

export type CandleColor = 'red' | 'green' | 'neutral';

export interface Thresholds {
  /** Mínimo % de pump en 24h para considerar el token (default 80) */
  pumpPct: number;
  /** Cuántos top-gainers analizar (default 30) */
  topN: number;
  /** Volumen mínimo USD para considerar el par (default 1e6) */
  minVolUsd: number;
}

export interface Weights {
  pump: number;
  funding: number;
  rsi: number;
  divergence: number;
  redCandles: number;
  btcOk: number;
  liquidity: number;
  /** Pesos opcionales para señales de tracking (Fase 2) */
  daysActive?: number;
  scansActive?: number;
  macroDivergence?: number;
  reappearances?: number;
}

export interface DivergenceResult {
  found: boolean;
  /** 0–1; >=0.5 cuenta como passed */
  strength: number;
  p1?: number;
  p2?: number;
  r1?: number;
  r2?: number;
  rsiDrop?: number;
  priceRise?: number;
  debug?: string;
}

export interface TokenSnapshot {
  symbol: string;
  /** ej. "PEPE" sin sufijo USDT */
  base: string;
  price: number;
  /** % cambio 24h */
  change: number;
  vol: number;
  fundingRate: number | null;
  rsi: number | null;
  divergence: DivergenceResult;
  candleColors: CandleColor[];
  /** Velas rojas consecutivas cerradas al final */
  redCount: number;
  ts: number;
}

export interface Grade {
  points: number;
  state: GradeState;
  passed: boolean;
  /** Solo true cuando no se pudo evaluar (ej. funding rate no disponible) */
  neutral?: boolean;
}

export interface Grades {
  pump: Grade;
  funding: Grade;
  rsi: Grade;
  divergence: Grade;
  redCandles: Grade;
  btcOk: Grade;
  liquidity: Grade;
}

export interface ScoredToken {
  snapshot: TokenSnapshot;
  /** 0–100 */
  score: number;
  verdict: Verdict;
  grades: Grades;
  passedCount: number;
}

export interface BtcTrend {
  /** % cambio 24h de BTC */
  change: number;
  /** true cuando change <= -2 */
  falling: boolean;
}

export interface ScanState {
  /** Timestamp del último ciclo completado */
  ranAt: number;
  /** Próximo ciclo (epoch ms) */
  nextAt: number;
  /** Si actualmente está corriendo un scan */
  running: boolean;
  btc: BtcTrend;
  thresholds: Thresholds;
  mode: Mode;
  results: ScoredToken[];
}

export interface ScanAlert {
  symbol: string;
  base: string;
  verdict: Verdict;
  score: number;
  change: number;
  rsi: number | null;
  ts: number;
}
