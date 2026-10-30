import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { getTotpKey } from '../config/env.js';

const ISSUER = 'Fikra Dental';
const PERIOD_SECONDS = 30;
// No look-alike characters, so a code can be read from paper.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Two-factor codes (the 6 digits from the authenticator app) and backup recovery codes. */
@Injectable()
export class TotpService {
  // Read at startup: the server refuses to start without a valid key.
  private readonly key = getTotpKey();

  newSecret(): string {
    return new OTPAuth.Secret({ size: 20 }).base32;
  }

  /** The otpauth:// link that the QR code carries. */
  uri(secretBase32: string, username: string): string {
    return this.totp(secretBase32, username).toString();
  }

  /** Returns the 30-second step the code belongs to, or null if the code is wrong. */
  verify(secretBase32: string, token: string, nowMs = Date.now()): number | null {
    const delta = this.totp(secretBase32, 'check').validate({ token, window: 1, timestamp: nowMs });
    if (delta === null) return null;
    return Math.floor(nowMs / 1000 / PERIOD_SECONDS) + delta;
  }

  /** Secrets are stored encrypted (AES-256-GCM), never in plain text. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }

  decrypt(stored: string): string {
    if (!stored.startsWith('v1:')) throw new Error('Unknown secret format');
    const raw = Buffer.from(stored.slice(3), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }

  newRecoveryCodes(count = 8): string[] {
    return Array.from({ length: count }, () => {
      const pick = () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
      const part = () => Array.from({ length: 4 }, pick).join('');
      return `${part()}-${part()}`;
    });
  }

  /** Accepts "abcd-efgh", "ABCDEFGH", etc. */
  normalizeRecoveryCode(input: string): string {
    return input.replace(/[\s-]/g, '').toUpperCase();
  }

  hashRecoveryCode(input: string): string {
    return createHash('sha256').update(this.normalizeRecoveryCode(input)).digest('hex');
  }

  private totp(secretBase32: string, label: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
      issuer: ISSUER,
      label,
      algorithm: 'SHA1', // the default every authenticator app supports
      digits: 6,
      period: PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
  }
}
