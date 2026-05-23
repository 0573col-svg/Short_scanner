import { CryptoService } from './crypto.service';

const KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function makeService() {
  const cfg = { get: (_k: string) => KEY_HEX } as never;
  return new CryptoService(cfg);
}

describe('CryptoService', () => {
  const svc = makeService();

  it('roundtrips plaintext fielmente', () => {
    const plain = 'secret-telegram-token-123:abcDEF';
    const ct = svc.encrypt(plain);
    expect(svc.decrypt(ct)).toBe(plain);
  });

  it('genera ciphertext distinto cada vez (IV aleatorio)', () => {
    const ct1 = svc.encrypt('same input');
    const ct2 = svc.encrypt('same input');
    expect(ct1.equals(ct2)).toBe(false);
  });

  it('rechaza payload corrompido (authTag inválido)', () => {
    const ct = svc.encrypt('hello');
    ct[20] = ct[20]! ^ 0xff; // flip byte en authTag
    expect(() => svc.decrypt(ct)).toThrow();
  });

  it('falla con clave malformada', () => {
    const badCfg = { get: () => 'not-hex' } as never;
    expect(() => new CryptoService(badCfg)).toThrow(/TELEGRAM_ENCRYPTION_KEY/);
  });
});
