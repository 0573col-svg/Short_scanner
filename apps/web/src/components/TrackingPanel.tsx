import type { TrackedStatus, TrackedTokenView } from '@short-scanner/shared-types';
import { fmtActiveTime, fmtAgo, fmtPrice } from '../lib/format';

interface Props {
  tracked: TrackedTokenView | null;
  loading: boolean;
}

const STATUS_CLS: Record<TrackedStatus, string> = {
  ACTIVE: 'text-accent-green',
  DORMANT: 'text-accent-amber',
  SHORTED: 'text-accent-red',
  CLOSED: 'text-zinc-500',
  ARCHIVED: 'text-zinc-600',
};

interface FlagRow {
  label: string;
  ever: boolean;
  at: string | null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-bg-2">
      <header className="px-4 py-2.5 border-b border-line">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Tracking
        </h3>
      </header>
      {children}
    </section>
  );
}

export function TrackingPanel({ tracked, loading }: Props) {
  // Estado de carga — solo se ve el primer fetch; los refresh por scan son silenciosos.
  if (loading && !tracked) {
    return (
      <Shell>
        <div className="px-4 py-8 flex items-center justify-center text-zinc-600 text-sm">
          Cargando tracking…
        </div>
      </Shell>
    );
  }

  // No monitoreado — el token aparece en el scanner pero no cruzó el gate de entrada.
  if (!tracked) {
    return (
      <Shell>
        <div className="px-4 py-8 flex flex-col items-center justify-center gap-1 text-center">
          <span className="text-zinc-400 text-sm">Aún no monitoreado</span>
          <span className="text-zinc-600 text-xs">
            Entra a tracking al superar +50% en 24h
          </span>
        </div>
      </Shell>
    );
  }

  const t = tracked;
  const flags: FlagRow[] = [
    { label: 'RSI', ever: t.rsiEverPassed, at: t.rsiPassedAt },
    { label: 'Funding', ever: t.fundingEverPassed, at: t.fundingPassedAt },
    { label: 'Divergencia', ever: t.divergenceEverPassed, at: t.divergencePassedAt },
    { label: 'Velas rojas', ever: t.redCandlesEverPassed, at: t.redCandlesPassedAt },
  ];
  const flagsPassed = flags.filter((f) => f.ever).length;

  const peakRatio =
    t.currentPrice !== null && t.peakPrice > 0
      ? Math.round((t.currentPrice / t.peakPrice) * 100)
      : null;
  const isMatured = t.maturedVerdict !== null;

  return (
    <Shell>
      <div className="px-4 py-3 space-y-3">
        {/* Status + maduración */}
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs font-semibold ${STATUS_CLS[t.status]}`}>{t.status}</span>
          {isMatured ? (
            <span className="text-xs font-semibold text-accent-red flex items-center gap-1">
              🎯 MADURO
              <span className="text-zinc-500 font-normal">· {fmtAgo(t.maturedAt)}</span>
            </span>
          ) : (
            <span className="text-xs text-zinc-600">aún no maduro</span>
          )}
        </div>

        {/* Ever-flags — checklist de las 4 condiciones del verdict maduro */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Condiciones cumplidas
            </span>
            <span className="text-xs text-zinc-500 tabular-nums">{flagsPassed}/4</span>
          </div>
          <ul className="space-y-1">
            {flags.map((f) => (
              <li
                key={f.label}
                className="flex items-center justify-between text-sm font-mono"
              >
                <span className="flex items-center gap-2">
                  <span className="text-base leading-none">{f.ever ? '✅' : '⬜'}</span>
                  <span className={f.ever ? 'text-zinc-300' : 'text-zinc-600'}>{f.label}</span>
                </span>
                <span className="text-zinc-500 text-xs tabular-nums">
                  {f.ever ? fmtAgo(f.at) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Monitoreo + pico */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm font-mono pt-1 border-t border-line/50">
          <Stat label="En monitoreo" value={fmtActiveTime(t.activeMs)} />
          <Stat label="Detectado" value={fmtAgo(t.firstDetectedAt)} />
          <Stat label="Pico" value={`$${fmtPrice(t.peakPrice)}`} />
          <Stat
            label="% del pico"
            value={peakRatio !== null ? `${peakRatio}%` : 'n/d'}
            valueClass={
              peakRatio !== null && peakRatio >= 80 ? 'text-accent-red' : 'text-zinc-300'
            }
          />
        </div>

        {/* Stats de persistencia */}
        <div className="flex items-center gap-4 text-xs text-zinc-500 tabular-nums pt-1 border-t border-line/50">
          <span>{t.daysActive}d activo</span>
          <span>{t.scansActive} scans</span>
          <span>{t.reappearances} reaperturas</span>
        </div>
      </div>
    </Shell>
  );
}

function Stat({
  label,
  value,
  valueClass = 'text-zinc-300',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
