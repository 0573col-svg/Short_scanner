import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BinanceModule } from '../binance/binance.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { ScoringModule } from '../scoring/scoring.module';
import { TrackingModule } from '../tracking/tracking.module';
import { AlertsModule } from '../alerts/alerts.module';
import { UsersModule } from '../users/users.module';
import { ScannerService } from './scanner.service';
import { ScannerStateStore } from './scanner.state';
import { ScansController } from './scans.controller';
import { ScansGateway } from './scans.gateway';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BinanceModule,
    IndicatorsModule,
    ScoringModule,
    TrackingModule,
    AlertsModule,
    UsersModule,
  ],
  controllers: [ScansController],
  providers: [ScannerService, ScannerStateStore, ScansGateway],
})
export class ScannerModule {}
