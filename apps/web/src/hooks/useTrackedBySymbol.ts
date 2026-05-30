import { useCallback, useEffect, useState } from 'react';
import type { TrackedTokenView } from '@short-scanner/shared-types';
import { api } from '../lib/api';
import { getScanSocket } from '../lib/socket';

export interface UseTrackedBySymbol {
  /** Fila de tracking del símbolo, o null si no está monitoreado (no cruzó el gate +50%). */
  tracked: TrackedTokenView | null;
  loading: boolean;
  error: string | null;
}

/**
 * Resuelve la fila de tracking de un símbolo del scanner por filtro client-side
 * (Opción A — sin endpoint dedicado). Trae la lista del user vía api.listTracking
 * y busca por `symbol`. A la escala actual (tokens que superan +50% 24h) la lista
 * es chica, así que el filtro es instantáneo.
 *
 * - `symbol === null` → no hace fetch, devuelve `tracked: null`.
 * - Re-fetch en cada `scan:update` mientras haya un símbolo activo (el modal abierto),
 *   para que las Ever-flags / maduración se actualicen en vivo.
 */
export function useTrackedBySymbol(symbol: string | null): UseTrackedBySymbol {
  const [tracked, setTracked] = useState<TrackedTokenView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!symbol) return;
    try {
      setError(null);
      // Incluye SHORTED/CLOSED para que el panel siga mostrando tracking de un
      // token que el user ya shorteó, no solo ACTIVE/DORMANT.
      const list = await api.listTracking(['ACTIVE', 'DORMANT', 'SHORTED', 'CLOSED']);
      const match = list.find((t) => t.symbol === symbol) ?? null;
      setTracked(match);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error desconocido');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  // Carga inicial al abrir / cambiar de símbolo. Limpia estado si se cierra el modal.
  useEffect(() => {
    if (!symbol) {
      setTracked(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
  }, [symbol, refresh]);

  // Refrescar tras cada scan mientras el modal esté abierto.
  useEffect(() => {
    if (!symbol) return;
    const socket = getScanSocket();
    const onUpdate = () => void refresh();
    socket.on('scan:update', onUpdate);
    return () => {
      socket.off('scan:update', onUpdate);
    };
  }, [symbol, refresh]);

  return { tracked, loading, error };
}
