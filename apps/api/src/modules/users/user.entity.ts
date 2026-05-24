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
   * UUID generado al signup. El DEFAULT_USER_ID legacy (00000000-...-0001)
   * sigue existiendo para datos sin reasignar.
   */
  @PrimaryColumn('uuid') id!: string;

  @Column({ unique: true }) email!: string;

  /**
   * Hash bcrypt del password. NULLABLE porque:
   *  - El DEFAULT_USER_ID legacy no tiene password
   *  - Permite usuarios "claim-only" (importados de v22 sin auth)
   * En signup normal siempre se pobla.
   */
  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

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
