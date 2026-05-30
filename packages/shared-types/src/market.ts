/**
 * Vela OHLC para gráficos de precio (klines de Binance, proxy server-side).
 * `time` en **segundos UTC** (no ms) — es el formato que espera
 * lightweight-charts (`UTCTimestamp`). El API convierte ms→s al mapear.
 */
export interface KlineView {
  /** Apertura de la vela en segundos UTC. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
