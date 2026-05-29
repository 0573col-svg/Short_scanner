import type { MaturedAlert } from '@short-scanner/shared-types';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';

function makeService() {
  const cfg = { get: jest.fn().mockReturnValue('https://api.telegram.org') } as unknown as ConfigService;
  return new TelegramService(cfg);
}

const HOUR = 3600 * 1000;

describe('TelegramService.formatMaturedAlert', () => {
  it('renderiza la variante A aprobada con peak price', () => {
    const svc = makeService();
    const now = Date.now();
    const alert: MaturedAlert = {
      symbol: 'XANUSDT',
      base: 'XAN',
      ts: now,
      mode: 'FLEX',
      price: 0.04532,
      peakPrice: 0.0521,
      vol: 20_000_000,
      rsi: 82,
      fundingRate: 0.055,
      redCount: 2,
      btcChange: -0.5,
      everPassedAt: {
        rsi: now - 18 * HOUR,
        funding: now - 12 * HOUR,
        divergence: now - 6 * HOUR,
        redCandles: now - 30_000, // hace 0 min = "recién"
      },
      firstDetectedAt: now - 22 * HOUR,
      activeMs: 22 * HOUR,
    };

    const text = svc.formatMaturedAlert(alert);
    // Sanity: header maduro, no GO SHORT / CERCA
    expect(text).toContain('🎯 <b>MADURO</b> — <b>XAN</b>');
    // Línea de precio con ratio + peak en paréntesis (tweak del user)
    // ratio = round(0.04532 / 0.0521 * 100) = round(86.99%) = 87
    expect(text).toContain('💰 Precio: $0.045320 (87% del pico $0.052100)');
    // Tiempo activo en horas (>= 1h, no fmtActiveTime en minutes)
    expect(text).toContain('⏱️ En monitoreo: 22h activas');
    // Bloque de condiciones cumplidas
    expect(text).toContain('<b>Condiciones cumplidas:</b>');
    expect(text).toContain('✅ RSI 4h (hace 18h)');
    expect(text).toContain('✅ Funding (hace 12h)');
    expect(text).toContain('✅ Divergencia (hace 6h)');
    expect(text).toContain('✅ Velas rojas (recién)');
    // Bloque de Volumen + BTC + Cierre 4H (consistencia con instant)
    expect(text).toContain('📊 Volumen: 20.0M');
    expect(text).toContain('📊 BTC: -0.50%');
    expect(text).toContain('⏰ Cierre vela 4H en:');
    // NO debe aparecer score ni los checkboxes individuales del instant
    expect(text).not.toContain('Score:');
    expect(text).not.toContain('⬜');
  });

  it('fmtActiveTime usa minutos cuando activeMs < 1h (QA con window comprimido)', () => {
    const svc = makeService();
    const now = Date.now();
    const alert: MaturedAlert = {
      symbol: 'XYZUSDT',
      base: 'XYZ',
      ts: now,
      mode: 'STRICT',
      price: 1,
      peakPrice: 1.1,
      vol: 5e6,
      rsi: 80,
      fundingRate: 0.06,
      redCount: 2,
      btcChange: 0,
      everPassedAt: { rsi: now, funding: now, divergence: now, redCandles: now },
      firstDetectedAt: now - 4 * 60 * 1000,
      activeMs: 4 * 60 * 1000, // 4 minutos
    };
    const text = svc.formatMaturedAlert(alert);
    expect(text).toContain('⏱️ En monitoreo: 4min activas');
  });

  it('agrega sección "Otros del día" si hay items', () => {
    const svc = makeService();
    const now = Date.now();
    const alert: MaturedAlert = {
      symbol: 'XANUSDT',
      base: 'XAN',
      ts: now,
      mode: 'FLEX',
      price: 0.04,
      peakPrice: 0.05,
      vol: 5e6,
      rsi: 80,
      fundingRate: 0.05,
      redCount: 2,
      btcChange: 0,
      everPassedAt: { rsi: now, funding: now, divergence: now, redCandles: now },
      firstDetectedAt: now,
      activeMs: 60_000,
    };
    const text = svc.formatMaturedAlert(alert, [
      { base: 'EDEN', verdict: 'CERCA', change: 61.4, score: 38, ts: now - 8 * HOUR },
    ]);
    expect(text).toContain('📋 Otros del día:');
    expect(text).toContain('EDEN [CERCA] +61.4% (hace 8h, score 38)');
  });
});
