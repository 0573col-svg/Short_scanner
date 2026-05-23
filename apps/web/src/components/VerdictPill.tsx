import type { Verdict } from '@short-scanner/shared-types';

const LABEL: Record<Verdict, string> = {
  GO_SHORT: 'GO SHORT',
  CERCA: 'CERCA',
  VIGILAR: 'VIGILAR',
  BTC_DOWN: 'BTC ↓',
  NONE: '—',
};

const CLS: Record<Verdict, string> = {
  GO_SHORT: 'bg-accent-red/20 text-accent-red border-accent-red/40',
  CERCA: 'bg-accent-amber/20 text-accent-amber border-accent-amber/40',
  VIGILAR: 'bg-zinc-700/40 text-zinc-200 border-zinc-600',
  BTC_DOWN: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  NONE: 'bg-transparent text-zinc-600 border-zinc-800',
};

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${CLS[verdict]}`}
    >
      {LABEL[verdict]}
    </span>
  );
}
