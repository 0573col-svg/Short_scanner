import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'node:path';
import { HealthModule } from './health/health.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
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
        // Migrations versionadas siempre. Cualquier cambio de schema requiere
        // `pnpm migration:generate <Name>` y commit del archivo generado.
        synchronize: false,
        migrationsRun: true,
        logging: cfg.get('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
        // Reintentos al boot — clave si Postgres tarda en levantarse (docker stack)
        retryAttempts: 10,
        retryDelay: 3000,
        extra: {
          max: 10,
          connectionTimeoutMillis: 10_000,
        },
      }),
    }),
    CommonModule,
    AuthModule,
    HealthModule,
    UsersModule,
    TelegramModule,
    AlertsModule,
    LearningModule,
    ScannerModule,
    TrackingModule,
    TradesModule,
  ],
  providers: [
    // Auth global: todos los endpoints requieren JWT salvo @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
