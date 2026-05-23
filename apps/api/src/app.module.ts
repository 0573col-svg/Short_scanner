import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'node:path';
import { HealthModule } from './health/health.module';
import { CommonModule } from './common/common.module';
import { ScannerModule } from './modules/scanner/scanner.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { TradesModule } from './modules/trades/trades.module';
import { UsersModule } from './modules/users/users.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { LearningModule } from './modules/learning/learning.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres' as const,
        url: cfg.get<string>('DATABASE_URL'),
        entities: [path.join(__dirname, '/**/*.entity{.ts,.js}')],
        migrations: [path.join(__dirname, '/migrations/*{.ts,.js}')],
        // En dev, sincronizamos para iterar rápido. En prod usaríamos migrations
        // versionadas (cambiar a synchronize: false + migrationsRun: true).
        synchronize: cfg.get('NODE_ENV') === 'development',
        migrationsRun: cfg.get('NODE_ENV') === 'production',
        logging: cfg.get('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
        extra: {
          max: 10,
          connectionTimeoutMillis: 10_000,
        },
      }),
    }),
    CommonModule,
    HealthModule,
    UsersModule,
    TelegramModule,
    AlertsModule,
    LearningModule,
    ScannerModule,
    TrackingModule,
    TradesModule,
  ],
})
export class AppModule {}
