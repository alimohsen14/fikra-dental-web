import { ForbiddenException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { getTenantClinicId } from './tenant-context.js';
import { scopeArgs, TENANT_MODELS } from './tenant-scope.js';

function createTenantClient(base: PrismaClient) {
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
          const scoped = scopeArgs(operation, args as Record<string, unknown>, clinicId) as typeof args;
          // Layer 1 (above): the clinic filter. Layer 2 (here): tell PostgreSQL which clinic this
          // transaction is for; its Row Level Security policies enforce it even if layer 1 had a bug.
          const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.clinic_id', ${clinicId}, TRUE)`,
            query(scoped),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof createTenantClient>;

/**
 * Use `tenant.db` for ANY query on clinic data. It adds the clinic filter automatically and runs
 * under the restricted `fikra_app` database role, so PostgreSQL itself refuses cross-clinic access.
 * It has its own connection pool (TENANT_DATABASE_URL), separate from the raw PrismaService.
 */
@Injectable()
export class TenantPrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;
  readonly db: TenantClient;

  constructor() {
    const connectionString = process.env.TENANT_DATABASE_URL;
    if (!connectionString) {
      throw new Error('TENANT_DATABASE_URL is not set. Check apps/api/.env');
    }
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    this.db = createTenantClient(this.client);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
