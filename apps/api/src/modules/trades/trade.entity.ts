import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { TradeResult } from '@short-scanner/shared-types';

export const TRADE_RESULTS: TradeResult[] = ['WIN', 'LOSS', 'BREAKEVEN'];

@Entity('trades')
@Index(['userId', 'openedAt'])
@Index(['userId', 'closedAt'])
export class TradeEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column('uuid') userId!: string;

  @Column() symbol!: string;

  @CreateDateColumn({ type: 'timestamptz' }) openedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) closedAt!: Date | null;

  @Column({ type: 'enum', enum: TRADE_RESULTS, nullable: true })
  result!: TradeResult | null;

  /** Snapshot completo de TokenSnapshot+Grades+verdict al momento de abrir */
  @Column({ type: 'jsonb' }) entrySnapshot!: Record<string, unknown>;

  // ── Contexto de tracking al abrir el short (para learning futuro) ─
  @Column('int', { nullable: true }) daysActiveAtEntry!: number | null;
  @Column('int', { nullable: true }) scansActiveAtEntry!: number | null;
  @Column('int', { nullable: true }) peakScoreAtEntry!: number | null;

  @Column({ type: 'text', nullable: true }) notes!: string | null;

  @Column({ type: 'uuid', nullable: true }) trackedTokenId!: string | null;
}
