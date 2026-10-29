import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { getTenantClinicId } from './tenant-context.js';
import { scopeArgs, TENANT_MODELS } from './tenant-scope.js';

function createTenantClient(base: PrismaService) {
  return base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            // e.g. Clinic or RefreshToken: those belong to the raw PrismaService, not here.
            throw new Error(`Model "${model}" is not available on the tenant client`);
          }
          const clinicId = getTenantClinicId();
          if (!clinicId) throw new ForbiddenException();
          return query(scopeArgs(operation, args as Record<string, unknown>, clinicId) as typeof args);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof createTenantClient>;

/**
 * Use `tenant.db` for ANY query on clinic data. It adds the clinic filter automatically.
 * Use the raw PrismaService only for login, token handling and the platform panel.
 */
@Injectable()
export class TenantPrismaService {
  readonly db: TenantClient;

  constructor(prisma: PrismaService) {
    this.db = createTenantClient(prisma);
  }
}
