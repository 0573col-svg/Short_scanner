import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('telegram_configs')
export class TelegramConfigEntity {
  @PrimaryColumn('uuid') userId!: string;

  @OneToOne(() => UserEntity, (u) => u.telegram, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;

  /** Cifrado AES-256-GCM. Formato: IV(12) | authTag(16) | ciphertext(N). */
  @Column({ type: 'bytea' })
  token!: Buffer;

  /** Chat ID plaintext — no es sensible, es el destinatario público. */
  @Column() chatId!: string;

  /** Si true, también manda alertas para verdict=CERCA (no solo GO_SHORT). */
  @Column({ default: false }) nearAlertsEnabled!: boolean;

  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
