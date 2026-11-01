import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import type { WorkingPeriodsDto } from './scheduling.dto.js';

@Injectable()
export class DoctorsService {
  constructor(private readonly tenant: TenantPrismaService) {}

  /** Owner and secretaries see every active doctor; a doctor sees only themselves. */
  list(user: AuthUser) {
    return this.tenant.db.doctor.findMany({
      where: { isActive: true, ...(user.role === 'DOCTOR' ? { userId: user.id } : {}) },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        fullName: true,
        specialty: true,
        userId: true,
        workingPeriods: {
          orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
          select: { id: true, weekday: true, startMinute: true, endMinute: true },
        },
      },
    });
  }

  /**
   * Replaces a doctor's whole weekly schedule. The new rows are created first and the old ones are
   * deleted after, so a failure half-way can never leave the doctor with no hours at all.
   */
  async setWorkingPeriods(doctorId: string, dto: WorkingPeriodsDto) {
    const doctor = await this.tenant.db.doctor.findUnique({ where: { id: doctorId }, select: { id: true } });
    if (!doctor) throw new NotFoundException('الدكتور غير موجود');
    const old = await this.tenant.db.doctorWorkingPeriod.findMany({ where: { doctorId }, select: { id: true } });
    if (dto.periods.length > 0) {
      await this.tenant.db.doctorWorkingPeriod.createMany({ data: dto.periods.map((p) => ({ ...p, doctorId })) as never });
    }
    if (old.length > 0) {
      await this.tenant.db.doctorWorkingPeriod.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
    return this.tenant.db.doctorWorkingPeriod.findMany({
      where: { doctorId },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      select: { id: true, weekday: true, startMinute: true, endMinute: true },
    });
  }
}
