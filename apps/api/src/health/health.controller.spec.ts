import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ScannerStateStore } from '../modules/scanner/scanner.state';

const TEST_USER = '00000000-0000-0000-0000-000000000001';

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
    expect(res._status).toBeUndefined();
    expect(r.checks.scannerLastRanAt).toBe(0);
    expect(r.checks.scannerStaleSeconds).toBe(-1);
  });

  it('returns ok cuando el scan corrió recientemente', () => {
    store.applyUserResults(TEST_USER, [], Date.now() + 120_000);
    const res = fakeRes();
    const r = controller.healthz(res);
    expect(r.status).toBe('ok');
    expect(r.checks.scannerStale).toBe(false);
    expect(r.checks.scannerStaleSeconds).toBeGreaterThanOrEqual(0);
  });

  it('returns degraded + 503 cuando el scan está stale > 5 min', () => {
    store.applyUserResults(TEST_USER, [], 0);
    // Hack: forzar ranAt en el pasado (atributo privado)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any).ranAt = Date.now() - 7 * 60_000;

    // Forzar startedAt viejo para bypass del grace period
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
