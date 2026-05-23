import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ALERTS_QUEUE } from './alerts.queue';
import { AlertsProcessor } from './alerts.processor';
import { AlertDispatcher } from './alert-dispatcher.service';
import { UsersModule } from '../users/users.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const url = cfg.get<string>('REDIS_URL', 'redis://localhost:6380');
        const u = new URL(url);
        return {
          connection: {
            host: u.hostname,
            port: parseInt(u.port || '6379', 10),
            password: u.password || undefined,
            username: u.username || undefined,
            // Aceptar TLS si la URL es rediss://
            tls: u.protocol === 'rediss:' ? {} : undefined,
          },
          defaultJobOptions: {
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 86400, count: 1000 },
          },
        };
      },
    }),
    BullModule.registerQueue({ name: ALERTS_QUEUE }),
    UsersModule,
    TelegramModule,
  ],
  providers: [AlertsProcessor, AlertDispatcher],
  exports: [AlertDispatcher],
})
export class AlertsModule {}
