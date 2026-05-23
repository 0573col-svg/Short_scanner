import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import type { ScanAlert } from '@short-scanner/shared-types';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly http: AxiosInstance;

  constructor(cfg: ConfigService) {
    const baseURL = cfg.get<string>('TELEGRAM_API_BASE_URL', 'https://api.telegram.org');
    this.http = axios.create({ baseURL, timeout: 10_000 });
  }

  async send(token: string, chatId: string, text: string): Promise<void> {
    try {
      await this.http.post(`/bot${token}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (err) {
      if (err instanceof AxiosError) {
        const code = err.response?.status;
        const desc = (err.response?.data as { description?: string } | undefined)?.description;
        this.logger.error(`telegram send failed (status=${code}): ${desc ?? err.message}`);
        // Re-throw para que BullMQ haga retry o el caller decida
        throw new Error(`Telegram API error ${code}: ${desc ?? err.message}`);
      }
      throw err;
    }
  }

  /** Formato de mensaje de alerta GO_SHORT / CERCA. */
  formatAlert(alert: ScanAlert): string {
    const emoji = alert.verdict === 'GO_SHORT' ? '🔴' : '🟡';
    const verdictText = alert.verdict === 'GO_SHORT' ? '<b>GO SHORT</b>' : '<i>CERCA</i>';
    const rsiText = alert.rsi !== null ? `RSI <b>${alert.rsi.toFixed(0)}</b>` : 'RSI —';
    const changeSign = alert.change >= 0 ? '+' : '';
    return [
      `${emoji} ${verdictText} <b>${alert.base}</b>/USDT`,
      ``,
      `Score <b>${alert.score}</b>  ·  24h <b>${changeSign}${alert.change.toFixed(2)}%</b>  ·  ${rsiText}`,
      `<i>${new Date(alert.ts).toUTCString()}</i>`,
    ].join('\n');
  }
}
