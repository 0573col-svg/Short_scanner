import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import type { OtherTodayAlert } from '@short-scanner/shared-types';
import { ALERTS_QUEUE, type TelegramJobData } from './alerts.queue';
import { AlertsHistoryService } from './alerts.history.service';
import { UsersService } from '../users/users.service';
import { TelegramService } from '../telegram/telegram.service';

@Processor(ALERTS_QUEUE, { concurrency: 5 })
export class AlertsProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertsProcessor.name);

  constructor(
    private readonly users: UsersService,
    private readonly telegram: TelegramService,
    private readonly history: AlertsHistoryService,
  ) {
    super();
  }

  async process(job: Job<TelegramJobData>): Promise<{ sent: boolean; reason?: string }> {
    if (job.name !== 'telegram') {
      this.logger.warn(`unknown job name: ${job.name}`);
      return { sent: false, reason: 'unknown job' };
    }
    const { userId, alert, currentAlertId } = job.data;
    const cfg = await this.users.getDecryptedTelegram(userId);
    if (!cfg) {
      // Sin Telegram configurado → skip silenciosamente (no es error)
      return { sent: false, reason: 'no telegram config' };
    }
    // Filtrar: si las near-alerts están off, solo mandar GO_SHORT
    if (!cfg.nearAlertsEnabled && alert.verdict !== 'GO_SHORT') {
      return { sent: false, reason: 'near-alerts disabled' };
    }

    // Fase 3: traer "Otros del día" para enriquecer el mensaje. Si la query
    // falla, log + array vacío → el mensaje sale sin la sección extra.
    let othersToday: OtherTodayAlert[] = [];
    try {
      othersToday = await this.history.getOthersToday(userId, currentAlertId);
    } catch (err) {
      this.logger.error(
        `getOthersToday failed for user ${userId}; sending alert without "Otros del día"`,
        err,
      );
    }

    const text = this.telegram.formatAlert(alert, othersToday);
    await this.telegram.send(cfg.token, cfg.chatId, text);
    return { sent: true };
  }
}
