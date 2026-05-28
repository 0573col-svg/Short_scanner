import type { Grades } from '@short-scanner/shared-types';
import {
  applyMaturedVerdict,
  computeMaturedVerdict,
  incrementActiveMs,
  shouldExpireByWindow,
  updateEverFlags,
  type MaturityRow,
} from './maturity';

const HOUR = 3600 * 1000;
const WINDOW = 96 * HOUR;
const RATIO = 0.8;

/** Factory: row con todas las flags en false y `activeMs=0` por defecto. */
function row(over: Partial<MaturityRow> = {}): MaturityRow {
  return {
    lastSeenPumpingAt: new Date('2026-01-01T00:00:00Z'),
    peakPrice: 1.0,
    activeMs: 0,
    rsiEverPassed: false,
    rsiPassedAt: null,
    fundingEverPassed: false,
    fundingPassedAt: null,
    divergenceEverPassed: false,
    divergencePassedAt: null,
    redCandlesEverPassed: false,
    redCandlesPassedAt: null,
    maturedVerdict: null,
    maturedAt: null,
    ...over,
  };
}

/** Factory: grades donde se especifica `passed` de cada uno (false default). */
function grades(passed: Partial<Record<keyof Grades, boolean>>): Grades {
  const mk = (p: boolean) => ({ points: p ? 10 : 0, state: 'ok' as const, passed: p });
  return {
    pump: mk(passed.pump ?? false),
    funding: mk(passed.funding ?? false),
    rsi: mk(passed.rsi ?? false),
    divergence: mk(passed.divergence ?? false),
    redCandles: mk(passed.redCandles ?? false),
    btcOk: mk(passed.btcOk ?? false),
    liquidity: mk(passed.liquidity ?? false),
  };
}

describe('updateEverFlags', () => {
  it('prende la flag y setea timestamp en el primer scan donde passed=true', () => {
    const r = row();
    const now = new Date('2026-01-01T01:00:00Z');
    updateEverFlags(r, grades({ rsi: true }), now);
    expect(r.rsiEverPassed).toBe(true);
    expect(r.rsiPassedAt).toEqual(now);
    // Las otras 3 siguen apagadas
    expect(r.fundingEverPassed).toBe(false);
    expect(r.divergenceEverPassed).toBe(false);
    expect(r.redCandlesEverPassed).toBe(false);
  });

  it('NO sobrescribe el timestamp si la flag ya estaba prendida', () => {
    const firstHit = new Date('2026-01-01T01:00:00Z');
    const r = row({ rsiEverPassed: true, rsiPassedAt: firstHit });
    const later = new Date('2026-01-02T05:00:00Z');
    updateEverFlags(r, grades({ rsi: true }), later);
    expect(r.rsiPassedAt).toEqual(firstHit); // sigue siendo el original
  });

  it('NO desactiva una flag aunque el grade actual sea passed=false', () => {
    const firstHit = new Date('2026-01-01T01:00:00Z');
    const r = row({ rsiEverPassed: true, rsiPassedAt: firstHit });
    const later = new Date('2026-01-02T05:00:00Z');
    updateEverFlags(r, grades({ rsi: false }), later);
    expect(r.rsiEverPassed).toBe(true);
    expect(r.rsiPassedAt).toEqual(firstHit);
  });

  it('ignora grades fuera de las 4 keys (pump/btcOk/liquidity no tienen Ever-flag)', () => {
    const r = row();
    updateEverFlags(
      r,
      grades({ pump: true, btcOk: true, liquidity: true }),
      new Date('2026-01-01T01:00:00Z'),
    );
    // Ninguno de los 4 trackeados debió cambiar
    expect(r.rsiEverPassed).toBe(false);
    expect(r.fundingEverPassed).toBe(false);
    expect(r.divergenceEverPassed).toBe(false);
    expect(r.redCandlesEverPassed).toBe(false);
  });

  it('prende múltiples flags en el mismo scan', () => {
    const r = row();
    const now = new Date('2026-01-01T01:00:00Z');
    updateEverFlags(r, grades({ rsi: true, funding: true, divergence: true, redCandles: true }), now);
    expect(r.rsiEverPassed).toBe(true);
    expect(r.fundingEverPassed).toBe(true);
    expect(r.divergenceEverPassed).toBe(true);
    expect(r.redCandlesEverPassed).toBe(true);
  });
});

