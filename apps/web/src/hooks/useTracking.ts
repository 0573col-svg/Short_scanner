import { useCallback, useEffect, useState } from 'react';
import type { TrackedStatus, TrackedTokenView } from '@short-scanner/shared-types';
import { api } from '../lib/api';
import { getScanSocket } from '../lib/socket';

export interface UseTracking {
  tokens: TrackedTokenView[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTracking(statuses: TrackedStatus[]): UseTracking {
  const [tokens, setTokens] = useState<TrackedTokenView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = statuses.join(',');

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await api.listTracking(statuses);
      setTokens(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error desconocido');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refrescar tras cada scan (el gateway emite scan:update al final del ciclo)
  useEffect(() => {
    const socket = getScanSocket();
    const onUpdate = () => void refresh();
    socket.on('scan:update', onUpdate);
    return () => {
      socket.off('scan:update', onUpdate);
    };
  }, [refresh]);

  return { tokens, loading, error, refresh };
}
