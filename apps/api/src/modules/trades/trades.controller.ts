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
import { DEFAULT_USER_ID } from '../../common/single-user';

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
  list(): Promise<TradeView[]> {
    return this.trades.list(DEFAULT_USER_ID);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<TradeView> {
    return this.trades.getById(DEFAULT_USER_ID, id);
  }

  @Patch(':id/close')
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CloseTradeDto,
  ): Promise<TradeView> {
    const trade = await this.trades.close(DEFAULT_USER_ID, id, body.result, body.notes);
    // Sincronizar el tracked token al estado CLOSED
    if (trade.trackedTokenId) {
      await this.tracking.markClosed(DEFAULT_USER_ID, trade.trackedTokenId);
    }
    // Disparar learning — el próximo scan usará los pesos recalibrados.
    // NO bloqueamos la respuesta: el cierre del trade fue lo que el usuario pidió.
    void this.learning.recalculate(DEFAULT_USER_ID).catch((err) => {
      this.logger.error('learning recalculate failed (silent)', err);
    });
    return trade;
  }
}
