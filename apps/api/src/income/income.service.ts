import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { periodRange } from '../expenses/period.js';
import type { Period } from '../expenses/period.js';
import { addDaysTo, instantAt, localDate } from '../scheduling/clinic-time.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';

/**
 * A doctor's own income: what patients paid on the treatments registered under their name.
 * There is deliberately no way to ask for someone else's: no doctor id is ever accepted, so neither another
 * doctor nor the clinic owner can read it. The owner only sees the clinic total (expenses/summary).
 */
@Injectable()
export class IncomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantPrismaService,
  ) {}

  private async ownDoctorId(user: AuthUser): Promise<string> {
    const doctor = await this.tenant.db.doctor.findFirst({ where: { userId: user.id }, select: { id: true } });
    if (!doctor) throw new NotFoundException('ما عندك ملف دكتور');
    return doctor.id;
  }

  private async tz(clinicId: string): Promise<string> {
    return (await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { timezone: true } })).timezone;
  }

  async mine(user: AuthUser, period: Period, date: string) {
    if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new BadRequestException('تاريخ غير صالح');
    const doctorId = await this.ownDoctorId(user);
    const tz = await this.tz(user.clinicId!);
    const r = periodRange(period, date);
    const rows = await this.tenant.db.payment.findMany({
      where: { status: 'ACTIVE', paidAt: { gte: instantAt(r.from, 0, tz), lt: instantAt(r.to, 0, tz) }, treatment: { doctorId } },
      orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
      select: { id: true, amount: true, method: true, paidAt: true, treatmentId: true, patient: { select: { id: true, fullName: true } } },
    });
    return {
      period,
      from: r.from,
      to: addDaysTo(r.to, -1), // the last day, included
      income: rows.reduce((t, p) => t + p.amount, 0),
      count: rows.length,
      payments: rows.slice(0, 500),
    };
  }

  /** January to December of one year: {month: "2026-03", income}. */
  async months(user: AuthUser, year: number) {
    const doctorId = await this.ownDoctorId(user);
    const tz = await this.tz(user.clinicId!);
    const rows = await this.tenant.db.payment.findMany({
      where: { status: 'ACTIVE', paidAt: { gte: instantAt(`${year}-01-01`, 0, tz), lt: instantAt(`${year + 1}-01-01`, 0, tz) }, treatment: { doctorId } },
      select: { amount: true, paidAt: true },
    });
    const out = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, income: 0 }));
    for (const p of rows) {
      const row = out[Number(localDate(p.paidAt, tz).slice(5, 7)) - 1];
      if (row) row.income += p.amount;
    }
    return out;
  }
}
