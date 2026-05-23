import { Injectable } from '@nestjs/common';
import type { CandleColor, DivergenceResult } from '@short-scanner/shared-types';
import { Kline } from '../binance/binance.types';

/** Cantidad de velas que mostramos en el "candle strip" del UI */
export const CANDLES_TO_SHOW = 5;

interface Peak {
  idx: number;
  value: number;
}

@Injectable()
export class IndicatorsService {
  /** RSI (Wilder smoothing). Port literal de calcRSI del v22. */
  rsi(klines: Kline[] | null, period = 14): number | null {
    if (!klines || klines.length < period + 1) return null;
    const closes = klines.map((k) => k.close);

    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i]! - closes[i - 1]!;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgG = gains / period;
    let avgL = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i]! - closes[i - 1]!;
      const g = diff > 0 ? diff : 0;
      const l = diff < 0 ? -diff : 0;
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
    }
    if (avgL === 0) return 100;
    return 100 - 100 / (1 + avgG / avgL);
  }

  /** Serie de RSI para cada vela (necesario para divergencias). Port de calcRSISeries. */
  rsiSeries(klines: Kline[] | null, period = 14): Array<number | null> {
    if (!klines || klines.length < period + 1) return [];
    const closes = klines.map((k) => k.close);
    const rsis: Array<number | null> = new Array(period).fill(null);

    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i]! - closes[i - 1]!;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    let avgG = gains / period;
    let avgL = losses / period;
    rsis.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i]! - closes[i - 1]!;
      const g = diff > 0 ? diff : 0;
      const l = diff < 0 ? -diff : 0;
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      rsis.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
    }
    return rsis;
  }

  /**
   * Detecta divergencia bajista en las últimas N velas.
   * Port directo de detectBearishDivergence del v22.
   */
  bearishDivergence(klines: Kline[] | null, lookback = 30): DivergenceResult {
    if (!klines || klines.length < lookback + 15) {
      return { found: false, strength: 0 };
    }

    const rsiSeries = this.rsiSeries(klines, 14);
    const startIdx = klines.length - lookback;
    const recentHighs = klines.slice(startIdx).map((k) => k.high);
    const recentRsi = rsiSeries.slice(startIdx);

    const pricePeaks = findSwingHighs(recentHighs, 2);
    const rsiPeaks = findSwingHighs(recentRsi, 2);

    if (pricePeaks.length < 2 || rsiPeaks.length < 2) {
      return { found: false, strength: 0, debug: 'no enough peaks' };
    }

    const p2 = pricePeaks[pricePeaks.length - 1]!;
    const p1 = pricePeaks[pricePeaks.length - 2]!;

    if (recentHighs.length - 1 - p2.idx > 10) {
      return { found: false, strength: 0, debug: 'last peak too far' };
    }

    const r2 = nearestPeak(rsiPeaks, p2.idx);
    const r1 = nearestPeak(rsiPeaks, p1.idx);
    if (!r1 || !r2) return { found: false, strength: 0, debug: 'no matching rsi peaks' };

    const priceUp = p2.value > p1.value;
    const rsiDown = r2.value < r1.value;
    if (!priceUp || !rsiDown) return { found: false, strength: 0, debug: 'not diverging' };

    const priceRise = (p2.value - p1.value) / p1.value;
    const rsiDrop = r1.value - r2.value;
    const rsiHigh = Math.min(r1.value, r2.value);

    let strength = 0;
    if (rsiHigh >= 70) strength += 0.4;
    else if (rsiHigh >= 60) strength += 0.2;
    if (rsiDrop >= 5) strength += 0.3;
    else if (rsiDrop >= 2) strength += 0.15;
    if (priceRise >= 0.05) strength += 0.3;
    else if (priceRise >= 0.02) strength += 0.15;

    return {
      found: true,
      strength: Math.min(1, strength),
      p1: p1.value,
      p2: p2.value,
      r1: r1.value,
      r2: r2.value,
      rsiDrop,
      priceRise,
    };
  }

  /** Colores de las últimas N velas. red < open, green > open. */
  candleColors(klines: Kline[] | null, n = CANDLES_TO_SHOW): CandleColor[] {
    if (!klines || klines.length < n) return [];
    return klines.slice(-n).map((k) => {
      if (k.close < k.open) return 'red';
      if (k.close > k.open) return 'green';
      return 'neutral';
    });
  }

  /**
   * Cuenta velas rojas consecutivas al final, EXCLUYENDO la vela en curso.
   * Una vela está "en curso" cuando closeTime > Date.now().
   */
  countLastRedCandles(klines: Kline[] | null): number {
    if (!klines || klines.length < 2) return 0;
    const nowMs = Date.now();
    let lastIdx = klines.length - 1;
    if (klines[lastIdx]!.closeTime > nowMs) lastIdx--;
    let count = 0;
    for (let i = lastIdx; i >= 0; i--) {
      const k = klines[i]!;
      if (k.close < k.open) count++;
      else break;
    }
    return count;
  }
}

/**
 * Encuentra swing highs: puntos que son ≥ que `window` puntos a cada lado.
 * Deduplica picos consecutivos del mismo valor que están a ≤3 índices entre sí.
 */
function findSwingHighs(series: Array<number | null>, window = 2): Peak[] {
  const peaks: Peak[] = [];
  for (let i = window; i < series.length - window; i++) {
    const v = series[i];
    if (v === null || v === undefined) continue;
    let leftOk = true;
    for (let j = 1; j <= window; j++) {
      const left = series[i - j];
      if (left === null || left === undefined || left > v) {
        leftOk = false;
        break;
      }
    }
    if (!leftOk) continue;
    let rightOk = true;
    for (let j = 1; j <= window; j++) {
      const right = series[i + j];
      if (right === null || right === undefined || right > v) {
        rightOk = false;
        break;
      }
    }
    if (!rightOk) continue;
    peaks.push({ idx: i, value: v });
  }
  const deduped: Peak[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const cur = peaks[i]!;
    const next = peaks[i + 1];
    if (next && cur.value === next.value && next.idx - cur.idx <= 3) continue;
    deduped.push(cur);
  }
  return deduped;
}

function nearestPeak(peaks: Peak[], targetIdx: number): Peak | null {
  let best: Peak | null = null;
  let minDist = Infinity;
  for (const p of peaks) {
    const dist = Math.abs(p.idx - targetIdx);
    if (dist < minDist && dist <= 3) {
      minDist = dist;
      best = p;
    }
  }
  return best;
}
