import type { ScoredToken, TokenSnapshot } from '@short-scanner/shared-types';
import { TrackingService } from './tracking.service';
import { TrackedTokenEntity } from './tracked-token.entity';

/**
 * Helper para fabricar un ScoredToken con el `change24h` requerido.
 * El resto de campos no influyen en el filtro de entrada (Fase 4).
 */
function scored(change: number, symbol = 'XYZUSDT'): ScoredToken {
  const snapshot: TokenSnapshot = {
    symbol,
    base: symbol.replace(/USDT$/, ''),
    price: 0.5,
    change,
    vol: 5e7,
    fundingRate: 0.06,
    rsi: 78,
    divergence: { found: true, strength: 0.6 },
    candleColors: ['green', 'green', 'red', 'red'],
    redCount: 2,
    ts: Date.now(),
  };
  return {
    snapshot,
    score: 75,
    verdict: 'CERCA',
    grades: {
      pump: { points: 12, state: 'near', passed: false },
      funding: { points: 20, state: 'ok', passed: true },
      rsi: { points: 9, state: 'near', passed: false },
      divergence: { points: 12, state: 'ok', passed: true },
      redCandles: { points: 25, state: 'ok', passed: true },
      btcOk: { points: 5, state: 'ok', passed: true },
      liquidity: { points: 5, state: 'ok', passed: true },
    },
    passedCount: 4,
  };
}

/**
 * Mock de DataSource cuyo `transaction(cb)` ejecuta el callback inmediatamente
 * con un manager que devuelve `repo` para cualquier entity solicitada.
 */
