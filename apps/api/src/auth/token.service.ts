import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { getJwtSecret } from '../config/env.js';
import { ACCESS_TOKEN_TTL_SECONDS, CHALLENGE_TTL_SECONDS } from './auth.constants.js';
import type { AccessTokenPayload } from './auth.types.js';

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  }

  /** Returns null for any invalid/expired token (never throws details to the client). */
  async verifyAccess(token: string): Promise<AccessTokenPayload | null> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      return null;
    }
  }

  /**
   * "Password was right, now enter the two-factor code". Signed with a DIFFERENT secret than access
   * tokens, so it can never be used as a login token.
   */
  signChallenge(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, typ: 'mfa' },
      { secret: getJwtSecret() + ':mfa', expiresIn: CHALLENGE_TTL_SECONDS },
    );
  }

  /** Returns the user id, or null for any invalid/expired challenge. */
  async verifyChallenge(token: string): Promise<string | null> {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; typ?: string }>(token, {
        secret: getJwtSecret() + ':mfa',
      });
      return p.typ === 'mfa' ? p.sub : null;
    } catch {
      return null;
    }
  }

  /** The raw value goes to the browser cookie; only its hash is stored in the DB. */
  newRefreshToken(): { raw: string; hash: string } {
    const raw = randomBytes(48).toString('base64url');
    return { raw, hash: this.hashRefresh(raw) };
  }

  hashRefresh(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