describe('incrementActiveMs', () => {
  const THRESHOLD = 180_000; // 1.5× scan interval

  it('suma delta cuando el reaparición es continua (delta <= threshold)', () => {
    const last = new Date('2026-01-01T00:00:00Z');
    const r = row({ lastSeenPumpingAt: last, activeMs: 5_000_000 });
    incrementActiveMs(r, new Date(last.getTime() + 120_000), THRESHOLD);
    expect(r.activeMs).toBe(5_000_000 + 120_000);
  });

  it('NO suma cuando el delta supera el threshold (token estuvo DORMANT)', () => {
    const last = new Date('2026-01-01T00:00:00Z');
    const r = row({ lastSeenPumpingAt: last, activeMs: 5_000_000 });
    incrementActiveMs(r, new Date(last.getTime() + 6 * HOUR), THRESHOLD);
    expect(r.activeMs).toBe(5_000_000); // pausado
  });

  it('NO suma cuando el delta es 0 o negativo (clock skew)', () => {
    const last = new Date('2026-01-01T00:00:00Z');
    const r = row({ lastSeenPumpingAt: last, activeMs: 1000 });
    incrementActiveMs(r, last, THRESHOLD); // delta = 0
    expect(r.activeMs).toBe(1000);
    incrementActiveMs(r, new Date(last.getTime() - 5000), THRESHOLD); // delta < 0
    expect(r.activeMs).toBe(1000);
  });

  it('límite exacto: delta == threshold suma; delta == threshold+1 no suma', () => {
    const last = new Date('2026-01-01T00:00:00Z');
    const rEq = row({ lastSeenPumpingAt: last, activeMs: 0 });
    incrementActiveMs(rEq, new Date(last.getTime() + THRESHOLD), THRESHOLD);
    expect(rEq.activeMs).toBe(THRESHOLD);

    const rOver = row({ lastSeenPumpingAt: last, activeMs: 0 });
    incrementActiveMs(rOver, new Date(last.getTime() + THRESHOLD + 1), THRESHOLD);
    expect(rOver.activeMs).toBe(0);
  });
});

describe('computeMaturedVerdict', () => {
  const NOW = new Date('2026-01-01T00:00:00Z');

  function allFlagsRow(over: Partial<MaturityRow> = {}): MaturityRow {
    return row({
      rsiEverPassed: true,
      fundingEverPassed: true,
      divergenceEverPassed: true,
      redCandlesEverPassed: true,
      peakPrice: 1.0,
      activeMs: 10 * HOUR,
      ...over,
    });
  }

  it('GO_SHORT cuando las 4 flags + precio >= 0.80*peak + activeMs <= window', () => {
    const r = allFlagsRow();
    expect(computeMaturedVerdict(r, 0.9, WINDOW, RATIO)).toBe('GO_SHORT');
  });

  it('null si falta cualquiera de las 4 flags', () => {
    expect(computeMaturedVerdict(allFlagsRow({ rsiEverPassed: false }), 0.9, WINDOW, RATIO)).toBeNull();
    expect(computeMaturedVerdict(allFlagsRow({ fundingEverPassed: false }), 0.9, WINDOW, RATIO)).toBeNull();
    expect(computeMaturedVerdict(allFlagsRow({ divergenceEverPassed: false }), 0.9, WINDOW, RATIO)).toBeNull();
    expect(computeMaturedVerdict(allFlagsRow({ redCandlesEverPassed: false }), 0.9, WINDOW, RATIO)).toBeNull();
  });

  it('null si currentPrice cayó debajo del 80% del peak', () => {
    expect(computeMaturedVerdict(allFlagsRow({ peakPrice: 1.0 }), 0.79, WINDOW, RATIO)).toBeNull();
  });

  it('null si currentPrice es null', () => {
    expect(computeMaturedVerdict(allFlagsRow(), null, WINDOW, RATIO)).toBeNull();
  });

  it('null si activeMs ya superó el window', () => {
    expect(computeMaturedVerdict(allFlagsRow({ activeMs: WINDOW + 1 }), 0.9, WINDOW, RATIO)).toBeNull();
  });

  it('GO_SHORT en el límite exacto del precio (0.80 * peak)', () => {
    // peakPrice=1.0, ratio=0.8, currentPrice=0.8 → exactamente en el límite
    expect(computeMaturedVerdict(allFlagsRow({ peakPrice: 1.0 }), 0.8, WINDOW, RATIO)).toBe('GO_SHORT');
  });

  it('GO_SHORT en el límite exacto del window (activeMs == window)', () => {
    expect(computeMaturedVerdict(allFlagsRow({ activeMs: WINDOW }), 0.9, WINDOW, RATIO)).toBe('GO_SHORT');
  });
  void NOW;
});

