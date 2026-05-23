import type { CandleColor } from '@short-scanner/shared-types';

const COLOR_CLS: Record<CandleColor, string> = {
  red: 'bg-accent-red',
  green: 'bg-accent-green',
  neutral: 'bg-zinc-600',
};

export function CandleStrip({ colors }: { colors: CandleColor[] }) {
  if (!colors.length) return <span className="text-zinc-600 text-xs">—</span>;
  return (
    <div className="flex gap-0.5 items-center">
      {colors.map((c, i) => (
        <div key={i} className={`w-1.5 h-4 rounded-sm ${COLOR_CLS[c]}`} />
      ))}
    </div>
  );
}
