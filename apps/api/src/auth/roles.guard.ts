import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '../generated/prisma/client.js';
import { IS_PUBLIC } from './auth.decorators.js';
import type { AuthUser } from './auth.types.js';
import { ANY_ROLE_KEY, PAYMENTS_KEY, ROLES_KEY } from './roles.decorator.js';

/** Global, runs after JwtAuthGuard. Default is DENY: a route with no rule is closed. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user) throw new ForbiddenException();

    if (this.reflector.getAllAndOverride<boolean>(ANY_ROLE_KEY, targets)) return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (!roles || roles.length === 0 || !roles.includes(user.role)) {
      throw new ForbiddenException();
    }

    if (this.reflector.getAllAndOverride<boolean>(PAYMENTS_KEY, targets)) {
      if (user.role !== 'OWNER' && !user.canManagePayments) throw new ForbiddenException();
    }
    return true;
  }
}
