import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { PatientsModule } from './patients/patients.module.js';
import { TenantModule } from './tenant/tenant.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, AdminModule, TenantModule, PatientsModule, HealthModule],
})
export class AppModule {}
