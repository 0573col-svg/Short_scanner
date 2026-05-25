import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import type { ScanAlert } from '@short-scanner/shared-types';
import { ALERTS_QUEUE, type TelegramJobData } from './alerts.queue';
import { AlertEntity } from './alert.entity';

@Injectable()
export class AlertDispatcher {
  private readonly logger = new Logger(AlertDispatcher.name);

  constructor(
    @InjectQueue(ALERTS_QUEUE)
    private readonly queue: Queue<TelegramJobData>,
    @InjectRepository(AlertEntity)
    private readonly alertsRepo: Repository<AlertEntity>,
  ) {}

  async dispatch(userId: string, alert: ScanAlert): Promise<void> {
    // UUID pre-generado client-side: el insert es fire-and-forget pero igual
    // necesitamos el id sincrónicamente para pasarlo en el payload de BullMQ
    // (el processor lo usa para excluir esta alerta de "Otros del día" — Fase 3).
    const currentAlertId = randomUUID();

    // 1. Persistir SIEMPRE — fire-and-forget. Si la BD falla, se loguea pero NO
    //    bloquea el envío a Telegram. La alerta vive en BD aunque el bot esté caído.
    this.alertsRepo
      .insert({
        id: currentAlertId,
        userId,
        symbol: alert.symbol,
        base: alert.base,
        verdict: alert.verdict,
        mode: alert.mode,
        score: alert.score,
        change: alert.change,
        rsi: alert.rsi,
        price: alert.price,
        vol: alert.vol,
        fundingRate: alert.fundingRate,
        redCount: alert.redCount,
        btcChange: alert.btcChange,
        passed: alert.passed,
        ts: new Date(alert.ts),
      })
      .catch((err) => {
        this.logger.error(
          `failed to persist alert (user=${userId} base=${alert.base}); continuing with dispatch`,
          err,
        );
      });

    // 2. Encolar para envío a Telegram. jobId determinístico por
    //    (user, symbol, block, verdict) para dedupe natural en BullMQ.
    const block4h = Math.floor(alert.ts / (4 * 3600 * 1000));
    const jobId = `tg_${userId}_${alert.symbol}_${alert.verdict}_${block4h}`;
    try {
      await this.queue.add(
        'telegram',
        { userId, alert, currentAlertId },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400, count: 1000 },
        },
      );
    } catch (err) {
      this.logger.error(`failed to enqueue alert ${jobId}`, err);
    }
  }
}
