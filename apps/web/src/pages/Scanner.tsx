import { useCallback, useState } from 'react';
import type { Mode, Thresholds } from '@short-scanner/shared-types';
import { useScanStream } from '../hooks/useScanStream';
import { ScannerTable } from '../components/ScannerTable';
import { ScannerToolbar } from '../components/ScannerToolbar';
import { ScanStatusBar } from '../components/ScanStatusBar';
import { AlertLog } from '../components/AlertLog';
import { ErrorBanner } from '../components/ErrorBanner';
import { ApiError, api } from '../lib/api';

function formatError(e: unknown): string {
  if (e instanceof ApiError) return `[${e.status}] ${e.message}`;
  if (e instanceof Error) return e.message;
  return 'error desconocido';
}

export function Scanner() {
  const { state, alerts, tick, connected, flashSet } = useScanStream();
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <ScanStatusBar state={state} tick={tick} connected={connected} />
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {state && (
        <ScannerToolbar state={state} onChange={onSettings} onRunNow={onRunNow} />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <ScannerTable results={state?.results ?? []} flashSet={flashSet} />
        <AlertLog alerts={alerts} />
      </div>
    </div>
  );
}
