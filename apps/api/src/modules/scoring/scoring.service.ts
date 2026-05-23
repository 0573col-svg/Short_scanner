import { Injectable } from '@nestjs/common';
import type {
  BtcTrend,
  CandleColor,
  DivergenceResult,
  Grade,
  Grades,
  Mode,
  ScoredToken,
  TokenSnapshot,
  Verdict,
  Weights,
} from '@short-scanner/shared-types';

interface ScoreInput {
  snapshot: TokenSnapshot;
  weights: Weights;
  mode: Mode;
  /** Threshold de pump % (de Thresholds.pumpPct) */
  pumpThreshold: number;
  btc: BtcTrend;
}

@Injectable()
export class ScoringService {
  score(input: ScoreInput): ScoredToken {
    const { snapshot, weights, mode, pumpThreshold, btc } = input;
    const rsiTh = mode === 'FLEX' ? 75 : 80;

    const grades: Grades = {
      pump: gradePump(snapshot.change, pumpThreshold, weights.pump),
      funding: gradeFunding(snapshot.fundingRate, weights.funding),
      rsi: gradeRSI(snapshot.rsi, rsiTh, weights.rsi),
      divergence: gradeDivergence(snapshot.divergence, weights.divergence),
      redCandles: gradeRedCandles(snapshot.redCount, snapshot.candleColors, weights.redCandles),
      btcOk: gradeBtcOk(btc.change, weights.btcOk),
      liquidity: gradeLiquidity(snapshot.vol, weights.liquidity),
    };

    let total = 0;
    let earned = 0;
    for (const key of CORE_KEYS) {
      total += weights[key];
      earned += grades[key].points;
    }
    const score = total > 0 ? Math.round((earned / total) * 100) : 0;
    const passedCount = Object.values(grades).filter((g) => g.passed).length;
    const verdict = computeVerdict(grades, snapshot.change, pumpThreshold, mode);

    return { snapshot, score, verdict, grades, passedCount };
  }
}

const CORE_KEYS = [
  'pump',
  'funding',
  'rsi',
  'divergence',
  'redCandles',
  'btcOk',
  'liquidity',
] as const satisfies ReadonlyArray<keyof Grades>;

/* ─── grade* functions: port directo del v22 ─────────────────────── */

function gradePump(change: number, threshold: number, max: number): Grade {
  if (change <= 0) return { points: 0, state: 'fail', passed: false };
  if (change >= threshold) return { points: max, state: 'ok', passed: true };
  const ratio = change / threshold;
  return {
    points: Math.round(max * ratio),
    state: ratio >= 0.7 ? 'near' : 'fail',
    passed: false,
  };
}

function gradeFunding(fr: number | null, max: number): Grade {
  if (fr === null) {
    return { points: Math.round(max * 0.5), state: 'near', passed: false, neutral: true };
  }
  if (fr >= 0.05) return { points: max, state: 'ok', passed: true };
  if (fr >= 0.02) {
    const ratio = (fr - 0.02) / 0.03;
    return { points: Math.round(max * (0.6 + 0.4 * ratio)), state: 'near', passed: false };
  }
  if (fr > 0) {
    const ratio = fr / 0.02;
    return { points: Math.round(max * (0.2 + 0.4 * ratio)), state: 'fail', passed: false };
  }
  return { points: 0, state: 'fail', passed: false };
}

function gradeRSI(rsi: number | null, threshold: number, max: number): Grade {
  if (rsi === null) return { points: 0, state: 'fail', passed: false };
  if (rsi >= threshold) return { points: max, state: 'ok', passed: true };
  if (rsi >= 70) {
    const ratio = (rsi - 70) / (threshold - 70);
    return { points: Math.round(max * (0.6 + 0.4 * ratio)), state: 'near', passed: false };
  }
  if (rsi >= 60) {
    const ratio = (rsi - 60) / 10;
    return { points: Math.round(max * (0.2 + 0.4 * ratio)), state: 'fail', passed: false };
  }
  return { points: 0, state: 'fail', passed: false };
}

function gradeRedCandles(redCount: number, colors: CandleColor[], max: number): Grade {
  if (redCount >= 2) return { points: max, state: 'ok', passed: true };
  if (redCount === 1) return { points: Math.round(max * 0.4), state: 'near', passed: false };
  if (colors.includes('red')) return { points: Math.round(max * 0.15), state: 'near', passed: false };
  return { points: 0, state: 'fail', passed: false };
}

function gradeBtcOk(btcChange: number, max: number): Grade {
  if (btcChange >= 0) return { points: max, state: 'ok', passed: true };
  if (btcChange >= -2) {
    const ratio = (btcChange + 2) / 2;
    return { points: Math.round(max * (0.4 + 0.6 * ratio)), state: 'near', passed: true };
  }
  return { points: 0, state: 'fail', passed: false };
}

function gradeLiquidity(vol: number, max: number): Grade {
  if (vol >= 1e7) return { points: max, state: 'ok', passed: true };
  if (vol >= 5e6) return { points: Math.round(max * 0.7), state: 'near', passed: false };
  if (vol >= 1e6) return { points: Math.round(max * 0.3), state: 'fail', passed: false };
  return { points: 0, state: 'fail', passed: false };
}

function gradeDivergence(div: DivergenceResult, max: number): Grade {
  if (!div || !div.found) return { points: 0, state: 'fail', passed: false };
  const points = Math.round(max * div.strength);
  const passed = div.strength >= 0.5;
  return {
    points,
    state: passed ? 'ok' : div.strength >= 0.3 ? 'near' : 'fail',
    passed,
  };
}

/** Port literal de getVerdict del v22 — ambos modos. */
function computeVerdict(grades: Grades, change: number, pumpTh: number, mode: Mode): Verdict {
  const c = {
    pump: grades.pump.passed,
    funding: grades.funding.passed,
    rsi: grades.rsi.passed,
    redCandles: grades.redCandles.passed,
    btcOk: grades.btcOk.passed,
  };

  if (mode === 'STRICT') {
    if (c.pump && c.redCandles && (c.funding || c.rsi) && c.btcOk) return 'GO_SHORT';
    if (c.pump && (c.funding || c.rsi) && !c.redCandles && c.btcOk) return 'CERCA';
    if (c.pump && c.btcOk) return 'VIGILAR';
    if (c.pump && !c.btcOk) return 'BTC_DOWN';
    return 'NONE';
  }

  // FLEX
  const techConfluence = c.redCandles && c.funding && c.rsi;
  const halfPump = change >= pumpTh * 0.5;
  if ((c.pump || (halfPump && techConfluence)) && c.redCandles && (c.funding || c.rsi) && c.btcOk) {
    return 'GO_SHORT';
  }
  if (techConfluence && c.btcOk) return 'GO_SHORT';
  if ((c.pump || halfPump) && (c.funding || c.rsi) && c.btcOk) return 'CERCA';
  if (c.pump || (halfPump && (c.funding || c.rsi))) return 'VIGILAR';
  if (c.pump && !c.btcOk) return 'BTC_DOWN';
  return 'NONE';
}
