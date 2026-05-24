import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  forwardRef,
} from '@nestjs/common';
import type { TradeView } from '@short-scanner/shared-types';
import { TradesService } from './trades.service';
import { TrackingService } from '../tracking/tracking.service';
import { LearningService } from '../learning/learning.service';
import { CloseTradeDto } from './dto/close-trade.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@Controller('trades')
export class TradesController {
  private readonly logger = new Logger(TradesController.name);

  constructor(
    private readonly trades: TradesService,
    @Inject(forwardRef(() => TrackingService))
    private readonly tracking: TrackingService,
    private readonly learning: LearningService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<TradeView[]> {
    return this.trades.list(user.id);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TradeView> {
    return this.trades.getById(user.id, id);
  }

  @Patch(':id/close')
  async close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CloseTradeDto,
  ): Promise<TradeView> {
    const trade = await this.trades.close(user.id, id, body.result, body.notes);
    // Sincronizar el tracked token al estado CLOSED
    if (trade.trackedTokenId) {
      await this.tracking.markClosed(user.id, trade.trackedTokenId);
    }
    // Disparar learning — el próximo scan usará los pesos recalibrados.
    // NO bloqueamos la respuesta: el cierre del trade fue lo que el usuario pidió.
    void this.learning.recalculate(user.id).catch((err) => {
      this.logger.error('learning recalculate failed (silent)', err);
    });
    return trade;
  }
}
