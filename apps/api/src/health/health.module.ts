import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ScannerModule } from '../modules/scanner/scanner.module';

@Module({
  imports: [ScannerModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
