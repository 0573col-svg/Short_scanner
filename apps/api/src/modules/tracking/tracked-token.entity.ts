import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { TrackedStatus } from '@short-scanner/shared-types';

export const TRACKED_STATUSES: TrackedStatus[] = [
  'ACTIVE',
  'DORMANT',
  'SHORTED',
  'CLOSED',
  'ARCHIVED',
];

/** TypeORM trae bigint como string desde pg — convertir a number en la app. */
const bigintTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | null): number => (value === null ? 0 : parseInt(value, 10)),
};

@Entity('tracked_tokens')
@Unique('uq_user_symbol_first_detected', ['userId', 'symbol', 'firstDetectedAt'])
@Index(['userId', 'status'])
@Index(['userId', 'symbol'])
@Index(['status', 'lastSeenPumpingAt'])
export class TrackedTokenEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column('uuid') userId!: string;

  @Column() symbol!: string;

  @Column() base!: string;

  @Column({ type: 'enum', enum: TRACKED_STATUSES, default: 'ACTIVE' })
  status!: TrackedStatus;

  // ── Tiempos ──────────────────────────────────────────────
  @CreateDateColumn({ type: 'timestamptz' }) firstDetectedAt!: Date;
  @Column({ type: 'timestamptz' }) lastSeenPumpingAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) archivedAt!: Date | null;

  // ── Snapshot de la primera detección (post-mortem) ──────
  @Column({ type: 'jsonb' }) firstDetectionSnapshot!: Record<string, unknown>;

  // ── High-water marks ────────────────────────────────────
  @Column('int') peakScore!: number;
  @Column('float') peakRsi!: number;
  @Column('float') peakChange24h!: number;
  @Column('double precision') peakPrice!: number;
  @Column({ type: 'timestamptz' }) peakAt!: Date;

  // ── Contadores de persistencia (agotamiento del pump) ───
  @Column('int', { default: 1 }) daysActive!: number;
  @Column('int', { default: 1 }) scansActive!: number;
  @Column('int', { default: 0 }) reappearances!: number;

  // ── Estado actual del último scan (no high-water; valor instantáneo) ─
  @Column('int', { nullable: true }) currentScore!: number | null;
  @Column({ type: 'text', nullable: true }) currentVerdict!: string | null;

  /**
   * Grades del último scan (formato `Grades` de shared-types).
   * Se copia al Trade.entrySnapshot cuando el usuario abre short → LearningService los lee.
   */
  @Column({ type: 'jsonb', nullable: true }) currentGrades!: Record<string, unknown> | null;

  // ── Trade asociado (cuando el usuario abre short) ───────
  @Column({ type: 'uuid', nullable: true, unique: true }) tradeId!: string | null;

  // ── Matured-verdict tracking (Fase 4 — schema base) ─────
  // Flags "ever passed": una vez true, no se desactivan dentro del período.
  @Column({ type: 'boolean', default: false }) rsiEverPassed!: boolean;
  @Column({ type: 'timestamptz', nullable: true }) rsiPassedAt!: Date | null;
  @Column({ type: 'boolean', default: false }) fundingEverPassed!: boolean;
  @Column({ type: 'timestamptz', nullable: true }) fundingPassedAt!: Date | null;
  @Column({ type: 'boolean', default: false }) divergenceEverPassed!: boolean;
  @Column({ type: 'timestamptz', nullable: true }) divergencePassedAt!: Date | null;
  @Column({ type: 'boolean', default: false }) redCandlesEverPassed!: boolean;
  @Column({ type: 'timestamptz', nullable: true }) redCandlesPassedAt!: Date | null;

  // Veredicto "maduro" — null hasta que se cumplan las 3 reglas.
  @Column({ type: 'text', nullable: true }) maturedVerdict!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) maturedAt!: Date | null;
  // Dedup persistente de la alerta MADURO: timestamp del envío Telegram.
  @Column({ type: 'timestamptz', nullable: true }) maturedAlertedAt!: Date | null;

  // Precio del último scan (no high-water; valor instantáneo).
  @Column({ type: 'double precision', nullable: true }) currentPrice!: number | null;

  // Milisegundos activos acumulados — incrementa solo en reaparición continua
  // (delta <= 1.5× SCAN_INTERVAL_MS). DORMANT pausa el reloj.
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer }) activeMs!: number;
}
