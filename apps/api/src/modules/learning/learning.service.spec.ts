import type { Grades, TradeResult } from '@short-scanner/shared-types';
import { LearningService } from './learning.service';
import { TradeEntity } from '../trades/trade.entity';
import { DEFAULT_WEIGHTS } from '../scoring/scoring.constants';

// Helper para fabricar un trade con grades específicos
function trade(result: TradeResult, gradePassed: Partial<Record<keyof Grades, boolean>>): TradeEntity {
  const grades = {} as Record<string, { passed: boolean; points: number; state: 'ok' }>;
  for (const k of Object.keys(DEFAULT_WEIGHTS) as Array<keyof Grades>) {
    grades[k] = { passed: gradePassed[k] ?? false, points: 0, state: 'ok' };
  }
  return {
    id: 'fake',
    userId: 'user',
    symbol: 'XUSDT',
    openedAt: new Date(),
    closedAt: new Date(),
    result,
    entrySnapshot: { grades },
    daysActiveAtEntry: 1,
    scansActiveAtEntry: 1,
    peakScoreAtEntry: 50,
    notes: null,
    trackedTokenId: null,
  } as TradeEntity;
}

// Mocks mínimos de los repos / UsersService
function makeService(closed: TradeEntity[]) {
  let lastWeights: unknown = null;
  const repo = {
    find: jest.fn().mockResolvedValue(closed),
  };
  const users = {
    updateWeights: jest.fn().mockImplementation((_id, w) => {
      lastWeights = w;
      return Promise.resolve();
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new LearningService(repo as any, users as any);
  return {
    svc,
    getLastWeights: () => lastWeights as Record<string, number> | null,
  };
}

describe('LearningService.recalculate', () => {
  it('no aplica si hay menos de 3 trades cerrados con grades', async () => {
    const { svc, getLastWeights } = makeService([
      trade('WIN', { redCandles: true, rsi: true }),
      trade('LOSS', { rsi: true }),
    ]);
    const r = await svc.recalculate('user');
    expect(r.applied).toBe(false);
    expect(getLastWeights()).toBeNull();
  });

  it('ordena los pesos por winrate (mejores predictores ⇒ más peso)', async () => {
    // Winrates esperados:
    //   redCandles: 3/3 = 1.0  (predictor perfecto)
    //   pump:       2/4 = 0.5
    //   rsi:        0/2 = 0.0  (predictor inverso — siempre perdió)
    //   funding/divergence/btcOk/liquidity: sin data → neutral 0.5
    const trades = [
      trade('WIN', { redCandles: true, pump: true }),
      trade('WIN', { redCandles: true, pump: true }),
      trade('WIN', { redCandles: true }),
      trade('LOSS', { pump: true, rsi: true }),
      trade('LOSS', { pump: true, rsi: true }),
    ];
    const { svc, getLastWeights } = makeService(trades);
    const r = await svc.recalculate('user');
    expect(r.applied).toBe(true);
    const w = getLastWeights()!;
    // Invariante 1: orden por winrate — redCandles (1.0) > pump (0.5) > rsi (0.0)
    expect(w.redCandles).toBeGreaterThan(w.pump);
    expect(w.pump).toBeGreaterThan(w.rsi);
    // Invariante 2: total preservado al total de los defaults (100)
    const sum = Object.values(w).reduce((s, v) => s + v, 0);
    const defaultsSum =
      DEFAULT_WEIGHTS.pump +
      DEFAULT_WEIGHTS.funding +
      DEFAULT_WEIGHTS.rsi +
      DEFAULT_WEIGHTS.divergence +
      DEFAULT_WEIGHTS.redCandles +
      DEFAULT_WEIGHTS.btcOk +
      DEFAULT_WEIGHTS.liquidity;
    expect(sum).toBe(defaultsSum);
  });

  it('ningún peso cae por debajo de 1 ni sube por encima de 50', async () => {
    // Caso extremo: TODOS los trades wins en redCandles, todos losses en pump
    const trades = [
      trade('WIN', { redCandles: true }),
      trade('WIN', { redCandles: true }),
      trade('WIN', { redCandles: true }),
      trade('LOSS', { pump: true }),
      trade('LOSS', { pump: true }),
      trade('LOSS', { pump: true }),
    ];
    const { svc, getLastWeights } = makeService(trades);
    await svc.recalculate('user');
    const w = getLastWeights()!;
    for (const v of Object.values(w)) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(50);
    }
  });

  it('ignora trades sin grades en entrySnapshot', async () => {
    // 3 trades — solo 1 con grades. No debe aplicar.
    const noGrades = {
      ...trade('WIN', { rsi: true }),
      entrySnapshot: { someOtherField: 'x' } as Record<string, unknown>,
    } as TradeEntity;
    const { svc } = makeService([noGrades, noGrades, trade('LOSS', { rsi: true })]);
    const r = await svc.recalculate('user');
    expect(r.applied).toBe(false);
    expect(r.trades).toBe(1);
  });
});
