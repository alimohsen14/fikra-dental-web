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
        canManagePayments: true,
        isActive: true,
        mustChangePassword: true,
        clinic: { select: { status: true } },
      },
    });
    if (!user || !user.isActive || user.clinic?.status === 'SUSPENDED') {
      throw new UnauthorizedException();
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
      canManagePayments: user.canManagePayments,
      mustChangePassword: user.mustChangePassword,
    };
    return true;
  }
}
