import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { getJwtSecret } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { TotpService } from './totp.service.js';

@Module({
  imports: [
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { algorithm: 'HS256' },
      verifyOptions: { algorithms: ['HS256'] },
    }),
    // Default limit for every route (per IP). Login/refresh/change-password override it.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      // Automated tests log in dozens of times from one IP; vitest sets NODE_ENV=test.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    TotpService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // runs after the throttler
    { provide: APP_GUARD, useClass: RolesGuard }, // default deny: needs @Roles
  ],
  exports: [PasswordService, TotpService],
})
export class AuthModule {}
