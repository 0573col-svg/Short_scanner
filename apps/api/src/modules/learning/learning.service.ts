import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import type { Grade, Grades, Weights } from '@short-scanner/shared-types';
import { TradeEntity } from '../trades/trade.entity';
import { UsersService } from '../users/users.service';
import { DEFAULT_WEIGHTS } from '../scoring/scoring.constants';

/** Mínimo de trades cerrados para que el learning corra (igual que v22). */
const MIN_CLOSED_TRADES = 3;

/** Total al que la suma de pesos se mantiene (igual que el default). */
const TOTAL_WEIGHT = sumWeights(DEFAULT_WEIGHTS);

/** Clamps por peso: evitamos que un condition se vuelva 0 o monopolice. */
const WEIGHT_MIN = 1;
const WEIGHT_MAX = 50;

/** Win-rate default cuando no hay datos para esa condición. */
const NEUTRAL_WINRATE = 0.5;

const CONDITION_KEYS: Array<keyof Grades> = [
  'pump',
  'funding',
  'rsi',
  'divergence',
  'redCandles',
  'btcOk',
  'liquidity',
];

interface RecalculateResult {
  applied: boolean;
  reason?: string;
  trades: number;
  /** Win-rate por condición (entre los trades donde esa condición fue passed=true) */
  winRates?: Record<string, number>;
  /** Pesos resultantes después de normalizar y clampear */
  newWeights?: Weights;
}

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    @InjectRepository(TradeEntity)
    private readonly trades: Repository<TradeEntity>,
    private readonly users: UsersService,
  ) {}

  /**
   * Port de v22:recalculateWeights, ahora por usuario.
   *
   * Algoritmo:
   *  1. Cargar trades cerrados con resultado registrado.
   *  2. Si < MIN_CLOSED_TRADES, no aplicar (no hay suficiente señal).
   *  3. Para cada condición, calcular win-rate entre trades donde passed=true.
   *  4. Normalizar para que sumen TOTAL_WEIGHT (preservando proporciones).
   *  5. Clampear a [WEIGHT_MIN, WEIGHT_MAX] y re-normalizar el residual.
   *  6. Guardar en User.weights.
   *
   * Devuelve diagnostics para logs / UI.
   */
  async recalculate(userId: string): Promise<RecalculateResult> {
    const closed = await this.trades.find({
      where: { userId, result: Not(IsNull()) },
    });
    // Filtrar a mano los que tienen grades en el snapshot
    const usable = closed.filter((t) => {
      if (!t.result || !t.closedAt) return false;
      const grades = (t.entrySnapshot as { grades?: unknown })?.grades;
      return grades && typeof grades === 'object';
    });

    if (usable.length < MIN_CLOSED_TRADES) {
      return {
        applied: false,
        reason: `solo ${usable.length}/${MIN_CLOSED_TRADES} trades cerrados con grades`,
        trades: usable.length,
      };
    }

    // 1. Win-rate por condición
    const winRates: Record<string, number> = {};
    for (const cond of CONDITION_KEYS) {
      let passed = 0;
      let wins = 0;
      for (const t of usable) {
        const grades = (t.entrySnapshot as { grades?: Grades }).grades;
        const grade: Grade | undefined = grades?.[cond];
        if (!grade?.passed) continue;
        passed++;
        if (t.result === 'WIN') wins++;
      }
      winRates[cond] = passed > 0 ? wins / passed : NEUTRAL_WINRATE;
    }

    // 2. Normalizar a TOTAL_WEIGHT proporcionalmente al win-rate
    const totalWr = CONDITION_KEYS.reduce((s, c) => s + winRates[c]!, 0);
    const raw: Record<string, number> = {};
    for (const cond of CONDITION_KEYS) {
      raw[cond] = (winRates[cond]! / totalWr) * TOTAL_WEIGHT;
    }

    // 3. Clamps + re-normalización del residual
    const clamped = clampAndNormalize(raw, TOTAL_WEIGHT);
    const newWeights = recordToWeights(clamped);

    await this.users.updateWeights(userId, newWeights);
    this.logger.log(
      `weights actualizados (${usable.length} trades): ${formatWeights(newWeights)}`,
    );

    return {
      applied: true,
      trades: usable.length,
      winRates,
      newWeights,
    };
  }
}

/* ───────────────── helpers ───────────────── */

function sumWeights(w: Weights): number {
  return (
    w.pump + w.funding + w.rsi + w.divergence + w.redCandles + w.btcOk + w.liquidity
  );
}

function recordToWeights(r: Record<string, number>): Weights {
  return {
    pump: r.pump ?? 0,
    funding: r.funding ?? 0,
    rsi: r.rsi ?? 0,
    divergence: r.divergence ?? 0,
    redCandles: r.redCandles ?? 0,
    btcOk: r.btcOk ?? 0,
    liquidity: r.liquidity ?? 0,
  };
}

function formatWeights(w: Weights): string {
  return CONDITION_KEYS.map((k) => `${k}=${(w as unknown as Record<string, number>)[k]}`).join(
    ' · ',
  );
}

/**
 * Clampea cada peso a [WEIGHT_MIN, WEIGHT_MAX], redondea, y ajusta el residual
 * para que la suma final sea exactamente target.
 */
function clampAndNormalize(
  raw: Record<string, number>,
  target: number,
): Record<string, number> {
  // 1. Clamp
  const clamped: Record<string, number> = {};
  for (const k of Object.keys(raw)) {
    clamped[k] = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, raw[k]!));
  }
  // 2. Redondear
  const rounded: Record<string, number> = {};
  for (const k of Object.keys(clamped)) {
    rounded[k] = Math.round(clamped[k]!);
  }
  // 3. Ajustar suma: añadir/quitar al peso más grande respetando el clamp
  let diff = target - Object.values(rounded).reduce((s, v) => s + v, 0);
  if (diff !== 0) {
    const entries = Object.entries(rounded).sort((a, b) => b[1] - a[1]);
    for (const [k] of entries) {
      const cur = rounded[k]!;
      const step = diff > 0 ? 1 : -1;
      const next = cur + step;
      if (next < WEIGHT_MIN || next > WEIGHT_MAX) continue;
      rounded[k] = next;
      diff -= step;
      if (diff === 0) break;
    }
  }
  return rounded;
}
