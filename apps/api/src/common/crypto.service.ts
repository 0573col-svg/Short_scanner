import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado autenticado AES-256-GCM para secretos at-rest.
 *
 * Formato del payload binario (Buffer):
 *   [IV (12 bytes)] [authTag (16 bytes)] [ciphertext (N bytes)]
 *
 * La clave viene de TELEGRAM_ENCRYPTION_KEY (hex de 32 bytes / 64 chars).
 * Rotación: ver §9 del MIGRATION-NESTJS.md — añadir keyVersion + re-cifrar.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(cfg: ConfigService) {
    const hex = cfg.get<string>('TELEGRAM_ENCRYPTION_KEY')!;
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error(
        'TELEGRAM_ENCRYPTION_KEY debe ser hex de 32 bytes (64 chars). Generar con: openssl rand -hex 32',
      );
    }
    this.key = Buffer.from(hex, 'hex');
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ct]);
  }

  decrypt(payload: Buffer): string {
    if (payload.length < 12 + 16 + 1) {
      throw new Error('Payload cifrado muy corto');
    }
    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const ct = payload.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}
