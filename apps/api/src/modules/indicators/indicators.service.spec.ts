import { IndicatorsService } from './indicators.service';
import { Kline } from '../binance/binance.types';

function mkKlines(closes: number[], opens?: number[], highs?: number[]): Kline[] {
  const now = Date.now();
  return closes.map((c, i) => ({
    openTime: now - (closes.length - i) * 60_000,
    open: opens?.[i] ?? c,
    high: highs?.[i] ?? Math.max(c, opens?.[i] ?? c),
    low: Math.min(c, opens?.[i] ?? c),
    close: c,
    volume: 1000,
    closeTime: now - (closes.length - i - 1) * 60_000 - 1,
  }));
}

describe('IndicatorsService', () => {
  const svc = new IndicatorsService();

  describe('rsi', () => {
    it('devuelve null con muy pocas velas', () => {
      expect(svc.rsi(mkKlines([1, 2, 3]), 14)).toBeNull();
      expect(svc.rsi(null, 14)).toBeNull();
    });

    it('devuelve 100 cuando todas las velas suben', () => {
      const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
      expect(svc.rsi(mkKlines(closes), 14)).toBe(100);
    });

    it('da un valor entre 0 y 100 para una serie mixta', () => {
      const closes = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03];
      const rsi = svc.rsi(mkKlines(closes), 14);
      expect(rsi).not.toBeNull();
      expect(rsi!).toBeGreaterThan(0);
      expect(rsi!).toBeLessThan(100);
    });
  });

  describe('rsiSeries', () => {
    it('produce array con primeras N entradas null', () => {
      const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5);
      const series = svc.rsiSeries(mkKlines(closes), 14);
      expect(series.slice(0, 14).every((v) => v === null)).toBe(true);
      expect(series.slice(14).every((v) => v !== null)).toBe(true);
    });
  });

  describe('bearishDivergence', () => {
    it('no marca divergencia con pocas velas', () => {
      const klines = mkKlines(Array.from({ length: 20 }, () => 100));
      expect(svc.bearishDivergence(klines, 30).found).toBe(false);
    });

    it('no marca divergencia en una serie completamente plana', () => {
      const klines = mkKlines(Array.from({ length: 50 }, () => 100));
      expect(svc.bearishDivergence(klines, 30).found).toBe(false);
    });
  });

  describe('candleColors', () => {
    it('clasifica red/green/neutral según open/close', () => {
      const closes = [10, 11, 9, 9];
      const opens = [10, 10, 10, 9];
      const colors = svc.candleColors(mkKlines(closes, opens), 4);
      expect(colors).toEqual(['neutral', 'green', 'red', 'neutral']);
    });

    it('devuelve [] si hay menos velas que n', () => {
      expect(svc.candleColors(mkKlines([1, 2]), 5)).toEqual([]);
    });
  });

  describe('countLastRedCandles', () => {
    it('cuenta racha de rojas al final, excluyendo vela en curso', () => {
      const opens = [10, 10, 10, 10, 10];
      const closes = [11, 9, 9, 9, 12]; // última verde (en curso) — se ignora
      const klines = mkKlines(closes, opens);
      // marcar última como en curso (closeTime futuro)
      klines[klines.length - 1]!.closeTime = Date.now() + 60_000;
      expect(svc.countLastRedCandles(klines)).toBe(3);
    });

    it('cuenta hasta encontrar una verde', () => {
      const opens = [10, 10, 10, 10];
      const closes = [11, 9, 9, 9]; // no en curso → cuenta las 3 rojas al final
      const klines = mkKlines(closes, opens);
      expect(svc.countLastRedCandles(klines)).toBe(3);
    });

    it('devuelve 0 si la última cerrada es verde', () => {
      const opens = [10, 10, 10];
      const closes = [9, 9, 11];
      const klines = mkKlines(closes, opens);
      expect(svc.countLastRedCandles(klines)).toBe(0);
    });
  });
});
