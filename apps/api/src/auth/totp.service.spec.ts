import * as OTPAuth from 'otpauth';
import { randomBytes } from 'node:crypto';
import { TotpService } from './totp.service.js';

process.env.TOTP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const svc = new TotpService();

const codeAt = (secret: string, ms: number) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: ms });

describe('TotpService', () => {
  it('accepts the current code and returns its step', () => {
    const secret = svc.newSecret();
    const now = Date.UTC(2026, 10, 1, 12, 0, 10);
    expect(svc.verify(secret, codeAt(secret, now), now)).toBe(Math.floor(now / 30000));
  });

  it('tolerates one step of clock drift, but not more', () => {
    const secret = svc.newSecret();
    const now = Date.UTC(2026, 10, 1, 12, 0, 10);
    expect(svc.verify(secret, codeAt(secret, now - 30_000), now)).toBe(Math.floor(now / 30000) - 1);
    expect(svc.verify(secret, codeAt(secret, now - 90_000), now)).toBeNull();
  });

  it('rejects wrong or malformed codes', () => {
    const secret = svc.newSecret();
    expect(svc.verify(secret, 'abcdef')).toBeNull();
    expect(svc.verify(secret, '12345')).toBeNull();
  });

  it('builds an otpauth link for the QR code', () => {
    const uri = svc.uri(svc.newSecret(), 'admin');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Fikra%20Dental:admin\?/);
    expect(uri).toContain('issuer=Fikra%20Dental');
  });

  it('encrypts secrets so they are not readable in the database, and decrypts them back', () => {
    const secret = svc.newSecret();
    const stored = svc.encrypt(secret);
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(secret);
    expect(svc.decrypt(stored)).toBe(secret);
    expect(svc.encrypt(secret)).not.toBe(stored); // fresh random IV every time
  });

  it('detects tampering with an encrypted secret', () => {
    const stored = svc.encrypt(svc.newSecret());
    const raw = Buffer.from(stored.slice(3), 'base64');
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(() => svc.decrypt('v1:' + raw.toString('base64'))).toThrow();
  });

  it('generates unique, readable recovery codes and hashes them regardless of formatting', () => {
    const codes = svc.newRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const code = codes[0]!;
    expect(svc.hashRecoveryCode(code)).toBe(svc.hashRecoveryCode(code.toLowerCase().replace('-', ' ')));
    expect(svc.hashRecoveryCode(code)).not.toContain(code.replace('-', ''));
  });
});
