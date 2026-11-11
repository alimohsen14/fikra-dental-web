import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { localDate } from '../scheduling/clinic-time.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import type { AdjustDto, SalaryPaymentDto } from './salaries.dto.js';

type Tx = Prisma.TransactionClient;
const GRACE_MS = 5 * 60_000;
const NOT_FOUND = 'سطر الراتب غير موجود';
const STAFF_ROLES = ['DOCTOR', 'SECRETARY'] as const;

const ENTRY_SELECT = {
  id: true,
  userId: true,
  month: true,
  baseAmount: true,
  adjustment: true,
  adjustNote: true,
  user: { select: { id: true, fullName: true, role: true, isActive: true } },
  payments: { orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }], select: { id: true, kind: true, amount: true, method: true, paidAt: true, note: true, status: true, voidedAt: true, voidReason: true } },
} satisfies Prisma.SalaryEntrySelect;

type Row = Prisma.SalaryEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

/** Net salary for the month, what was already taken (salary + advances), and what is left to give. */
export function figures(r: { baseAmount: number; adjustment: number; payments: { kind: 'SALARY' | 'ADVANCE'; amount: number; status: 'ACTIVE' | 'VOIDED' }[] }) {
  const net = r.baseAmount + r.adjustment;
  const active = r.payments.filter((p) => p.status === 'ACTIVE');
  const advances = active.filter((p) => p.kind === 'ADVANCE').reduce((t, p) => t + p.amount, 0);
  const salaryPaid = active.filter((p) => p.kind === 'SALARY').reduce((t, p) => t + p.amount, 0);
  const paid = advances + salaryPaid;
  return { net, advances, salaryPaid, paid, remaining: Math.max(0, net - paid) };
}

