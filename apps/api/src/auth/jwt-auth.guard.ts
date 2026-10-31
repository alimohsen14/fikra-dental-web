import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service.js';
import { ALLOW_MUST_CHANGE, IS_PUBLIC } from './auth.decorators.js';
import { ACCESS_DENIED_MESSAGES, checkClinicAccess } from './clinic-access.js';
import type { AuthUser } from './auth.types.js';
import { TokenService } from './token.service.js';

/** Registered globally: every route needs a valid login unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException();

    const payload = await this.tokens.verifyAccess(token);
    if (!payload) throw new UnauthorizedException();

    // Load the user on every request so deactivation / clinic suspension takes effect immediately.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        clinicId: true,
        fullName: true,
        canManagePayments: true,
        isActive: true,
        mustChangePassword: true,
        clinic: {
          select: { name: true, themeColor: true, logoUrl: true, status: true, subscriptionEndsAt: true },
        },
      },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();

    // Suspended clinic, or subscription ended more than 3 days ago: blocked on the very next request.
    const access = checkClinicAccess(user.clinic);
    if (!access.allowed) {
      throw new ForbiddenException({ code: access.reason, message: ACCESS_DENIED_MESSAGES[access.reason] });
    }

    if (
      user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE, targets)
    ) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'لازم تغيّر كلمة المرور المؤقتة أول',
      });
    }

    // Role and clinicId come from the database, never from request input.
    req.user = {
      id: user.id,
      role: user.role,
      clinicId: user.clinicId,
      fullName: user.fullName,
      canManagePayments: user.canManagePayments,
      mustChangePassword: user.mustChangePassword,
      clinic: user.clinic
        ? { id: user.clinicId!, name: user.clinic.name, themeColor: user.clinic.themeColor, logoUrl: user.clinic.logoUrl }
        : null,
      subscriptionWarning: user.role === 'OWNER' ? access.warning : null,
    };
    return true;
  }
}
