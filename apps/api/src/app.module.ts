import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ClinicModule } from './clinic/clinic.module.js';
import { DatabaseModule } from './database/database.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { SalariesModule } from './salaries/salaries.module.js';
import { HealthModule } from './health/health.module.js';
import { BookingModule } from './booking/booking.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { PatientsModule } from './patients/patients.module.js';
import { SchedulingModule } from './scheduling/scheduling.module.js';
import { StaffModule } from './staff/staff.module.js';
import { TreatmentsModule } from './treatments/treatments.module.js';
import { TenantModule } from './tenant/tenant.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, AdminModule, ClinicModule, TenantModule, PatientsModule, SchedulingModule, StaffModule, TreatmentsModule, MessagingModule, BookingModule, ExpensesModule, HealthModule, SalariesModule],
})
export class AppModule {}
