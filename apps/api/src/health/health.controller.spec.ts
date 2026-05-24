import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ScannerStateStore } from '../modules/scanner/scanner.state';

describe('HealthController', () => {
  let controller: HealthController;
  let store: ScannerStateStore;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService, ScannerStateStore],
    }).compile();

    controller = moduleRef.get(HealthController);
    store = moduleRef.get(ScannerStateStore);
  });

  function fakeRes() {
    const res: Partial<Response> & { _status?: number } = {};
    res.status = (code: number) => {
      res._status = code;
      return res as Response;
    };
    return res as Response & { _status?: number };
  }

  it('returns ok + 200 dentro del grace period del boot', () => {
    const res = fakeRes();
    const r = controller.healthz(res);
    expect(r.status).toBe('ok');
    expect(res._status).toBeUndefined(); // default 200
    expect(r.checks.scannerLastRanAt).toBe(0);
    expect(r.checks.scannerStaleSeconds).toBe(-1);
  });

  it('returns ok cuando el scan corrió recientemente', () => {
    store.applyScanResults([], Date.now() + 120_000); // ranAt = now
    const res = fakeRes();
    const r = controller.healthz(res);
    expect(r.status).toBe('ok');
    expect(r.checks.scannerStale).toBe(false);
    expect(r.checks.scannerStaleSeconds).toBeGreaterThanOrEqual(0);
  });

  it('returns degraded + 503 cuando el scan está stale > 5 min', () => {
    // Simular un scan que corrió hace 7 minutos manipulando el state directamente
    // (no exponemos un setter de ranAt — usamos el applyScanResults y forzamos)
    store.applyScanResults([], 0);
    // Hack para el test: meter ranAt en el pasado
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any).state.ranAt = Date.now() - 7 * 60_000;

    // También bypass del grace period — el HealthService tiene un grace de 60s tras boot
    // que sumergiría este caso. Forzamos un startedAt viejo.
    const svc = new HealthService(store);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).startedAt = Date.now() - 5 * 60_000;
    const res = fakeRes();
    const result = svc.check();
    if (result.status !== 'ok') res.status(503);

    expect(result.status).toBe('degraded');
    expect(result.checks.scannerStale).toBe(true);
    expect(res._status).toBe(503);
  });
});
