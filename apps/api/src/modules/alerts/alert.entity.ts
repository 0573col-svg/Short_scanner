import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { Mode, Verdict } from '@short-scanner/shared-types';

/**
 * Historial persistido de toda alerta GENERADA por el scanner — independientemente
 * de si el envío a Telegram tuvo éxito. Esto permite reconstruir actividad incluso
 * en caso de fallos del bot, y habilita queries históricas (Fase 3: "Otros en
 * CERCA hoy"; futuro: stats per-indicador, win-rate por funding, etc.).
 *
 * Insert es fire-and-forget desde AlertDispatcher: si la BD está caída, se loguea
 * el error pero el path de envío a Telegram sigue funcionando.
 */
@Entity('alerts')
@Index('idx_alerts_user_ts', ['userId', 'ts'])
export class AlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column()
  symbol!: string;

  @Column()
  base!: string;

  @Column({ type: 'varchar', length: 16 })
  verdict!: Verdict;

  @Column({ type: 'varchar', length: 16 })
  mode!: Mode;

  @Column({ type: 'integer' })
  score!: number;

  @Column({ type: 'double precision' })
  change!: number;

  @Column({ type: 'double precision', nullable: true })
  rsi!: number | null;

  @Column({ type: 'double precision' })
  price!: number;

  @Column({ type: 'double precision' })
  vol!: number;

  @Column({ type: 'double precision', nullable: true })
  fundingRate!: number | null;

  @Column({ type: 'integer' })
  redCount!: number;

  @Column({ type: 'double precision' })
  btcChange!: number;

  @Column({ type: 'jsonb' })
  passed!: {
    funding: boolean;
    rsi: boolean;
    divergence: boolean;
    redCandles: boolean;
    liquidity: boolean;
  };

  @Column({ type: 'timestamp with time zone' })
  ts!: Date;
}