function makeService(repo: Record<string, jest.Mock>, overrides: { maturedWindowMs?: number } = {}) {
  const manager = { getRepository: jest.fn().mockReturnValue(repo) };
  const dataSource = {
    transaction: jest.fn().mockImplementation(async (cb: (mgr: typeof manager) => Promise<unknown>) => cb(manager)),
  };
  const cfg = {
    get: jest.fn().mockImplementation((key: string, def: number) => {
      if (key === 'MATURED_WINDOW_MS' && overrides.maturedWindowMs !== undefined) {
        return overrides.maturedWindowMs;
      }
      return def;
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new TrackingService(repo as any, dataSource as any, cfg as any);
  return svc;
}

/** Repo mock con defaults vacíos — los tests sobrescriben lo que necesiten. */
function baseRepo(): Record<string, jest.Mock> {
  return {
    // findOne: por defecto, no existe nada → null
    findOne: jest.fn().mockResolvedValue(null),
    // save: devuelve lo que recibe
    save: jest.fn().mockImplementation((row) => Promise.resolve(row)),
    // create: identity (no transforma)
    create: jest.fn().mockImplementation((row) => row),
    // find: por defecto, no hay ACTIVE/DORMANT viejos
    find: jest.fn().mockResolvedValue([]),
    // update: ack
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

describe('TrackingService.reconcile — filtro de entrada >=50%', () => {
  const USER_ID = '00000000-0000-0000-0000-000000000001';

  it('NO persiste un token nuevo con change=49% (debajo del umbral)', async () => {
    const repo = baseRepo();
    const svc = makeService(repo);

    await svc.reconcile(USER_ID, [scored(49)]);

    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('SÍ persiste un token nuevo con change=50% (umbral exacto)', async () => {
    const repo = baseRepo();
    const svc = makeService(repo);

    await svc.reconcile(USER_ID, [scored(50)]);

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
    const created = repo.create.mock.calls[0][0];
    expect(created.symbol).toBe('XYZUSDT');
    expect(created.status).toBe('ACTIVE');
  });

  it('SÍ persiste un token nuevo con change=80% (bien por encima)', async () => {
    const repo = baseRepo();
    const svc = makeService(repo);

    await svc.reconcile(USER_ID, [scored(80)]);

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('actualiza un token EXISTENTE aunque su change actual sea <50%', async () => {
    // Escenario: el token entró a tracking con pump fuerte ayer (peakChange=85%),
    // hoy su change24h cayó a 30% pero sigue en el scan → debe actualizarse,
    // no descartarse. Mueren solo via DORMANT TTL natural.
    const existing: Partial<TrackedTokenEntity> = {
      id: 'existing-id',
      userId: USER_ID,
      symbol: 'XYZUSDT',
      base: 'XYZ',
      status: 'ACTIVE',
      firstDetectedAt: new Date(Date.now() - 24 * 3600 * 1000),
      lastSeenPumpingAt: new Date(Date.now() - 5 * 60 * 1000),
      peakScore: 70,
      peakRsi: 80,
      peakChange24h: 85,
      peakPrice: 0.6,
      peakAt: new Date(),
      scansActive: 10,
      reappearances: 0,
    };
    const repo = baseRepo();
    repo.findOne.mockResolvedValueOnce(existing);
    const svc = makeService(repo);

    await svc.reconcile(USER_ID, [scored(30)]);

    expect(repo.save).toHaveBeenCalledTimes(1);
    // El save recibe la entity existente con campos actualizados; no debe llamar create.
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('procesa mezcla: 1 nuevo <50% (descartado) + 1 nuevo >=50% (creado) + 1 existente <50% (actualizado)', async () => {
    const repo = baseRepo();
    // Primer findOne → null (NEWA nuevo, descartado por filtro)
    // Segundo findOne → null (NEWB nuevo, pasa filtro)
    // Tercer findOne → existing (OLDC existente, se actualiza)
    repo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'old-c',
        userId: USER_ID,
        symbol: 'OLDCUSDT',
        base: 'OLDC',
        status: 'ACTIVE',
        firstDetectedAt: new Date(),
        lastSeenPumpingAt: new Date(),
        peakScore: 50,
        peakRsi: 75,
        peakChange24h: 90,
        peakPrice: 1,
        peakAt: new Date(),
        scansActive: 5,
        reappearances: 0,
      });
    const svc = makeService(repo);

    await svc.reconcile(USER_ID, [
      scored(40, 'NEWAUSDT'), // descarte
      scored(60, 'NEWBUSDT'), // crear
      scored(35, 'OLDCUSDT'), // actualizar
    ]);

    // 3 findOne (uno por símbolo en el scan)
    expect(repo.findOne).toHaveBeenCalledTimes(3);
    // 1 create (solo NEWB)
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.create.mock.calls[0][0].symbol).toBe('NEWBUSDT');
    // 2 save (NEWB create + OLDC update)
    expect(repo.save).toHaveBeenCalledTimes(2);
  });
});

describe('TrackingService.reconcile — integración matured-verdict (Fase 5)', () => {
  const USER_ID = '00000000-0000-0000-0000-000000000001';

  it('token NUEVO con grade.passed=true persiste su Ever-flag desde el primer scan', async () => {
    const repo = baseRepo();
    const svc = makeService(repo);

    // El scored helper devuelve grades con funding/divergence/redCandles/btcOk/liquidity passed=true.
    await svc.reconcile(USER_ID, [scored(60)]);

    expect(repo.create).toHaveBeenCalledTimes(1);
    const created = repo.create.mock.calls[0][0];
    expect(created.fundingEverPassed).toBe(true);
    expect(created.divergenceEverPassed).toBe(true);
    expect(created.redCandlesEverPassed).toBe(true);
    // RSI passed=false en el helper → flag queda apagada
    expect(created.rsiEverPassed).toBe(false);
    expect(created.activeMs).toBe(0); // no se incrementa en el primer scan
    expect(created.maturedVerdict).toBeNull(); // imposible madurar en scan 1
  });

  it('token EXISTENTE: incrementa activeMs y prende Ever-flag faltante en el segundo scan', async () => {
    const lastScanAt = new Date(Date.now() - 120_000); // 2 min atrás
    const existing: Partial<TrackedTokenEntity> = {
      id: 'existing-1',
      userId: USER_ID,
      symbol: 'XYZUSDT',
      base: 'XYZ',
      status: 'ACTIVE',
      firstDetectedAt: new Date(Date.now() - 24 * 3600 * 1000),
      lastSeenPumpingAt: lastScanAt,
      peakScore: 70,
      peakRsi: 78,
      peakChange24h: 85,
      peakPrice: 0.6,
      peakAt: new Date(),
      scansActive: 5,
      reappearances: 0,
      activeMs: 600_000, // 10 minutos previos acumulados
      rsiEverPassed: false, // todavía no había llegado a RSI passed
      rsiPassedAt: null,
      fundingEverPassed: true,
      fundingPassedAt: new Date(Date.now() - 6 * 60 * 1000),
      divergenceEverPassed: false,
      divergencePassedAt: null,
      redCandlesEverPassed: false,
      redCandlesPassedAt: null,
      maturedVerdict: null,
      maturedAt: null,
    };
    const repo = baseRepo();
    repo.findOne.mockResolvedValueOnce(existing);
    const svc = makeService(repo);

    // El helper genera grades con funding/divergence/redCandles passed=true. RSI sigue passed=false.
    await svc.reconcile(USER_ID, [scored(60)]);

    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    // activeMs incrementó por el delta ~120000 (con cierta tolerancia por Date.now())
    expect(saved.activeMs).toBeGreaterThanOrEqual(600_000 + 119_000);
    expect(saved.activeMs).toBeLessThanOrEqual(600_000 + 121_000);
    // divergence y redCandles que estaban apagadas se prendieron
    expect(saved.divergenceEverPassed).toBe(true);
    expect(saved.redCandlesEverPassed).toBe(true);
    // funding que ya estaba prendida no cambia su timestamp
    expect(saved.fundingEverPassed).toBe(true);
    // rsi sigue apagada (el helper genera rsi.passed=false)
    expect(saved.rsiEverPassed).toBe(false);
    // currentPrice se popula
    expect(saved.currentPrice).toBe(0.5);
  });

  it('archive por window: token con activeMs>window y maturedAt=null pasa a ARCHIVED', async () => {
    const windowMs = 1_000_000; // window chico para testear
    const expired: Partial<TrackedTokenEntity> = {
      id: 'expired-1',
      userId: USER_ID,
      symbol: 'OLDUSDT',
      base: 'OLD',
      status: 'ACTIVE',
      activeMs: windowMs + 50_000,
      maturedAt: null,
      lastSeenPumpingAt: new Date(),
    };
    const repo = baseRepo();
    // Hay 3 calls a `find`:
    //  1) previouslyActive (ACTIVE) — vacío
    //  2) windowExpiredRows — devuelve `expired`
    //  3) stale DORMANT — vacío
    repo.find
      .mockResolvedValueOnce([]) // previouslyActive
      .mockResolvedValueOnce([expired]) // windowExpiredRows
      .mockResolvedValueOnce([]); // stale
    const svc = makeService(repo, { maturedWindowMs: windowMs });

    const result = await svc.reconcile(USER_ID, []);

    expect(result.windowExpired).toBe(1);
    // El update llamado con status=ARCHIVED para el token expired
    expect(repo.update).toHaveBeenCalledWith(
      'expired-1',
      expect.objectContaining({ status: 'ARCHIVED' }),
    );
  });

  it('archive por window: token YA maduro con activeMs>window NO se archiva', async () => {
    const windowMs = 1_000_000;
    // Token que ya maduró antes — quedó con maturedAt set. La query principal
    // ya lo filtra (IsNull en maturedAt), pero el doble check de
    // shouldExpireByWindow lo descarta también si llegara por error.
    const matureLongAgo: Partial<TrackedTokenEntity> = {
      id: 'mature-1',
      userId: USER_ID,
      symbol: 'MATUSDT',
      base: 'MAT',
      status: 'ACTIVE',
      activeMs: windowMs + 1_000_000,
      maturedAt: new Date(),
      lastSeenPumpingAt: new Date(),
    };
    const repo = baseRepo();
    repo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([matureLongAgo]) // erróneamente devuelto
      .mockResolvedValueOnce([]);
    const svc = makeService(repo, { maturedWindowMs: windowMs });

    const result = await svc.reconcile(USER_ID, []);

    // El doble check de shouldExpireByWindow lo filtra
    expect(result.windowExpired).toBe(0);
    expect(repo.update).not.toHaveBeenCalledWith(
      'mature-1',
      expect.objectContaining({ status: 'ARCHIVED' }),
    );
  });
});
