import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { ScanAlert } from '@short-scanner/shared-types';
import { ALERTS_QUEUE, type TelegramJobData } from './alerts.queue';

@Injectable()
export class AlertDispatcher {
  private readonly logger = new Logger(AlertDispatcher.name);

  constructor(
    @InjectQueue(ALERTS_QUEUE)
    private readonly queue: Queue<TelegramJobData>,
  ) {}

  async dispatch(userId: string, alert: ScanAlert): Promise<void> {
    // jobId determinístico por (user, symbol, block, verdict) para dedupe natural
    const block4h = Math.floor(alert.ts / (4 * 3600 * 1000));
    const jobId = `tg_${userId}_${alert.symbol}_${alert.verdict}_${block4h}`;
    try {
      await this.queue.add(
        'telegram',
        { userId, alert },
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
