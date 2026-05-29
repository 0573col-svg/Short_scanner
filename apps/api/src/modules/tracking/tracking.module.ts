import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackedTokenEntity } from './tracked-token.entity';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { TradesModule } from '../trades/trades.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrackedTokenEntity]),
    forwardRef(() => TradesModule),
    AlertsModule,
  ],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
