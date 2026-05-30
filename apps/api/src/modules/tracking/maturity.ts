/**
 * Lógica pura de la maduración de un tracked token (Fase 5).
 *
 * Estas funciones NO tocan BD, ni leen tiempo del sistema, ni emiten alertas.
 * Todas reciben `now` explícito como parámetro para que los tests puedan
 * inyectar fechas arbitrarias sin mockear timers.
 *
 * Diseño:
 *  - `updateEverFlags`, `incrementActiveMs`, `applyMaturedVerdict`:
 *    mutan el row in-place. El caller (TrackingService.reconcile) ya tiene
 *    el row cargado y necesita persistirlo de cualquier manera; mutar evita
 *    crear objetos intermedios.
 *  - `shouldExpireByWindow`: devuelve bool puro (sin mutación) porque el
 *    caller decide qué hacer (update status + archivedAt).
 *  - `computeMaturedVerdict`: devuelve `'GO_SHORT' | null` puro, sin mutar.
 *    `applyMaturedVerdict` lo usa para decidir la transición.
 */

import type { Grades } from '@short-scanner/shared-types';
import type { TrackedTokenEntity } from './tracked-token.entity';

/**
 * Subset de campos de la entity que las funciones de maturity tocan.
 * La entity completa satisface este tipo, pero declararlo permite testear
 * sin instanciar la entity TypeORM real.
 */
export type MaturityRow = Pick<
  TrackedTokenEntity,
  | 'lastSeenPumpingAt'
  | 'peakPrice'
  | 'activeMs'
  | 'rsiEverPassed'
  | 'rsiPassedAt'
  | 'fundingEverPassed'
  | 'fundingPassedAt'
  | 'divergenceEverPassed'
  | 'divergencePassedAt'
  | 'redCandlesEverPassed'
  | 'redCandlesPassedAt'
  | 'maturedVerdict'
  | 'maturedAt'
>;

/** Las 4 condiciones que aportan al verdict maduro. */
const MATURITY_KEYS = ['rsi', 'funding', 'divergence', 'redCandles'] as const;
export type MaturityKey = (typeof MATURITY_KEYS)[number];

/**
 * Si el grade actual de cualquiera de las 4 condiciones marca `passed=true`
 * y el flag Ever correspondiente estaba false, prenderlo + setear timestamp.
 *
 * Una vez prendido, NO se desactiva dentro del período de monitoreo.
 */
export function updateEverFlags(row: MaturityRow, grades: Grades, now: Date): void {
  for (const k of MATURITY_KEYS) {
    if (grades[k].passed) {
      const everKey = `${k}EverPassed` as const;
      const atKey = `${k}PassedAt` as const;
      if (!row[everKey]) {
        row[everKey] = true;
        row[atKey] = now;
      }
    }
  }
}

/**
 * Incrementa `activeMs` por el delta `(now - lastSeenPumpingAt)`, pero SOLO
 * si el delta cae dentro de la ventana de continuidad. Si el delta excede
 * `continuityThresholdMs` (señal de que el token estuvo DORMANT), el reloj
 * queda pausado: no se suma nada.
 *
 * Delta no positivo (clock skew, mismo timestamp) → no-op.
 */
export function incrementActiveMs(
  row: MaturityRow,
  now: Date,
  continuityThresholdMs: number,
): void {
  const delta = now.getTime() - row.lastSeenPumpingAt.getTime();
  if (delta > 0 && delta <= continuityThresholdMs) {
    row.activeMs += delta;
  }
}

/**
 * Computa el veredicto maduro basándose en el ESTADO ACTUAL del row.
 * Devuelve `'GO_SHORT'` si las 3 reglas se cumplen, `null` si no.
 *
 * Esta función NO considera transiciones — solo elegibilidad presente.
 * El caller (`applyMaturedVerdict`) maneja la transición + dedup vía
 * `maturedAt`.
 *
 * Reglas:
 *  1. Las 4 Ever-flags en true.
 *  2. `currentPrice >= peakPrice * priceNearPeakRatio` (default 0.80).
 *  3. `activeMs <= maturedWindowMs` (default 96h).
 */
export function computeMaturedVerdict(
  row: MaturityRow,
  currentPrice: number | null,
  maturedWindowMs: number,
  priceNearPeakRatio: number,
): 'GO_SHORT' | null {
  if (!row.rsiEverPassed) return null;
  if (!row.fundingEverPassed) return null;
  if (!row.divergenceEverPassed) return null;
  if (!row.redCandlesEverPassed) return null;
  if (currentPrice === null) return null;
  if (currentPrice < row.peakPrice * priceNearPeakRatio) return null;
  if (row.activeMs > maturedWindowMs) return null;
  return 'GO_SHORT';
}

/**
 * Aplica la transición de verdict maduro al row si corresponde.
 *
 * Una vez `maturedVerdict='GO_SHORT'`, NO se desactiva — el row queda
 * marcado como maduro hasta que muera por DORMANT TTL natural. Esto:
 *  - Evita que el verdict oscile con cada scan.
 *  - Simplifica el dedup en Fase 6 (alerta MADURA): la transición
 *    null → 'GO_SHORT' ocurre exactamente una vez por vida del token.
 */
export function applyMaturedVerdict(
  row: MaturityRow,
  currentPrice: number | null,
  now: Date,
  maturedWindowMs: number,
  priceNearPeakRatio: number,
): void {
  if (row.maturedVerdict !== null) return; // ya maduró — no tocar
  const verdict = computeMaturedVerdict(row, currentPrice, maturedWindowMs, priceNearPeakRatio);
  if (verdict !== null) {
    row.maturedVerdict = verdict;
    row.maturedAt = now;
  }
}

/**
 * Indica si un token debe archivarse por window expirado.
 *
 * Lo aplica el caller a tokens en ACTIVE/DORMANT que NO maduraron:
 * después de `maturedWindowMs` activos acumulados sin completar las
 * 4 condiciones, el pump se considera agotado y el token deja de
 * ser un candidato útil.
 *
 * Tokens que SÍ maduraron (`maturedAt !== null`) están exentos —
 * siguen vivos hasta DORMANT TTL natural.
 */
export function shouldExpireByWindow(row: MaturityRow, maturedWindowMs: number): boolean {
  return row.maturedAt === null && row.activeMs > maturedWindowMs;
}
