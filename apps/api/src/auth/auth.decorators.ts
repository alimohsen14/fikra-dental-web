import { SetMetadata, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth.types.js';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_MUST_CHANGE = 'allowMustChange';

/** Route needs no login (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route may be used while the password is still temporary (change-password, logout). */
export const AllowMustChange = () => SetMetadata(ALLOW_MUST_CHANGE, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
  },
);