/** Monthly salaries and advances of the clinic's doctors and secretaries. Owner only; nothing is ever deleted. */
@Injectable()
export class SalariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantPrismaService,
  ) {}

  private async tz(clinicId: string): Promise<string> {
    return (await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { timezone: true } })).timezone;
  }

  /**
   * One month. Every active employee with a salary gets a line the first time the month is opened
   * (not before they joined, not for months that have not started). Stopped employees disappear
   * from new months but keep their history.
   */
  async month(user: AuthUser, month: string) {
    const clinicId = user.clinicId!;
    const tz = await this.tz(clinicId);
    if (month > localDate(new Date(), tz).slice(0, 7)) throw new BadRequestException('لم يبدأ هذا الشهر بعد');

    const staff = await this.tenant.db.user.findMany({
      where: { role: { in: [...STAFF_ROLES] }, isActive: true },
      select: { id: true, fullName: true, role: true, monthlySalary: true, createdAt: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
    const due = staff.filter((s) => (s.monthlySalary ?? 0) > 0 && localDate(s.createdAt, tz).slice(0, 7) <= month);
    if (due.length > 0) {
      await this.prisma.salaryEntry.createMany({ data: due.map((s) => ({ clinicId, userId: s.id, month, baseAmount: s.monthlySalary! })), skipDuplicates: true });
    }

    const rows = await this.tenant.db.salaryEntry.findMany({ where: { month }, select: ENTRY_SELECT, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const entries = rows
      .filter((r) => r.user.isActive || r.payments.some((p) => p.status === 'ACTIVE'))
      .map((r) => ({ ...r, ...figures(r) }))
      .sort((a, b) => a.user.fullName.localeCompare(b.user.fullName, 'ar'));
    const sum = (k: 'net' | 'paid' | 'advances' | 'remaining') => entries.reduce((t, e) => t + e[k], 0);
    return {
      month,
      entries,
      totals: { net: sum('net'), paid: sum('paid'), advances: sum('advances'), remaining: sum('remaining') },
      staff: staff.map((s) => ({ id: s.id, fullName: s.fullName, role: s.role, monthlySalary: s.monthlySalary })),
    };
  }

  /** The employee's salary from now on. Months already opened keep the amount they were opened with. */
  async setSalary(user: AuthUser, userId: string, monthlySalary: number) {
    const clinicId = user.clinicId!;
    const target = await this.tenant.db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, monthlySalary: true } });
    if (!target || !(STAFF_ROLES as readonly string[]).includes(target.role)) throw new NotFoundException('الموظف غير موجود');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { id: userId, clinicId }, data: { monthlySalary } });
      await this.audit(tx, clinicId, user.id, 'SALARY_SET', userId, { before: { monthlySalary: target.monthlySalary }, after: { monthlySalary } });
    });
    return { id: userId, monthlySalary };
  }

  /** A bonus (+) or a deduction (-) for this one month. */
  async adjust(user: AuthUser, entryId: string, dto: AdjustDto) {
    const clinicId = user.clinicId!;
    await this.exists(entryId);
    await this.prisma.$transaction(async (tx) => {
      const e = await this.lock(tx, clinicId, entryId);
      const net = e.baseAmount + dto.adjustment;
      if (net < 0) throw new BadRequestException('الخصم أكبر من الراتب');
      if (net < figures(e).paid) throw new BadRequestException('الراتب بعد التعديل أقل من المبلغ المصروف');
      await tx.salaryEntry.update({ where: { id: entryId }, data: { adjustment: dto.adjustment, adjustNote: dto.adjustNote ?? null } });
      await this.audit(tx, clinicId, user.id, 'SALARY_ADJUSTED', entryId, { before: { adjustment: e.adjustment }, after: dto });
    });
    return this.entry(entryId);
  }

  async addPayment(user: AuthUser, entryId: string, dto: SalaryPaymentDto) {
    const clinicId = user.clinicId!;
    await this.exists(entryId);
    if (dto.paidAt.getTime() > Date.now() + GRACE_MS) throw new BadRequestException('تاريخ الدفعة في المستقبل');
    const tz = await this.tz(clinicId);
    await this.prisma.$transaction(async (tx) => {
      const e = await this.lock(tx, clinicId, entryId);
      // An advance always comes off the coming salary: the current month's, never one that is over.
      if (dto.kind === 'ADVANCE' && e.month !== localDate(new Date(), tz).slice(0, 7)) throw new BadRequestException('تُخصم السلفة من راتب الشهر الحالي فقط');
      if (dto.amount > figures(e).remaining) throw new BadRequestException(dto.kind === 'ADVANCE' ? 'السلفة أكبر من المتبقي من راتب الشهر' : 'المبلغ أكبر من المتبقي من الراتب');
      const p = await tx.salaryPayment.create({
        data: { clinicId, entryId, kind: dto.kind, amount: dto.amount, method: dto.method, paidAt: dto.paidAt, note: dto.note ?? null, createdByUserId: user.id },
      });
      await this.audit(tx, clinicId, user.id, 'SALARY_PAYMENT_CREATED', p.id, { after: { entryId, kind: dto.kind, amount: dto.amount } });
    });
    return this.entry(entryId);
  }

  async voidPayment(user: AuthUser, paymentId: string, reason: string) {
    const clinicId = user.clinicId!;
    const p = await this.tenant.db.salaryPayment.findUnique({ where: { id: paymentId }, select: { id: true, entryId: true, amount: true, kind: true } });
    if (!p) throw new NotFoundException('الدفعة غير موجودة');
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, clinicId, p.entryId);
      const done = await tx.salaryPayment.updateMany({ where: { id: paymentId, clinicId, status: 'ACTIVE' }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason, voidedByUserId: user.id } });
      if (done.count !== 1) throw new ConflictException('هذه الدفعة ملغية من قبل');
      await this.audit(tx, clinicId, user.id, 'SALARY_PAYMENT_VOIDED', paymentId, { before: { amount: p.amount, kind: p.kind, entryId: p.entryId }, after: { reason } });
    });
    return this.entry(p.entryId);
  }

  // ---------------------------------------------------------------- internals
  private async exists(id: string) {
    if (!(await this.tenant.db.salaryEntry.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException(NOT_FOUND);
  }

  private async entry(id: string) {
    const r = (await this.tenant.db.salaryEntry.findUnique({ where: { id }, select: ENTRY_SELECT })) as Row | null;
    if (!r) throw new NotFoundException(NOT_FOUND);
    return { ...r, ...figures(r) };
  }

  private async lock(tx: Tx, clinicId: string, id: string) {
    const touched = await tx.salaryEntry.updateMany({ where: { id, clinicId }, data: { updatedAt: new Date() } });
    if (touched.count !== 1) throw new NotFoundException(NOT_FOUND);
    return tx.salaryEntry.findFirstOrThrow({ where: { id, clinicId }, include: { payments: true } });
  }

  private audit(tx: Tx, clinicId: string, actorUserId: string, action: string, id: string, extra: { before?: object; after?: object } = {}) {
    const entityType = action === 'SALARY_SET' ? 'User' : action.startsWith('SALARY_PAYMENT') ? 'SalaryPayment' : 'SalaryEntry';
    return tx.auditLog.create({ data: { clinicId, actorUserId, action, entityType, entityId: id, ...extra } as never });
  }
}
