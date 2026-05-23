import { useCallback, useMemo, useState } from 'react';
import { useTracking } from '../hooks/useTracking';
import { TrackedTokenTable } from '../components/TrackedTokenTable';
import { ErrorBanner } from '../components/ErrorBanner';
import { ApiError, api } from '../lib/api';

function fmtErr(e: unknown): string {
  if (e instanceof ApiError) return `[${e.status}] ${e.message}`;
  if (e instanceof Error) return e.message;
  return 'error desconocido';
}

export function Watchlist() {
  const { tokens, loading, error: fetchError, refresh } = useTracking([
    'ACTIVE',
    'DORMANT',
    'SHORTED',
    'ARCHIVED',
    'CLOSED',
  ]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { active, dormant, shorted, archived, closed } = useMemo(() => {
    const groups = { active: [], dormant: [], shorted: [], archived: [], closed: [] } as Record<
      string,
      typeof tokens
    >;
    for (const t of tokens) {
      const key = t.status.toLowerCase();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (groups as any)[key]?.push(t);
    }
    return groups as {
      active: typeof tokens;
      dormant: typeof tokens;
      shorted: typeof tokens;
      archived: typeof tokens;
      closed: typeof tokens;
    };
  }, [tokens]);

  const handleShort = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await api.openShort(id);
        setActionError(null);
        await refresh();
      } catch (e) {
        setActionError(`Short: ${fmtErr(e)}`);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('¿Descartar este token del tracking?')) return;
      setBusyId(id);
      try {
        await api.deleteTracked(id);
        setActionError(null);
        await refresh();
      } catch (e) {
        setActionError(`Delete: ${fmtErr(e)}`);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  if (loading && !tokens.length) {
    return <div className="text-center py-12 text-zinc-500 text-sm">Cargando watchlist...</div>;
  }

  return (
    <div className="space-y-6">
      <ErrorBanner
        message={fetchError ?? actionError}
        onDismiss={() => {
          setActionError(null);
        }}
      />

      <TrackedTokenTable
        title="Activos"
        hint="Pumpeando en el último scan"
        tokens={active}
        onShort={handleShort}
        onDelete={handleDelete}
        busyId={busyId}
        empty="Ningún token activo. Espera al próximo scan o ajusta los thresholds."
      />

      <TrackedTokenTable
        title="En vigilancia"
        hint="DORMANT — salieron del top, podrían reaparecer"
        tokens={dormant}
        onShort={handleShort}
        onDelete={handleDelete}
        busyId={busyId}
        empty="Nada dormido."
      />

      {shorted.length > 0 && (
        <TrackedTokenTable
          title="Posiciones abiertas (SHORTED)"
          hint="Trades en curso vinculados a estos tokens"
          tokens={shorted}
          busyId={busyId}
        />
      )}

      {(archived.length > 0 || closed.length > 0) && (
        <TrackedTokenTable
          title="Histórico"
          hint="ARCHIVED + CLOSED (post-mortem)"
          tokens={[...closed, ...archived]}
          busyId={busyId}
          empty=""
        />
      )}
    </div>
  );
}