describe('applyMaturedVerdict', () => {
  it('seteia maturedVerdict + maturedAt en la transición null → GO_SHORT', () => {
    const r = row({
      rsiEverPassed: true,
      fundingEverPassed: true,
      divergenceEverPassed: true,
      redCandlesEverPassed: true,
      activeMs: 10 * HOUR,
    });
    const now = new Date('2026-01-02T00:00:00Z');
    applyMaturedVerdict(r, 0.9, now, WINDOW, RATIO);
    expect(r.maturedVerdict).toBe('GO_SHORT');
    expect(r.maturedAt).toEqual(now);
  });

  it('NO sobrescribe maturedAt si ya estaba marcado', () => {
    const original = new Date('2026-01-01T12:00:00Z');
    const r = row({
      rsiEverPassed: true,
      fundingEverPassed: true,
      divergenceEverPassed: true,
      redCandlesEverPassed: true,
      activeMs: 20 * HOUR,
      maturedVerdict: 'GO_SHORT',
      maturedAt: original,
    });
    applyMaturedVerdict(r, 0.95, new Date('2026-01-03T00:00:00Z'), WINDOW, RATIO);
    expect(r.maturedAt).toEqual(original); // sigue siendo el original
    expect(r.maturedVerdict).toBe('GO_SHORT');
  });

  it('NO marca maturedVerdict si las condiciones no se cumplen', () => {
    const r = row({
      rsiEverPassed: true,
      fundingEverPassed: true,
      divergenceEverPassed: true,
      redCandlesEverPassed: false, // falta 1
      activeMs: 10 * HOUR,
    });
    applyMaturedVerdict(r, 0.9, new Date(), WINDOW, RATIO);
    expect(r.maturedVerdict).toBeNull();
    expect(r.maturedAt).toBeNull();
  });
});

describe('shouldExpireByWindow', () => {
  it('true si activeMs > window y nunca maduró', () => {
    const r = row({ activeMs: WINDOW + 1, maturedAt: null });
    expect(shouldExpireByWindow(r, WINDOW)).toBe(true);
  });

  it('false si activeMs <= window', () => {
    expect(shouldExpireByWindow(row({ activeMs: WINDOW, maturedAt: null }), WINDOW)).toBe(false);
  });

  it('false si maduró (maturedAt!=null), incluso si activeMs supera el window', () => {
    const r = row({ activeMs: WINDOW + 50 * HOUR, maturedAt: new Date() });
    expect(shouldExpireByWindow(r, WINDOW)).toBe(false);
  });
});

// Tests de integración del flujo completo (sin BD)
describe('flujo end-to-end de un token que matura', () => {
  it('a lo largo de 4 scans gana las 4 flags y madura en el 4to', () => {
    const r = row({
      lastSeenPumpingAt: new Date('2026-01-01T00:00:00Z'),
      peakPrice: 1.0,
      activeMs: 0,
    });
    const THRESHOLD = 180_000;

    // Scan 2 (2 min después del create): RSI passes
    let now = new Date('2026-01-01T00:02:00Z');
    incrementActiveMs(r, now, THRESHOLD);
    updateEverFlags(r, grades({ rsi: true }), now);
    applyMaturedVerdict(r, 0.95, now, WINDOW, RATIO);
    r.lastSeenPumpingAt = now;
    expect(r.maturedVerdict).toBeNull(); // 1 flag

    // Scan 3 (2 min después): funding passes
    now = new Date('2026-01-01T00:04:00Z');
    incrementActiveMs(r, now, THRESHOLD);
    updateEverFlags(r, grades({ funding: true }), now);
    applyMaturedVerdict(r, 0.92, now, WINDOW, RATIO);
    r.lastSeenPumpingAt = now;
    expect(r.maturedVerdict).toBeNull(); // 2 flags

    // Scan 4: divergence passes
    now = new Date('2026-01-01T00:06:00Z');
    incrementActiveMs(r, now, THRESHOLD);
    updateEverFlags(r, grades({ divergence: true }), now);
    applyMaturedVerdict(r, 0.9, now, WINDOW, RATIO);
    r.lastSeenPumpingAt = now;
    expect(r.maturedVerdict).toBeNull(); // 3 flags

    // Scan 5: redCandles passes → debería madurar
    now = new Date('2026-01-01T00:08:00Z');
    incrementActiveMs(r, now, THRESHOLD);
    updateEverFlags(r, grades({ redCandles: true }), now);
    applyMaturedVerdict(r, 0.88, now, WINDOW, RATIO);
    expect(r.maturedVerdict).toBe('GO_SHORT');
    expect(r.maturedAt).toEqual(now);
    expect(r.activeMs).toBe(4 * 120_000); // 8 min totales activos
  });

  it('token que pasó DORMANT 1 día entre scans: activeMs solo suma los reales', () => {
    const r = row({
      lastSeenPumpingAt: new Date('2026-01-01T00:00:00Z'),
      peakPrice: 1.0,
      activeMs: 0,
    });
    const THRESHOLD = 180_000;

    // Scan continuo
    let now = new Date('2026-01-01T00:02:00Z');
    incrementActiveMs(r, now, THRESHOLD);
    r.lastSeenPumpingAt = now;
    expect(r.activeMs).toBe(120_000);

    // Gap de 1 día → DORMANT en BD, vuelve a aparecer
    now = new Date('2026-01-02T00:02:00Z');
    incrementActiveMs(r, now, THRESHOLD);
    r.lastSeenPumpingAt = now;
    expect(r.activeMs).toBe(120_000); // se quedó pausado

    // Scan continuo de nuevo
    now = new Date('2026-01-02T00:04:00Z');
    incrementActiveMs(r, now, THRESHOLD);
    expect(r.activeMs).toBe(240_000);
  });
});
