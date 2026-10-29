import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantInterceptor } from './tenant.interceptor.js';
import { TenantPrismaService } from './tenant-prisma.service.js';

@Global()
@Module({
  providers: [TenantPrismaService, { provide: APP_INTERCEPTOR, useClass: TenantInterceptor }],
  exports: [TenantPrismaService],
})
export class TenantModule {}
