import type { Grade, Grades, TokenSnapshot } from '@short-scanner/shared-types';
import { fmtChange, fmtVol } from '../lib/format';

interface Props {
  grades: Grades;
  snapshot: TokenSnapshot;
  /** % cambio 24h de BTC al momento del scan — necesario para mostrar el valor del grade btcOk. */
  btcChange: number | null;
}

type GradeKey = keyof Grades;

interface Row {
  key: GradeKey;
  label: string;
  value: string;
}

function iconFor(g: Grade): string {
  if (g.neutral) return '⚪';
  return g.passed ? '✅' : '⬜';
}

function colorFor(g: Grade): string {
  if (g.neutral) return 'text-zinc-500';
  if (g.passed) return 'text-accent-green';
  if (g.state === 'near') return 'text-accent-amber';
  return 'text-zinc-600';
}

function formatRsi(rsi: number | null): string {
  return rsi === null ? 'n/d' : rsi.toFixed(1);
}

function formatFunding(fr: number | null): string {
  if (fr === null) return 'n/d';
  const sign = fr >= 0 ? '+' : '';
  return `${sign}${fr.toFixed(3)}%`;
}

function formatDivergence(snap: TokenSnapshot): string {
  const d = snap.divergence;
  if (!d.found) return 'no detectada';
  return `detectada (fuerza ${d.strength.toFixed(2)})`;
}

function formatRedCandles(redCount: number): string {
  if (redCount === 0) return 'sin velas rojas';
  if (redCount === 1) return '1 consecutiva';
  return `${redCount} consecutivas`;
}

function formatBtcOk(btcChange: number | null): string {
  if (btcChange === null) return 'n/d';
  return fmtChange(btcChange);
}

export function GradesPanel({ grades, snapshot, btcChange }: Props) {
  const rows: Row[] = [
    { key: 'pump', label: 'Pump 24h', value: fmtChange(snapshot.change) },
    { key: 'rsi', label: 'RSI 4H', value: formatRsi(snapshot.rsi) },
    { key: 'funding', label: 'Funding rate', value: formatFunding(snapshot.fundingRate) },
    { key: 'divergence', label: 'Divergencia', value: formatDivergence(snapshot) },
    { key: 'redCandles', label: 'Velas rojas', value: formatRedCandles(snapshot.redCount) },
    { key: 'btcOk', label: 'BTC OK', value: formatBtcOk(btcChange) },
    { key: 'liquidity', label: 'Liquidez 24h', value: fmtVol(snapshot.vol) },
  ];

  return (
    <section className="rounded-lg border border-line bg-bg-2">
      <header className="px-4 py-2.5 border-b border-line">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Condiciones (7)
        </h3>
      </header>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const g = grades[r.key];
          return (
            <li
              key={r.key}
              className="px-4 py-2 flex items-center justify-between text-sm font-mono"
            >
              <span className="flex items-center gap-2">
                <span className="text-base leading-none">{iconFor(g)}</span>
                <span className="text-zinc-300">{r.label}</span>
              </span>
              <span className={`tabular-nums ${colorFor(g)}`}>{r.value}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
