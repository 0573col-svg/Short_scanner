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
}
