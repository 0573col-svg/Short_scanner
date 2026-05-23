import { useMemo, useState } from 'react';
import type { ScoredToken, Verdict } from '@short-scanner/shared-types';
import { fmtChange, fmtPrice, fmtVol } from '../lib/format';
import { CandleStrip } from './CandleStrip';
import { ScoreCell } from './ScoreCell';
import { VerdictPill } from './VerdictPill';

interface Props {
  results: ScoredToken[];
  flashSet: Set<string>;
}

const ROW_BG: Record<Verdict, string> = {
  GO_SHORT: 'bg-accent-red/10 hover:bg-accent-red/15',
  CERCA: 'bg-accent-amber/5 hover:bg-accent-amber/10',
  VIGILAR: 'hover:bg-zinc-800/40',
  BTC_DOWN: 'opacity-60 hover:bg-zinc-800/30',
  NONE: 'opacity-40 hover:bg-zinc-800/30',
};

type SortColumn = 'change' | 'vol';
type SortState = { column: SortColumn; dir: 'desc' | 'asc' } | null;

const ACCESSORS: Record<SortColumn, (r: ScoredToken) => number> = {
  change: (r) => r.snapshot.change,
  vol: (r) => r.snapshot.vol,
};

export function ScannerTable({ results, flashSet }: Props) {
  const [sort, setSort] = useState<SortState>(null);

  const displayed = useMemo(() => {
    if (!sort) return results;
    const accessor = ACCESSORS[sort.column];
    const arr = [...results];
    arr.sort((a, b) =>
      sort.dir === 'desc' ? accessor(b) - accessor(a) : accessor(a) - accessor(b),
    );
    return arr;
  }, [results, sort]);

  /**
   * Cycle por columna:
   *  - columna distinta → empezar en desc (mayor a menor)
   *  - misma columna desc → cambiar a asc
   *  - misma columna asc → volver al orden por defecto del servidor
   */
  const cycle = (column: SortColumn) =>
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, dir: 'desc' };
      if (prev.dir === 'desc') return { column, dir: 'asc' };
      return null;
    });

  if (!results.length) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        Sin datos aún — esperando el primer scan...
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-bg-2">
      <table className="w-full text-sm font-mono">
        <thead className="bg-bg-3 text-zinc-400 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Símbolo</th>
            <th className="px-3 py-2 text-right">Precio</th>
            <SortableTh label="24h" column="change" sort={sort} onClick={cycle} />
            <SortableTh label="Vol" column="vol" sort={sort} onClick={cycle} />
            <th className="px-3 py-2 text-right">FR</th>
            <th className="px-3 py-2 text-right">RSI</th>
            <th className="px-3 py-2 text-left">Velas 4H</th>
            <th className="px-3 py-2 text-left">Score</th>
            <th className="px-3 py-2 text-left">Verdict</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {displayed.map((r, i) => {
            const flashing = flashSet.has(r.snapshot.symbol);
            return (
              <tr
                key={r.snapshot.symbol}
                className={`${ROW_BG[r.verdict]} ${flashing ? 'animate-pulse ring-2 ring-accent-red ring-inset' : ''} transition`}
              >
                <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                <td className="px-3 py-2">
                  <span className="text-zinc-100 font-semibold">{r.snapshot.base}</span>
                  <span className="text-zinc-600 text-xs">/USDT</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">${fmtPrice(r.snapshot.price)}</td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    r.snapshot.change >= 0 ? 'text-accent-green' : 'text-accent-red'
                  }`}
                >
                  {fmtChange(r.snapshot.change)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-400 tabular-nums">
                  {fmtVol(r.snapshot.vol)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.snapshot.fundingRate === null ? (
                    <span className="text-zinc-600">—</span>
                  ) : (
                    <span
                      className={
                        r.snapshot.fundingRate >= 0.05
                          ? 'text-accent-red'
                          : r.snapshot.fundingRate > 0
                            ? 'text-accent-amber'
                            : 'text-accent-green'
                      }
                    >
                      {r.snapshot.fundingRate >= 0 ? '+' : ''}
                      {r.snapshot.fundingRate.toFixed(3)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.snapshot.rsi === null ? (
                    <span className="text-zinc-600">—</span>
                  ) : (
                    <span
                      className={
                        r.snapshot.rsi >= 80
                          ? 'text-accent-red'
                          : r.snapshot.rsi >= 70
                            ? 'text-accent-amber'
                            : 'text-zinc-300'
                      }
                    >
                      {r.snapshot.rsi.toFixed(0)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <CandleStrip colors={r.snapshot.candleColors} />
                </td>
                <td className="px-3 py-2 w-32">
                  <ScoreCell score={r.score} />
                </td>
                <td className="px-3 py-2">
                  <VerdictPill verdict={r.verdict} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface SortableThProps {
  label: string;
  column: SortColumn;
  sort: SortState;
  onClick: (column: SortColumn) => void;
}

function SortableTh({ label, column, sort, onClick }: SortableThProps) {
  const active = sort?.column === column;
  const arrow = active ? (sort.dir === 'desc' ? '↓' : '↑') : '⇅';
  return (
    <th className="px-3 py-2 text-right">
      <button
        type="button"
        onClick={() => onClick(column)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition hover:text-zinc-100 ${
          active ? 'text-accent-amber' : ''
        }`}
        title={`Ordenar por ${label} (click cicla: ↓ → ↑ → default)`}
      >
        {label}
        <span className={`w-2 text-right ${active ? '' : 'text-zinc-600'}`}>{arrow}</span>
      </button>
    </th>
  );
}
