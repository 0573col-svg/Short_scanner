import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { OtherTodayAlert, Verdict } from '@short-scanner/shared-types';
import { AlertEntity } from './alert.entity';

/**
 * Queries read-only sobre el histórico de alertas persistidas.
 *
 * Fase 3 lo usa para listar "Otros del día" en el mensaje de Telegram.
 * El cap de 20 rows es defensivo: días típicos tienen ~5-10 alerts/usuario.
 */
@Injectable()
export class AlertsHistoryService {
  constructor(
    @InjectRepository(AlertEntity)
    private readonly alertsRepo: Repository<AlertEntity>,
  ) {}

  /**
   * Trae alertas del usuario desde el inicio del día (zona horaria Colombia,
   * UTC-5 fijo todo el año — sin DST), excluyendo opcionalmente una por id.
   */
  async getOthersToday(userId: string, excludeId?: string): Promise<OtherTodayAlert[]> {
    const startOfDay = startOfTodayBogotaUTC();
    const qb = this.alertsRepo
      .createQueryBuilder('a')
      .select(['a.base', 'a.verdict', 'a.change', 'a.score', 'a.ts'])
      .where('a.userId = :userId', { userId })
      .andWhere('a.ts >= :startOfDay', { startOfDay })
      .orderBy('a.ts', 'ASC')
      .limit(20);
    if (excludeId) {
      qb.andWhere('a.id != :excludeId', { excludeId });
    }
    const rows = await qb.getMany();
    return rows.map((r) => ({
      base: r.base,
      verdict: r.verdict as Verdict,
      change: r.change,
      score: r.score,
      ts: r.ts.getTime(),
    }));
  }
}

/**
 * Inicio del día corriente en zona horaria Colombia (UTC-5 fijo, sin DST),
 * devuelto como `Date` UTC para pasar como parámetro a Postgres.
 *
 * Ejemplo: si ahora son 23:30 del 2026-05-25 en Bogotá, devuelve un Date que
 * representa 2026-05-25T05:00:00Z (= 2026-05-25T00:00:00-05:00).
 */
function startOfTodayBogotaUTC(): Date {
  const OFFSET_MS = -5 * 3600 * 1000;
  const bogotaNow = new Date(Date.now() + OFFSET_MS);
  bogotaNow.setUTCHours(0, 0, 0, 0);
  return new Date(bogotaNow.getTime() - OFFSET_MS);
}
