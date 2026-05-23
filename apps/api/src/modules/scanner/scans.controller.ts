import { Body, ConflictException, Controller, Get, Patch, Post } from '@nestjs/common';
import type { ScanState } from '@short-scanner/shared-types';
import { ScannerStateStore } from './scanner.state';
import { ScannerService } from './scanner.service';
import { SettingsPatchDto } from './dto/settings-patch.dto';

@Controller('scans')
export class ScansController {
  constructor(
    private readonly state: ScannerStateStore,
    private readonly scanner: ScannerService,
  ) {}

  @Get('current')
  current(): ScanState {
    return this.state.get();
  }

  @Patch('settings')
  setSettings(@Body() body: SettingsPatchDto): ScanState {
    if (body.mode) this.state.setMode(body.mode);
    if (body.thresholds) this.state.setThresholds(body.thresholds);
    return this.state.get();
  }

  @Post('run')
  async runNow(): Promise<{ ok: true; status: 'launched' }> {
    // El caso "ya corriendo" se entrega como 409 (ConflictException), NO como
    // valor de retorno. Por eso el tipo de retorno solo refleja el happy path.
    if (this.state.get().running) {
      throw new ConflictException({
        ok: false,
        status: 'already-running',
        message: 'Ya hay un scan en progreso. Espera a que termine.',
      });
    }
    // Fire-and-forget tras la verificación
    void this.scanner.runScan();
    return { ok: true, status: 'launched' };
  }
}
