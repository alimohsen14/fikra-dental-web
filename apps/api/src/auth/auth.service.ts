import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Role } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  REFRESH_TOKEN_TTL_DAYS,
} from './auth.constants.js';
import { ACCESS_DENIED_MESSAGES, checkClinicAccess } from './clinic-access.js';
import type { SubscriptionWarning } from './clinic-access.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

const GENERIC_LOGIN_ERROR = 'اسم المستخدم أو كلمة المرور غير صحيحة';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IssuedSession {
  accessToken: string;
  refreshToken: string; // raw value, goes into the httpOnly cookie
  mustChangePassword: boolean;
  subscriptionWarning: SubscriptionWarning | null; // owner only
  user: { id: string; fullName: string; role: string; clinicId: string | null };
}

@Injectable()
export class AuthService {
  // Used to burn the same CPU time when the username does not exist (prevents user enumeration by timing).
  private dummyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {
    this.dummyHash = this.passwords.hash('not-a-real-password');
  }

  async login(username: string, password: string): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
      include: { clinic: { select: { status: true, subscriptionEndsAt: true } } },
    });

    if (!user) {
      await this.passwords.verify(password, await this.dummyHash);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const ok = await this.passwords.verify(password, user.passwordHash);
    if (!ok) {
      await this.registerFailure(user.id);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    // Correct password, but the account may not be allowed in. Same generic error on purpose.
    const tempExpired =
      user.mustChangePassword &&
      user.temporaryPasswordExpiresAt !== null &&
      user.temporaryPasswordExpiresAt < now;
    if (!user.isActive || tempExpired) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    // The password is right, so it is safe to tell the person why they cannot enter.
    const access = checkClinicAccess(user.clinic, now);
    if (!access.allowed) {
      throw new ForbiddenException({ code: access.reason, message: ACCESS_DENIED_MESSAGES[access.reason] });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    return this.issueSession(user, crypto.randomUUID(), access.warning);
  }

  async refresh(rawToken: string): Promise<IssuedSession> {
    const hash = this.tokens.hashRefresh(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!stored) throw new UnauthorizedException();

    if (stored.revokedAt) {
      // A token that was already rotated is being used again: assume theft, kill the whole chain.
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException();
    }
    if (stored.expiresAt < new Date()) throw new UnauthorizedException();

    // Atomic claim: only one request can rotate a given token.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { clinic: { select: { status: true, subscriptionEndsAt: true } } },
    });
    const access = user ? checkClinicAccess(user.clinic) : null;
    if (!user || !user.isActive || !access?.allowed) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException();
    }

    return this.issueSession(user, stored.familyId, access.warning);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefresh(rawToken) },
    });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { clinic: { select: { status: true, subscriptionEndsAt: true } } },
    });
    if (!user) throw new UnauthorizedException();

    const ok = await this.passwords.verify(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('كلمة المرور الحالية غير صحيحة');

    if (currentPassword === newPassword) {
      throw new BadRequestException('كلمة المرور الجديدة لازم تكون مختلفة عن الحالية');
    }
    const policyError = this.passwords.validatePolicy(newPassword, user.username);
    if (policyError) throw new BadRequestException(policyError);

    const passwordHash = await this.passwords.hash(newPassword);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          temporaryPasswordExpiresAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      // Every other device/session must log in again with the new password.
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Never store passwords or hashes in the audit log.
      await tx.auditLog.create({
        data: {
          clinicId: user.clinicId,
          actorUserId: user.id,
          action: 'PASSWORD_CHANGED',
          entityType: 'User',
          entityId: user.id,
        },
      });
      return u;
    });

    const access = checkClinicAccess(user.clinic);
    return this.issueSession(updated, crypto.randomUUID(), access.allowed ? access.warning : null);
  }

  // ------------------------------------------------------------ helpers

  private async registerFailure(userId: string): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000),
        },
      });
    }
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueSession(
    user: {
      id: string;
      fullName: string;
      role: Role;
      clinicId: string | null;
      mustChangePassword: boolean;
    },
    familyId: string,
    warning: SubscriptionWarning | null,
  ): Promise<IssuedSession> {
    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      role: user.role,
      clinicId: user.clinicId,
      mcp: user.mustChangePassword,
    });
    const refresh = this.tokens.newRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: refresh.hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * DAY_MS),
      },
    });
    return {
      accessToken,
      refreshToken: refresh.raw,
      mustChangePassword: user.mustChangePassword,
      subscriptionWarning: user.role === 'OWNER' ? warning : null,
      user: { id: user.id, fullName: user.fullName, role: user.role, clinicId: user.clinicId },
    };
  }
}
