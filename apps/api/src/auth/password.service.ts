import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { MIN_PASSWORD_LENGTH } from './auth.constants.js';

const COMMON = new Set([
  'password', 'password1', '1234567890', '12345678910', 'qwertyuiop',
  'iloveyou12', 'admin12345', 'welcome123', 'letmein123', 'fikra12345',
]);

// No look-alike characters (0/O, 1/l/I) so the password can be read out loud / typed from paper.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

@Injectable()
export class PasswordService {
  private get cost(): number {
    return process.env.NODE_ENV === 'production' ? 12 : 10;
  }

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** Returns an error message (Arabic, shown to the user) or null if the password is acceptable. */
  validatePolicy(password: string, username: string): string | null {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `كلمة المرور لازم تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`;
    }
    if (password.length > 72) {
      return 'كلمة المرور طويلة كثير (الحد الأقصى 72 حرف)';
    }
    const lower = password.toLowerCase();
    if (COMMON.has(lower) || lower === username.toLowerCase()) {
      return 'كلمة المرور سهلة التخمين، اختار غيرها';
    }
    if (new Set(password).size < 5) {
      return 'كلمة المرور لازم تحتوي على أحرف متنوعة أكثر';
    }
    return null;
  }

  /** Random temporary password, shown ONCE to the platform admin when a clinic is created. */
  generateTemporary(length = 14): string {
    let out = '';
    for (let i = 0; i < length; i++) {
      out += ALPHABET[randomInt(ALPHABET.length)];
    }
    return out;
  }
}
