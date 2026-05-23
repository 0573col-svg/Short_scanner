import type { BtcTrend, TokenSnapshot } from '@short-scanner/shared-types';
import { ScoringService } from './scoring.service';
import { DEFAULT_WEIGHTS } from './scoring.constants';

const baseBtc: BtcTrend = { change: 0.5, falling: false };

function snap(over: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return {
    symbol: 'PEPEUSDT',
    base: 'PEPE',
    price: 0.01,
    change: 100,
    vol: 5e7,
    fundingRate: 0.08,
    rsi: 85,
    divergence: { found: true, strength: 0.7 },
    candleColors: ['green', 'green', 'green', 'red', 'red'],
    redCount: 2,
    ts: Date.now(),
    ...over,
  };
}

describe('ScoringService', () => {
  const svc = new ScoringService();

  it('GO_SHORT en STRICT cuando se cumplen todas las condiciones', () => {
    const r = svc.score({
      snapshot: snap(),
      weights: DEFAULT_WEIGHTS,
      mode: 'STRICT',
      pumpThreshold: 80,
      btc: baseBtc,
    });
    expect(r.verdict).toBe('GO_SHORT');
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.passedCount).toBeGreaterThanOrEqual(5);
  });

  it('BTC_DOWN cuando BTC cae fuerte aunque el pump sea válido', () => {
    const r = svc.score({
      snapshot: snap(),
      weights: DEFAULT_WEIGHTS,
      mode: 'STRICT',
      pumpThreshold: 80,
      btc: { change: -5, falling: true },
    });
    expect(r.verdict).toBe('BTC_DOWN');
  });

  it('NONE cuando no hay pump suficiente', () => {
    const r = svc.score({
      snapshot: snap({ change: 5, rsi: 50, divergence: { found: false, strength: 0 }, redCount: 0, candleColors: ['green'] }),
      weights: DEFAULT_WEIGHTS,
      mode: 'STRICT',
      pumpThreshold: 80,
      btc: baseBtc,
    });
    expect(r.verdict).toBe('NONE');
  });

  it('VIGILAR cuando pump pero sin red candles ni funding/rsi', () => {
    const r = svc.score({
      snapshot: snap({
        rsi: 50,
        fundingRate: 0,
        divergence: { found: false, strength: 0 },
        redCount: 0,
        candleColors: ['green', 'green'],
      }),
      weights: DEFAULT_WEIGHTS,
      mode: 'STRICT',
      pumpThreshold: 80,
      btc: baseBtc,
    });
    expect(r.verdict).toBe('VIGILAR');
  });

  it('FLEX puede dar GO_SHORT con halfPump + confluencia técnica', () => {
    const r = svc.score({
      // halfPump = change >= 80 * 0.5 = 40
      snapshot: snap({ change: 45 }),
      weights: DEFAULT_WEIGHTS,
      mode: 'FLEX',
      pumpThreshold: 80,
      btc: baseBtc,
    });
    expect(r.verdict).toBe('GO_SHORT');
  });

  it('grade de funding=null marca neutral=true y otorga 50% de los puntos', () => {
    const r = svc.score({
      snapshot: snap({ fundingRate: null }),
      weights: DEFAULT_WEIGHTS,
      mode: 'STRICT',
      pumpThreshold: 80,
      btc: baseBtc,
    });
    expect(r.grades.funding.neutral).toBe(true);
    expect(r.grades.funding.points).toBe(Math.round(DEFAULT_WEIGHTS.funding * 0.5));
    expect(r.grades.funding.passed).toBe(false);
  });

  it('puntos proporcionales al threshold (RSI 78 ~ 85% de los puntos)', () => {
    const r = svc.score({
      snapshot: snap({ rsi: 78 }),
      weights: DEFAULT_WEIGHTS,
      mode: 'STRICT',
      pumpThreshold: 80,
      btc: baseBtc,
    });
    // threshold strict=80, 78 está en [70,80), ratio=(78-70)/(80-70)=0.8
    // points = max * (0.6 + 0.4 * 0.8) = 10 * 0.92 = 9.2 → 9
    expect(r.grades.rsi.points).toBe(9);
    expect(r.grades.rsi.state).toBe('near');
    expect(r.grades.rsi.passed).toBe(false);
  });
});
