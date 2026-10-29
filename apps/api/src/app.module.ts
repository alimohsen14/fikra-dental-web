import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { PatientsModule } from './patients/patients.module.js';
import { TenantModule } from './tenant/tenant.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, TenantModule, PatientsModule, HealthModule],
})
export class AppModule {}
