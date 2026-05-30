import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { KlineView, ScanState } from '@short-scanner/shared-types';
import { ScannerStateStore } from './scanner.state';
import { ScannerService } from './scanner.service';
import { SettingsPatchDto } from './dto/settings-patch.dto';
import { KlinesQueryDto } from './dto/klines-query.dto';
import { BinanceService } from '../binance/binance.service';
import { UsersService } from '../users/users.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Rate-limit per-user para /scans/run — 1 invocación cada N ms. */
const RUN_NOW_COOLDOWN_MS = 60_000;

@Controller('scans')
export class ScansController {
  private readonly lastRunByUser = new Map<string, number>();

  constructor(
    private readonly state: ScannerStateStore,
    private readonly scanner: ScannerService,
    private readonly users: UsersService,
    private readonly binance: BinanceService,
  ) {}

  /**
   * Klines OHLC para el gráfico de precio del modal de detalle (Backlog A 07.3).
   * Proxy server-side de Binance — reusa BinanceService (retry, geo-block 451,
   * timeout). El browser nunca pega a Binance directo.
   */
  @Get('klines')
  async klines(@Query() q: KlinesQueryDto): Promise<KlineView[]> {
    const klines = await this.binance.fetchKlines(q.symbol, q.interval, q.limit);
    if (klines === null) {
      throw new ServiceUnavailableException(
        `No se pudieron obtener klines de ${q.symbol} (Binance no respondió)`,
      );
    }
    // ms → segundos UTC (formato que espera lightweight-charts).
    return klines.map((k) => ({
      time: Math.floor(k.openTime / 1000),
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));
  }

  @Get('current')
  async current(@CurrentUser() user: AuthenticatedUser): Promise<ScanState> {
    const u = await this.users.getById(user.id);
    let state = this.state.getForUser(user.id, u.mode, u.thresholds);
    // Score on-demand si el user no tiene results pero hay snapshot cacheado.
    if (state.results.length === 0) {
      const populated = await this.scanner.scoreUserFromCache(user.id);
      if (populated) state = this.state.getForUser(user.id, u.mode, u.thresholds);
    }
    return state;
  }

  @Patch('settings')
  async setSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SettingsPatchDto,
  ): Promise<ScanState> {
    await this.users.updateSettings(user.id, body);
    const u = await this.users.getById(user.id);
    return this.state.getForUser(user.id, u.mode, u.thresholds);
  }

  @Post('run')
  async runNow(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true; status: 'launched' }> {
    // Rate-limit per-user: evita que un usuario martille el endpoint y agote
    // los rate-limits de Binance. El cron normal sigue corriendo cada 2 min.
    const now = Date.now();
    const last = this.lastRunByUser.get(user.id) ?? 0;
    const remainingMs = last + RUN_NOW_COOLDOWN_MS - now;
    if (remainingMs > 0) {
      throw new HttpException(
        {
          ok: false,
          status: 'rate-limited',
          message: `Espera ${Math.ceil(remainingMs / 1000)}s antes de forzar otro scan`,
          retryAfterMs: remainingMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (this.state.getGlobal().running) {
      throw new ConflictException({
        ok: false,
        status: 'already-running',
        message: 'Ya hay un scan en progreso. Espera a que termine.',
      });
    }

    this.lastRunByUser.set(user.id, now);
    void this.scanner.runScan();
    return { ok: true, status: 'launched' };
  }
}
