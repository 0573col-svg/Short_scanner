import type { TrackedTokenView } from '@short-scanner/shared-types';
import { TrackedTokenRow } from './TrackedTokenRow';

interface Props {
  title: string;
  hint?: string;
  tokens: TrackedTokenView[];
  onShort?: (id: string) => void;
  onDelete?: (id: string) => void;
  busyId?: string | null;
  empty?: string;
}

export function TrackedTokenTable({
  title,
  hint,
  tokens,
  onShort,
  onDelete,
  busyId,
  empty = 'Sin tokens en esta categoría',
}: Props) {
  return (
    <section className="rounded-lg border border-line bg-bg-2">
      <header className="flex items-baseline justify-between px-4 py-3 border-b border-line">
        <h3 className="text-sm font-semibold text-zinc-100">
          {title} <span className="text-zinc-500 font-normal">({tokens.length})</span>
        </h3>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      </header>
      {tokens.length === 0 ? (
        <div className="text-center py-8 text-zinc-500 text-sm">{empty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono">
            <thead className="bg-bg-3 text-zinc-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Símbolo</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-right">Peak/Now</th>
                <th className="px-3 py-2 text-right">Peak RSI</th>
                <th className="px-3 py-2 text-right">Peak 24h</th>
                <th className="px-3 py-2 text-right">Peak $</th>
                <th className="px-3 py-2 text-right" title="Días activo (cruza medianoche UTC)">
                  Días
                </th>
                <th className="px-3 py-2 text-right" title="Scans en los que apareció">
                  Scans
                </th>
                <th className="px-3 py-2 text-right" title="Veces que reapareció tras DORMANT">
                  Reapar.
                </th>
                <th className="px-3 py-2 text-left">Última vez</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tokens.map((t) => (
                <TrackedTokenRow
                  key={t.id}
                  token={t}
                  onShort={onShort}
                  onDelete={onDelete}
                  busy={busyId === t.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
