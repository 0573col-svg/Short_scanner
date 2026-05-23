import type { ScoredToken, TokenSnapshot, Verdict } from '@short-scanner/shared-types';
import { ScannerStateStore } from './scanner.state';

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

describe('ScannerStateStore', () => {
  describe('applyScanResults — alert dedupe', () => {
    it('dedupe correcto en el mismo 4h-block para GO_SHORT y CERCA', () => {
      const store = new ScannerStateStore();
      const r1 = store.applyScanResults(
        [scoredToken('GO_SHORT', 'BTC'), scoredToken('CERCA', 'ETH')],
        0,
      );
      expect(r1).toHaveLength(2);

      const r2 = store.applyScanResults(
        [scoredToken('GO_SHORT', 'BTC'), scoredToken('CERCA', 'ETH')],
        0,
      );
      expect(r2).toHaveLength(0); // no se re-alertan
    });

    it('cleanup tras 500 ids PRESERVA entradas CERCA actuales (regression bug #1)', () => {
      const store = new ScannerStateStore();
      const currentBlock = Math.floor(Date.now() / (4 * 3600 * 1000));
      const veryOldBlock = currentBlock - 10;

      // Sembrar 600 ids: mitad GO viejos, mitad NR viejos (deben caer)
      const seed: string[] = [];
      for (let i = 0; i < 300; i++) seed.push(`GO_OLD${i}_${veryOldBlock}`);
      for (let i = 0; i < 300; i++) seed.push(`NR_OLD${i}_${veryOldBlock}`);
      store._debugSeedAlerts(seed);

      // Aplicar resultados con CERCA fresca para forzar cleanup + insert
      const alerts = store.applyScanResults([scoredToken('CERCA', 'NEWXRP')], 0);
      expect(alerts).toHaveLength(1);

      const remaining = store._debugGetAlerts();
      // La entrada NUEVA NR debe estar
      const newNrId = `NR_NEWXRP_${currentBlock}`;
      expect(remaining.has(newNrId)).toBe(true);
      // Las viejas deben haber sido purgadas (>2 blocks de antigüedad)
      expect(remaining.size).toBeLessThan(50);
    });

    it('NONE/VIGILAR/BTC_DOWN no producen alertas ni entradas', () => {
      const store = new ScannerStateStore();
      const alerts = store.applyScanResults(
        [
          scoredToken('VIGILAR', 'A'),
          scoredToken('BTC_DOWN', 'B'),
          scoredToken('NONE', 'C'),
        ],
        0,
      );
      expect(alerts).toHaveLength(0);
      expect(store._debugGetAlerts().size).toBe(0);
    });
  });
});
