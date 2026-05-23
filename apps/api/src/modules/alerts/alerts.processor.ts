import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ALERTS_QUEUE, type TelegramJobData } from './alerts.queue';
import { UsersService } from '../users/users.service';
import { TelegramService } from '../telegram/telegram.service';

@Processor(ALERTS_QUEUE, { concurrency: 5 })
export class AlertsProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertsProcessor.name);

  constructor(
    private readonly users: UsersService,
    private readonly telegram: TelegramService,
  ) {
    super();
  }

  async process(job: Job<TelegramJobData>): Promise<{ sent: boolean; reason?: string }> {
    if (job.name !== 'telegram') {
      this.logger.warn(`unknown job name: ${job.name}`);
      return { sent: false, reason: 'unknown job' };
    }
    const { userId, alert } = job.data;
    const cfg = await this.users.getDecryptedTelegram(userId);
    if (!cfg) {
      // Sin Telegram configurado → skip silenciosamente (no es error)
      return { sent: false, reason: 'no telegram config' };
    }
    // Filtrar: si las near-alerts están off, solo mandar GO_SHORT
    if (!cfg.nearAlertsEnabled && alert.verdict !== 'GO_SHORT') {
      return { sent: false, reason: 'near-alerts disabled' };
    }
    const text = this.telegram.formatAlert(alert);
    await this.telegram.send(cfg.token, cfg.chatId, text);
    return { sent: true };
  }
}
