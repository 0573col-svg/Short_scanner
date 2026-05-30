import { useEffect, useState } from 'react';
import type { KlineView } from '@short-scanner/shared-types';
import { api } from '../lib/api';

export interface UseKlines {
  candles: KlineView[];
  loading: boolean;
  error: string | null;
}

/**
 * Trae los klines OHLC de un símbolo vía el proxy server-side (`/scans/klines`).
 * Gateado por símbolo: si es null (modal cerrado) no hace fetch.
 *
 * Fetch on-open únicamente — un gráfico de 7 días no necesita refrescar cada
 * scan. El request se ignora si el símbolo cambia mientras está en vuelo
 * (guard `cancelled`), evitando pintar el chart de un token con datos de otro.
 */
export function useKlines(
  symbol: string | null,
  interval = '4h',
  limit = 42,
): UseKlines {
  const [candles, setCandles] = useState<KlineView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setCandles([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getKlines(symbol, interval, limit)
      .then((data) => {
        if (!cancelled) setCandles(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setCandles([]);
          setError(e instanceof Error ? e.message : 'error desconocido');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, interval, limit]);

  return { candles, loading, error };
}
