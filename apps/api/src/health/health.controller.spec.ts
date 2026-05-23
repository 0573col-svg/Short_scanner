import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('returns ok with uptime and timestamp', () => {
    const res = controller.healthz();
    expect(res.status).toBe('ok');
    expect(res.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof res.version).toBe('string');
    expect(() => new Date(res.timestamp)).not.toThrow();
  });
});
