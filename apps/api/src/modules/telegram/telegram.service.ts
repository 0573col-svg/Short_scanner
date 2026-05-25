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

  /** Formato de mensaje de alerta GO_SHORT / CERCA — plantilla rica (Fase 1). */
  formatAlert(alert: ScanAlert): string {
    const headerEmoji = alert.verdict === 'GO_SHORT' ? '🔴' : '🔵';
    const verdictLabel = alert.verdict === 'GO_SHORT' ? 'GO SHORT' : 'CERCA';
    const modeLabel = alert.mode === 'FLEX' ? 'Flexible' : 'Strict';

    // Minutos hasta el próximo cierre de vela 4H (alineadas a 00,04,08,12,16,20 UTC)
    const FOUR_H_MS = 4 * 3600 * 1000;
    const nowMs = Date.now();
    const nextCloseMs = (Math.floor(nowMs / FOUR_H_MS) + 1) * FOUR_H_MS;
    const minutesLeft = Math.ceil((nextCloseMs - nowMs) / 60_000);

    return [
      `${headerEmoji} <b>${verdictLabel}</b> — <b>${esc(alert.base)}</b>`,
      `⚙️ Modo: ${modeLabel}`,
      ``,
      `💰 Precio: $${fmtPrice(alert.price)}`,
      `📊 24h: ${fmtSignedPct(alert.change, 2)}`,
      `📊 Score: ${alert.score}/100`,
      ``,
      `${checkbox(alert.passed.funding)} Funding: ${fmtFunding(alert.fundingRate)}`,
      `${checkbox(alert.passed.rsi)} RSI 4h: ${fmtRsi(alert.rsi)}`,
      `${checkbox(alert.passed.divergence)} Divergencia: ${alert.passed.divergence ? 'sí' : 'no'}`,
      `${checkbox(alert.passed.redCandles)} Velas rojas: ${alert.redCount} (cerradas)`,
      `📊 BTC: ${fmtSignedPct(alert.btcChange, 2)}`,
      `${checkbox(alert.passed.liquidity)} Volumen: ${fmtVol(alert.vol)}`,
      ``,
      `⏰ Cierre vela 4H en: ${fmtMinutes(minutesLeft)}`,
    ].join('\n');
  }
}

// ── Helpers de formato ───────────────────────────────────────────

/** Escape HTML para safe usage con parse_mode=HTML. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function checkbox(passed: boolean): string {
  return passed ? '✅' : '⬜';
}

function fmtSignedPct(n: number, digits: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtFunding(fr: number | null): string {
  if (fr === null) return '—';
  return fmtSignedPct(fr * 100, 3);
}

function fmtRsi(r: number | null): string {
  return r === null ? '—' : r.toFixed(0);
}

function fmtPrice(p: number): string {
  if (p >= 1) return p.toFixed(4);
  if (p < 0.001) return p.toExponential(2);
  return p.toFixed(6);
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}min`;
}
