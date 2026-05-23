import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { Kline, RawKline, Ticker24h } from './binance.types';

export interface BinanceFailureStats {
  klines: number;
  funding: number;
}

@Injectable()
export class BinanceService {
  private readonly logger = new Logger(BinanceService.name);
  private readonly spot: AxiosInstance;
  private readonly futures: AxiosInstance;
  private readonly batchSize: number;
  private failures: BinanceFailureStats = { klines: 0, funding: 0 };

  constructor(cfg: ConfigService) {
    const spotBase = cfg.get<string>('BINANCE_SPOT_BASE_URL', 'https://api.binance.com');
    const futuresBase = cfg.get<string>('BINANCE_FUTURES_BASE_URL', 'https://fapi.binance.com');
    const timeout = cfg.get<number>('BINANCE_REQUEST_TIMEOUT_MS', 8000);
    this.batchSize = cfg.get<number>('BINANCE_BATCH_SIZE', 10);

    this.spot = axios.create({ baseURL: spotBase, timeout });
    this.futures = axios.create({ baseURL: futuresBase, timeout });
    this.logger.log(`spot=${spotBase} futures=${futuresBase}`);
  }

  async fetchAll24hr(): Promise<Ticker24h[]> {
    return this.withRetry(async () => {
      const res = await this.spot.get<Ticker24h[]>('/api/v3/ticker/24hr');
      return res.data;
    });
  }

  /**
   * Reintenta hasta 2 veces con backoff exponencial + jitter (200ms, 800ms).
   * NO reintenta en 451 (geo-block — no se va a quitar reintentando).
   */
  private async withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        // 451 = bloqueo geo, no reintentable. Mensaje accionable.
        if (err instanceof AxiosError && err.response?.status === 451) {
          throw new Error(
            'Binance respondió 451 (geo-bloqueo). Si estás en US, activa VPN o usa BINANCE_SPOT_BASE_URL=https://api.binance.us en apps/api/.env',
          );
        }
        // 4xx no-transient (400, 403, 404) tampoco reintentables
        if (err instanceof AxiosError && err.response && err.response.status < 500 && err.response.status !== 429) {
          throw err;
        }
        if (attempt < retries) {
          const delay = 200 * Math.pow(4, attempt) + Math.random() * 200;
          this.logger.warn(
            `binance retry ${attempt + 1}/${retries} after ${Math.round(delay)}ms (${
              err instanceof AxiosError ? `HTTP ${err.response?.status ?? err.code}` : 'unknown'
            })`,
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }

  /** Devuelve null si Binance rechaza el símbolo o hay error transitorio. */
  async fetchKlines(symbol: string, interval = '4h', limit = 50): Promise<Kline[] | null> {
    try {
      const res = await this.spot.get<RawKline[]>('/api/v3/klines', {
        params: { symbol, interval, limit },
      });
      return res.data.map(parseKline);
    } catch (err) {
      this.failures.klines++;
      this.logQuietError('fetchKlines', symbol, err);
      return null;
    }
  }

  /** Devuelve el funding rate en porcentaje (× 100). null si el par no tiene futuros. */
  async fetchFundingRate(symbol: string): Promise<number | null> {
    try {
      const res = await this.futures.get<{ lastFundingRate?: string }>('/fapi/v1/premiumIndex', {
        params: { symbol },
      });
      const raw = res.data.lastFundingRate;
      if (raw === undefined) return null;
      const num = parseFloat(raw);
      return Number.isFinite(num) ? num * 100 : null;
    } catch (err) {
      this.failures.funding++;
      this.logQuietError('fetchFundingRate', symbol, err);
      return null;
    }
  }

  /** Lee y resetea el contador de fallos de fetchKlines/fetchFundingRate. */
  drainFailures(): BinanceFailureStats {
    const out = { ...this.failures };
    this.failures = { klines: 0, funding: 0 };
    return out;
  }

  /**
   * Procesa items en lotes de N en paralelo. Port directo de batchedMap del v22.
   * Evita saturar el rate-limit de Binance.
   */
  async batchedMap<TItem, TResult>(
    items: TItem[],
    fn: (item: TItem, index: number) => Promise<TResult>,
    batchSize: number = this.batchSize,
  ): Promise<TResult[]> {
    const out: TResult[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((item, j) => fn(item, i + j)));
      out.push(...results);
    }
    return out;
  }

  private logQuietError(op: string, symbol: string, err: unknown): void {
    if (err instanceof AxiosError) {
      this.logger.debug(`${op}(${symbol}) failed: ${err.code ?? err.response?.status}`);
    } else if (err instanceof Error) {
      this.logger.debug(`${op}(${symbol}) failed: ${err.message}`);
    }
  }
}

function parseKline(k: RawKline): Kline {
  return {
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  };
}
