import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@short-scanner/shared-types';

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  check(): HealthResponse {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }
}
