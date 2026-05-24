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
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

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
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') statusParam?: string,
  ): Promise<TrackedTokenView[]> {
    const statuses = parseStatuses(statusParam) ?? ['ACTIVE', 'DORMANT', 'SHORTED'];
    return this.tracking.listByStatus(user.id, statuses);
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TrackedTokenView> {
    return this.tracking.getById(user.id, id);
  }

  /** Marca el tracked token como SHORTED y crea un Trade enlazado. */
  @Post(':id/short')
  async short(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { notes?: string },
  ) {
    const tracked = await this.tracking.getById(user.id, id);
    if (tracked.status === 'SHORTED' || tracked.status === 'CLOSED') {
      throw new BadRequestException(`Token ya estaba ${tracked.status}`);
    }
    const trade = await this.trades.openFromTracked(user.id, tracked, body.notes ?? null);
    const updated = await this.tracking.markShorted(user.id, id, trade.id);
    return { tracked: updated, trade };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    await this.tracking.deleteOne(user.id, id);
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
