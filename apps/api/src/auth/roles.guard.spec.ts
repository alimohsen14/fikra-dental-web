import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from './auth.decorators.js';
import { AnyRole, RequiresPayments, Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

class Sample {
  @Public() open() {}
  noRule() {}
  @AnyRole() anyone() {}
  @Roles('OWNER', 'DOCTOR') clinical() {}
  @Roles('OWNER', 'SECRETARY') @RequiresPayments() money() {}
}

function ctx(method: keyof Sample, user?: object): ExecutionContext {
  return {
    getHandler: () => Sample.prototype[method],
    getClass: () => Sample,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const guard = new RolesGuard(new Reflector());
const u = (role: string, canManagePayments = false) => ({ id: '1', role, canManagePayments });

describe('RolesGuard', () => {
  it('lets @Public routes through', () => {
    expect(guard.canActivate(ctx('open'))).toBe(true);
  });

  it('DENIES a route with no rule, even for the owner (default deny)', () => {
    expect(() => guard.canActivate(ctx('noRule', u('OWNER')))).toThrow(ForbiddenException);
  });

  it('lets any logged-in user use @AnyRole routes', () => {
    expect(guard.canActivate(ctx('anyone', u('SECRETARY')))).toBe(true);
  });

  it('allows listed roles and rejects others', () => {
    expect(guard.canActivate(ctx('clinical', u('DOCTOR')))).toBe(true);
    expect(() => guard.canActivate(ctx('clinical', u('SECRETARY')))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx('clinical', u('PLATFORM_ADMIN')))).toThrow(ForbiddenException);
  });

  it('money routes need OWNER or canManagePayments', () => {
    expect(guard.canActivate(ctx('money', u('OWNER')))).toBe(true);
    expect(guard.canActivate(ctx('money', u('SECRETARY', true)))).toBe(true);
    expect(() => guard.canActivate(ctx('money', u('SECRETARY', false)))).toThrow(ForbiddenException);
  });

  it('rejects when no user is attached', () => {
    expect(() => guard.canActivate(ctx('clinical'))).toThrow(ForbiddenException);
  });
});
