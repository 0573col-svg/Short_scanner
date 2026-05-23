import type { TrackedTokenView } from '@short-scanner/shared-types';
import { fmtChange, fmtPrice, fmtTime } from '../lib/format';

interface Props {
  token: TrackedTokenView;
  onShort?: (id: string) => void;
  onDelete?: (id: string) => void;
  busy?: boolean;
}

const STATUS_CLS: Record<TrackedTokenView['status'], string> = {
  ACTIVE: 'text-accent-green',
  DORMANT: 'text-accent-amber',
  SHORTED: 'text-accent-red',
  CLOSED: 'text-zinc-500',
  ARCHIVED: 'text-zinc-600',
};

export function TrackedTokenRow({ token: t, onShort, onDelete, busy }: Props) {
  const overextendedDays = t.daysActive >= 3;

  return (
    <tr className="hover:bg-zinc-800/40 transition">
      <td className="px-3 py-2">
        <span className="text-zinc-100 font-semibold">{t.base}</span>
        <span className="text-zinc-600 text-xs">/USDT</span>
      </td>
      <td className="px-3 py-2">
        <span className={`text-xs font-semibold ${STATUS_CLS[t.status]}`}>{t.status}</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className="text-zinc-100">{t.peakScore}</span>
        {t.currentScore !== null && t.currentScore !== t.peakScore && (
          <span className="text-zinc-500 text-xs"> / {t.currentScore}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
        {t.peakRsi.toFixed(0)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-accent-green">
        {fmtChange(t.peakChange24h)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
        ${fmtPrice(t.peakPrice)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className={overextendedDays ? 'text-accent-red font-semibold' : 'text-zinc-400'}>
          {t.daysActive}d
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{t.scansActive}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className={t.reappearances >= 2 ? 'text-accent-amber font-semibold' : 'text-zinc-500'}>
          {t.reappearances}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-zinc-500">{fmtTime(new Date(t.lastSeenPumpingAt).getTime())}</td>
      <td className="px-3 py-2 text-right">
        <div className="flex gap-2 justify-end">
          {onShort && (t.status === 'ACTIVE' || t.status === 'DORMANT') && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onShort(t.id)}
              className="px-2 py-1 text-xs font-semibold bg-accent-red hover:bg-accent-red/90 text-white rounded transition disabled:opacity-50"
            >
              Short
            </button>
          )}
          {onDelete && t.status !== 'SHORTED' && t.status !== 'CLOSED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(t.id)}
              className="px-2 py-1 text-xs text-zinc-500 hover:text-accent-red transition"
              title="Descartar (no me interesa)"
            >
              ×
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
