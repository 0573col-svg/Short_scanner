import type { Thresholds, Weights } from '@short-scanner/shared-types';

/** Pesos iniciales — port directo del v22 línea 782. El learning system los recalibra. */
export const DEFAULT_WEIGHTS: Weights = {
  pump: 15,
  funding: 20,
  rsi: 10,
  divergence: 20,
  redCandles: 25,
  btcOk: 5,
  liquidity: 5,
};

/** Thresholds por defecto. Equivalen a los inputs del toolbar del v22. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  pumpPct: 80,
  topN: 30,
  minVolUsd: 1_000_000,
};

/** Stablecoins a excluir del scan. Port literal de la constante STABLE del v22. */
export const STABLE_BASES = new Set([
  'USDC',
  'BUSD',
  'TUSD',
  'USDP',
  'FDUSD',
  'USDT',
  'DAI',
  'FRAX',
  'SUSD',
  'LUSD',
  'PYUSD',
  'USDD',
  'GUSD',
]);
