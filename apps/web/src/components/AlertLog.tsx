import type { ScanAlert } from '@short-scanner/shared-types';
import { fmtChange, fmtTime } from '../lib/format';
import { VerdictPill } from './VerdictPill';

export function AlertLog({ alerts }: { alerts: ScanAlert[] }) {
  if (!alerts.length) {
    return (
      <div className="rounded-lg border border-line bg-bg-2 p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">Alertas</h3>
        <p className="text-xs text-zinc-500">Sin alertas todavía.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-bg-2 p-4">
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">
        Alertas <span className="text-zinc-500 font-normal">({alerts.length})</span>
      </h3>
      <ul className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
        {alerts.map((a, i) => (
          <li
            key={`${a.symbol}-${a.ts}-${i}`}
            className="flex items-center justify-between gap-3 py-1 border-b border-line/50 last:border-0"
          >
            <span className="text-zinc-500">{fmtTime(a.ts)}</span>
            <span className="font-semibold text-zinc-100 flex-1">{a.base}</span>
            <span className="text-accent-green tabular-nums">{fmtChange(a.change)}</span>
            <span className="text-zinc-400 tabular-nums">
              RSI {a.rsi !== null ? a.rsi.toFixed(0) : '—'}
            </span>
            <span className="text-zinc-400 tabular-nums">{a.score}</span>
            <VerdictPill verdict={a.verdict} />
          </li>
        ))}
      </ul>
    </div>
  );
}
