import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';
import { Public } from '../modules/auth/public.decorator';
import type { HealthResponse } from '@short-scanner/shared-types';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Devuelve 200 si el sistema está sano, 503 si el scan está stale.
   * Compatible con load balancers, k8s readiness probes, etc.
   * Público porque los healthchecks normalmente no llevan auth.
   */
  @Public()
  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  healthz(@Res({ passthrough: true }) res: Response): HealthResponse {
    const result = this.health.check();
    if (result.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE); // 503
    }
    return result;
  }
}
