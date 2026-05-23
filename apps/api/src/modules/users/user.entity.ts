import { Column, CreateDateColumn, Entity, OneToOne, PrimaryColumn } from 'typeorm';
import type { Mode, Thresholds, Weights } from '@short-scanner/shared-types';
import { TelegramConfigEntity } from './telegram-config.entity';
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
} from '../scoring/scoring.constants';

@Entity('users')
export class UserEntity {
  /**
   * En multi-user (Sprint 4) este id será = auth.users.id de Supabase.
   * Por ahora es un UUID hardcodeado (DEFAULT_USER_ID).
   */
  @PrimaryColumn('uuid') id!: string;

  @Column({ unique: true }) email!: string;

  @Column({ type: 'varchar', length: 16, default: 'STRICT' })
  mode!: Mode;

  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_THRESHOLDS)}'` })
  thresholds!: Thresholds;

  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_WEIGHTS)}'` })
  weights!: Weights;

  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;

  @OneToOne(() => TelegramConfigEntity, (t) => t.user)
  telegram?: TelegramConfigEntity;
}
