import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@short-scanner/shared-types';
import { ScannerStateStore } from '../modules/scanner/scanner.state';

/**
 * Si el último scan exitoso fue hace más de SCAN_STALE_THRESHOLD_S,
 * el sistema se considera degradado (cron muerto, BD caída, Binance bloqueado, etc.).
 * El cron corre cada 2 min — damos margen para 1 fallo + 1 retry.
 */
const SCAN_STALE_THRESHOLD_S = 5 * 60;

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(private readonly scanState: ScannerStateStore) {}

  check(): HealthResponse {
    const now = Date.now();
    const ranAt = this.scanState.get().ranAt;
    const staleSec = ranAt === 0 ? -1 : Math.floor((now - ranAt) / 1000);

    // Grace period al boot — el primer scan tarda ~5-15s, no marcar degradado hasta pasados 60s
    const bootingGrace = (now - this.startedAt) / 1000 < 60;
    const stale = !bootingGrace && (ranAt === 0 || staleSec > SCAN_STALE_THRESHOLD_S);

    return {
      status: stale ? 'degraded' : 'ok',
      uptimeSeconds: Math.floor((now - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
      checks: {
        scannerLastRanAt: ranAt,
        scannerStaleSeconds: staleSec,
        scannerStale: stale,
      },
    };
  }
}
