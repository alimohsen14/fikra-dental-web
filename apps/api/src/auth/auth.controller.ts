import { Body, Controller, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { isProduction } from '../config/env.js';
import { REFRESH_COOKIE, REFRESH_TOKEN_TTL_DAYS } from './auth.constants.js';
import { AllowMustChange, CurrentUser, Public } from './auth.decorators.js';
import { changePasswordSchema, loginSchema, parseBody } from './auth.dto.js';
import { AuthService } from './auth.service.js';
import type { IssuedSession } from './auth.service.js';
import type { AuthUser } from './auth.types.js';

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true, // JavaScript in the page can never read it
    secure: isProduction(), // HTTPS only in production
    sameSite: 'strict',
    path: '/auth', // only sent to the auth routes
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // per IP; per-account lockout is in the service
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const dto = parseBody(loginSchema, body);
    const session = await this.auth.login(dto.username, dto.password);
    return this.respond(res, session);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthorizedException();
    try {
      return this.respond(res, await this.auth.refresh(raw));
    } catch (e) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions());
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
  }

  @AllowMustChange()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dto = parseBody(changePasswordSchema, body);
    const session = await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
    return this.respond(res, session);
  }

  private respond(res: Response, s: IssuedSession) {
    res.cookie(REFRESH_COOKIE, s.refreshToken, {
      ...cookieOptions(),
      maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
    return { accessToken: s.accessToken, mustChangePassword: s.mustChangePassword, user: s.user };
  }
}
