import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import type { MaturedAlert, ScanAlert } from '@short-scanner/shared-types';
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
        kind: 'INSTANT',
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
      const payload: TelegramJobData = { kind: 'INSTANT', userId, alert, currentAlertId };
      await this.queue.add('telegram', payload, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 1000 },
      });
    } catch (err) {
      this.logger.error(`failed to enqueue alert ${jobId}`, err);
    }
  }

  /**
   * Dispatch de alerta MADURA (Fase 6). Mismo patrón fire-and-forget que
   * `dispatch()`: insert en `alerts` con kind='MATURED' (la mayoría de
   * campos del schema actual se popula desde MaturedAlert — verdict se
   * deja como 'GO_SHORT' por consistencia, passed se sintetiza desde
   * everPassedAt para retro-compat con queries existentes).
   *
   * Idempotencia: el caller (TrackingService) ya garantiza que solo
   * llama acá en la transición null→GO_SHORT y persiste `maturedAlertedAt`.
   * El jobId determinístico evita duplicados a nivel BullMQ defensivamente.
   */
  async dispatchMatured(userId: string, alert: MaturedAlert): Promise<void> {
    const currentAlertId = randomUUID();

    // Sintetizar `passed` desde everPassedAt para mantener el shape del schema:
    // si tiene timestamp, esa flag se prendió alguna vez → true.
    const passed = {
      funding: alert.everPassedAt.funding > 0,
      rsi: alert.everPassedAt.rsi > 0,
      divergence: alert.everPassedAt.divergence > 0,
      redCandles: alert.everPassedAt.redCandles > 0,
      liquidity: true, // por convención: una alerta MADURA cumplió liquidez en algún scan
    };

    this.alertsRepo
      .insert({
        id: currentAlertId,
        userId,
        symbol: alert.symbol,
        base: alert.base,
        verdict: 'GO_SHORT',
        mode: alert.mode,
        score: 100, // por convención: maduro = score conceptual máximo
        change: 0, // change24h no aplica directamente al verdict maduro
        rsi: alert.rsi,
        price: alert.price,
        vol: alert.vol,
        fundingRate: alert.fundingRate,
        redCount: alert.redCount,
        btcChange: alert.btcChange,
        passed,
        ts: new Date(alert.ts),
        kind: 'MATURED',
      })
      .catch((err) => {
        this.logger.error(
          `failed to persist matured alert (user=${userId} base=${alert.base}); continuing with dispatch`,
          err,
        );
      });

    // jobId distinto al instant: usa 'MATURED' en el lugar del verdict para
    // evitar colisión con un jobId instant del mismo símbolo en el mismo
    // bloque 4h. Por design, una alerta MADURA es única por token de por vida.
    const jobId = `tg_${userId}_${alert.symbol}_MATURED`;
    try {
      const payload: TelegramJobData = { kind: 'MATURED', userId, alert, currentAlertId };
      await this.queue.add('telegram', payload, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 1000 },
      });
    } catch (err) {
      this.logger.error(`failed to enqueue matured alert ${jobId}`, err);
    }
  }
}
