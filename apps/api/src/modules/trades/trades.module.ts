import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeEntity } from './trade.entity';
import { TradesService } from './trades.service';
import { TradesController } from './trades.controller';
import { TrackingModule } from '../tracking/tracking.module';
import { LearningModule } from '../learning/learning.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TradeEntity]),
    forwardRef(() => TrackingModule),
    LearningModule,
  ],
  controllers: [TradesController],
  providers: [TradesService],
  exports: [TradesService],
})
export class TradesModule {}
