export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  uptimeSeconds: number;
  version: string;
  timestamp: string;
  checks: {
    /** Última vez que un scan se completó (epoch ms). 0 = nunca. */
    scannerLastRanAt: number;
    /** Segundos desde el último scan. -1 si nunca. */
    scannerStaleSeconds: number;
    /** True si scannerStaleSeconds excede el umbral (5 min) o nunca corrió */
    scannerStale: boolean;
  };
}
