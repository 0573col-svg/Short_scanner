import type { ScoredToken, TokenSnapshot, Verdict } from '@short-scanner/shared-types';
import { ScannerStateStore } from './scanner.state';

const TEST_USER = '00000000-0000-0000-0000-000000000001';

function scoredToken(verdict: Verdict, base: string, score = 80): ScoredToken {
  const snapshot: TokenSnapshot = {
    symbol: `${base}USDT`,
    base,
    price: 1,
    change: 50,
    vol: 1e7,
    fundingRate: 0.05,
    rsi: 80,
    divergence: { found: true, strength: 0.7 },
    candleColors: ['red', 'red'],
    redCount: 2,
    ts: Date.now(),
  };
  return {
    snapshot,
    score,
    verdict,
    grades: {} as never,
    passedCount: 5,
  };
}

describe('ScannerStateStore (multi-user)', () => {
  it('dedupe correcto en el mismo 4h-block para GO_SHORT y CERCA per-user', () => {
    const store = new ScannerStateStore();
    const r1 = store.applyUserResults(
      TEST_USER,
      [scoredToken('GO_SHORT', 'BTC'), scoredToken('CERCA', 'ETH')],
      0,
    );
    expect(r1).toHaveLength(2);

    const r2 = store.applyUserResults(
      TEST_USER,
      [scoredToken('GO_SHORT', 'BTC'), scoredToken('CERCA', 'ETH')],
      0,
    );
    expect(r2).toHaveLength(0); // ya alertados, no re-emitir
  });

  it('cleanup tras 500 ids PRESERVA entradas CERCA actuales (regression bug #1)', () => {
    const store = new ScannerStateStore();
    const currentBlock = Math.floor(Date.now() / (4 * 3600 * 1000));
    const veryOldBlock = currentBlock - 10;

    const seed: string[] = [];
    for (let i = 0; i < 300; i++) seed.push(`GO_OLD${i}_${veryOldBlock}`);
    for (let i = 0; i < 300; i++) seed.push(`NR_OLD${i}_${veryOldBlock}`);
    store._debugSeedAlerts(TEST_USER, seed);

    const alerts = store.applyUserResults(TEST_USER, [scoredToken('CERCA', 'NEWXRP')], 0);
    expect(alerts).toHaveLength(1);

    const remaining = store._debugGetAlerts(TEST_USER);
    const newNrId = `NR_NEWXRP_${currentBlock}`;
    expect(remaining.has(newNrId)).toBe(true);
    expect(remaining.size).toBeLessThan(50);
  });

  it('NONE/VIGILAR/BTC_DOWN no producen alertas', () => {
    const store = new ScannerStateStore();
    const alerts = store.applyUserResults(
      TEST_USER,
      [scoredToken('VIGILAR', 'A'), scoredToken('BTC_DOWN', 'B'), scoredToken('NONE', 'C')],
      0,
    );
    expect(alerts).toHaveLength(0);
    expect(store._debugGetAlerts(TEST_USER).size).toBe(0);
  });

  it('dedupes están ISOLADOS por usuario', () => {
    const store = new ScannerStateStore();
    const userA = '00000000-0000-0000-0000-00000000000A';
    const userB = '00000000-0000-0000-0000-00000000000B';

    const alertsA = store.applyUserResults(userA, [scoredToken('GO_SHORT', 'BTC')], 0);
    expect(alertsA).toHaveLength(1);

    // Mismo token, otro user → SÍ debe alertar (sets independientes)
    const alertsB = store.applyUserResults(userB, [scoredToken('GO_SHORT', 'BTC')], 0);
    expect(alertsB).toHaveLength(1);

    // Re-emit para A → ya alertado
    const alertsAAgain = store.applyUserResults(userA, [scoredToken('GO_SHORT', 'BTC')], 0);
    expect(alertsAAgain).toHaveLength(0);
  });

  it('forgetUser limpia el state de ese user', () => {
    const store = new ScannerStateStore();
    store.applyUserResults(TEST_USER, [scoredToken('GO_SHORT', 'BTC')], 0);
    expect(store._debugGetAlerts(TEST_USER).size).toBe(1);
    store.forgetUser(TEST_USER);
    expect(store._debugGetAlerts(TEST_USER).size).toBe(0);
  });
});
