import { useCallback, useEffect, useState } from 'react';
import type { Mode, ScoredToken, Thresholds } from '@short-scanner/shared-types';
import { useScanStream } from '../hooks/useScanStream';
import { ScannerTable } from '../components/ScannerTable';
import { ScannerToolbar } from '../components/ScannerToolbar';
import { ScanStatusBar } from '../components/ScanStatusBar';
import { AlertLog } from '../components/AlertLog';
import { ErrorBanner } from '../components/ErrorBanner';
import { TokenDetailModal } from '../components/TokenDetailModal';
import { useTrackedBySymbol } from '../hooks/useTrackedBySymbol';
import { ApiError, api } from '../lib/api';

function formatError(e: unknown): string {
  if (e instanceof ApiError) return `[${e.status}] ${e.message}`;
  if (e instanceof Error) return e.message;
  return 'error desconocido';
}

export function Scanner() {
  const { state, alerts, tick, connected, flashSet } = useScanStream();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScoredToken | null>(null);

  const onSettings = useCallback(
    async (patch: { mode?: Mode; thresholds?: Partial<Thresholds> }) => {
      try {
        await api.patchSettings(patch);
        setError(null);
      } catch (e) {
        setError(`Settings: ${formatError(e)}`);
      }
    },
    [],
  );

  const onRunNow = useCallback(async () => {
    try {
      await api.runNow();
      setError(null);
    } catch (e) {
      setError(`Run-now: ${formatError(e)}`);
    }
  }, []);

  // Re-bindea el snapshot del modal con la versión fresca de results al recibir
  // scan:update. Si el token cae del ranking, mantiene el snapshot viejo en vez
  // de cerrar el modal — el header muestra un badge "datos del último scan".
  useEffect(() => {
    if (!selected || !state?.results) return;
    const fresh = state.results.find(
      (r) => r.snapshot.symbol === selected.snapshot.symbol,
    );
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [state?.results, selected]);

  const snapshotAgeMs =
    selected && state ? state.ranAt - selected.snapshot.ts : null;
  const btcChange = state?.btc.change ?? null;

  // Resuelve la fila de tracking del token abierto por filtro client-side.
  // null cuando no hay modal abierto → el hook no hace fetch.
  const { tracked, loading: trackingLoading } = useTrackedBySymbol(
    selected?.snapshot.symbol ?? null,
  );

  return (
    <div className="space-y-4">
      <ScanStatusBar state={state} tick={tick} connected={connected} />
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {state && (
        <ScannerToolbar state={state} onChange={onSettings} onRunNow={onRunNow} />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <ScannerTable
          results={state?.results ?? []}
          flashSet={flashSet}
          onRowClick={setSelected}
        />
        <AlertLog alerts={alerts} />
      </div>
      <TokenDetailModal
        token={selected}
        btcChange={btcChange}
        snapshotAgeMs={snapshotAgeMs}
        tracking={tracked}
        trackingLoading={trackingLoading}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
