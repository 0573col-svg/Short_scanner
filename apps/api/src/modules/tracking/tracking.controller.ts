import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  forwardRef,
} from '@nestjs/common';
import type { TrackedStatus, TrackedTokenView } from '@short-scanner/shared-types';
import { TrackingService } from './tracking.service';
import { TradesService } from '../trades/trades.service';
import { DEFAULT_USER_ID } from '../../common/single-user';

const ALL_STATUSES: TrackedStatus[] = ['ACTIVE', 'DORMANT', 'SHORTED', 'CLOSED', 'ARCHIVED'];

@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    @Inject(forwardRef(() => TradesService))
    private readonly trades: TradesService,
  ) {}

  @Get()
  async list(
    @Query('status') statusParam?: string,
  ): Promise<TrackedTokenView[]> {
    const statuses = parseStatuses(statusParam) ?? ['ACTIVE', 'DORMANT', 'SHORTED'];
    return this.tracking.listByStatus(DEFAULT_USER_ID, statuses);
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<TrackedTokenView> {
    return this.tracking.getById(DEFAULT_USER_ID, id);
  }

  /** Marca el tracked token como SHORTED y crea un Trade enlazado. */
  @Post(':id/short')
  async short(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { notes?: string },
  ) {
    const tracked = await this.tracking.getById(DEFAULT_USER_ID, id);
    if (tracked.status === 'SHORTED' || tracked.status === 'CLOSED') {
      throw new BadRequestException(`Token ya estaba ${tracked.status}`);
    }
    const trade = await this.trades.openFromTracked(DEFAULT_USER_ID, tracked, body.notes ?? null);
    const updated = await this.tracking.markShorted(DEFAULT_USER_ID, id, trade.id);
    return { tracked: updated, trade };
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.tracking.deleteOne(DEFAULT_USER_ID, id);
    return { ok: true };
  }
}

function parseStatuses(raw?: string): TrackedStatus[] | null {
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim().toUpperCase());
  for (const p of parts) {
    if (!ALL_STATUSES.includes(p as TrackedStatus)) {
      throw new BadRequestException(`status '${p}' inválido. Permitidos: ${ALL_STATUSES.join(',')}`);
    }
  }
  return parts as TrackedStatus[];
}
