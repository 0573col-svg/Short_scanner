import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import type { ScanState } from '@short-scanner/shared-types';
import { ScannerStateStore } from './scanner.state';
import { ScannerService } from './scanner.service';
import { SettingsPatchDto } from './dto/settings-patch.dto';
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
  ) {}

  @Get('current')
  async current(@CurrentUser() user: AuthenticatedUser): Promise<ScanState> {
    const u = await this.users.getById(user.id);
    return this.state.getForUser(user.id, u.mode, u.thresholds);
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
