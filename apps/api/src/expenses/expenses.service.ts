import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { addDaysTo, instantAt } from '../scheduling/clinic-time.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import type { CreateExpenseDto, ExpensePaymentDto, ListExpensesQuery, UpdateExpenseDto } from './expenses.dto.js';
import { paidTotal, periodRange, remainingOf } from './period.js';
import type { Period } from './period.js';

type Tx = Prisma.TransactionClient;

const GRACE_MS = 5 * 60_000; // clock differences between the browser and the server
const NOT_FOUND = 'المصروف غير موجود';
const TAKEN = 'هذا الاسم موجود من قبل';
const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

export const DEFAULT_CATEGORIES = ['رواتب', 'إيجار', 'كهرباء', 'ماء', 'مشتريات ومواد', 'مختبر', 'صيانة', 'اتصالات وإنترنت', 'أخرى'];

const SELECT = {
  id: true,
  categoryId: true,
  supplierId: true,
  description: true,
  amount: true,
  incurredAt: true,
  status: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  payments: { orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }], select: { id: true, amount: true, method: true, paidAt: true, note: true, status: true, voidedAt: true, voidReason: true } },
} satisfies Prisma.ExpenseSelect;

/** What is still owed on a bill; a voided bill owes nothing. */
function present<T extends { amount: number; status: 'ACTIVE' | 'VOIDED'; payments: { amount: number; status: 'ACTIVE' | 'VOIDED' }[] }>(row: T) {
  return { ...row, paid: paidTotal(row.payments), remaining: row.status === 'ACTIVE' ? remainingOf(row.amount, row.payments) : 0 };
}

/** The owner's expenses: bills, who they are owed to, and the money paid on them. Nothing here is ever deleted. */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantPrismaService,
  ) {}

  private async tz(clinicId: string): Promise<string> {
    return (await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { timezone: true } })).timezone;
  }

  // ---------------------------------------------------------------- categories
  categories() {
    return this.tenant.db.expenseCategory.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, isActive: true } });
  }

  async createCategory(name: string) {
    try {
      return await this.tenant.db.expenseCategory.create({ data: { name } as never, select: { id: true, name: true, isActive: true } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(TAKEN);
      throw e;
    }
  }

  async updateCategory(id: string, dto: { name?: string; isActive?: boolean }) {
    if (!(await this.tenant.db.expenseCategory.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('النوع غير موجود');
    try {
      return await this.tenant.db.expenseCategory.update({ where: { id }, data: dto, select: { id: true, name: true, isActive: true } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(TAKEN);
      throw e;
    }
  }

  /** The ready list; names already there are skipped, so pressing it twice changes nothing. */
  async addDefaultCategories(clinicId: string) {
    await this.prisma.expenseCategory.createMany({ data: DEFAULT_CATEGORIES.map((name) => ({ clinicId, name })), skipDuplicates: true });
    return this.categories();
  }

  // ---------------------------------------------------------------- suppliers and what we owe them
  /** Money still owed per supplier (active bills only). Bills without a supplier are grouped under null. */
  async debts() {
    const rows = await this.tenant.db.expense.findMany({
      where: { status: 'ACTIVE' },
      select: { supplierId: true, amount: true, payments: { select: { amount: true, status: true } } },
    });
    const owed = new Map<string | null, number>();
    for (const r of rows) {
      const left = remainingOf(r.amount, r.payments);
      if (left > 0) owed.set(r.supplierId, (owed.get(r.supplierId) ?? 0) + left);
    }
    return owed;
  }

  async suppliers() {
    const [list, owed] = await Promise.all([
      this.tenant.db.supplier.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, phone: true, notes: true, isActive: true } }),
      this.debts(),
    ]);
    const suppliers = list.map((s) => ({ ...s, owed: owed.get(s.id) ?? 0 })).sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name, 'ar'));
    const unassigned = owed.get(null) ?? 0;
    return { suppliers, owedTotal: suppliers.reduce((t, s) => t + s.owed, 0) + unassigned, owedUnassigned: unassigned };
  }

  async createSupplier(dto: { name: string; phone?: string; notes?: string }) {
    try {
      const s = await this.tenant.db.supplier.create({ data: { name: dto.name, phone: dto.phone ?? null, notes: dto.notes ?? null } as never, select: { id: true, name: true, phone: true, notes: true, isActive: true } });
      return { ...s, owed: 0 };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(TAKEN);
      throw e;
    }
  }

  async updateSupplier(id: string, dto: { name?: string; phone?: string | null; notes?: string | null; isActive?: boolean }) {
    if (!(await this.tenant.db.supplier.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('الجهة غير موجودة');
    try {
      const s = await this.tenant.db.supplier.update({ where: { id }, data: dto, select: { id: true, name: true, phone: true, notes: true, isActive: true } });
      return { ...s, owed: (await this.debts()).get(id) ?? 0 };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(TAKEN);
      throw e;
    }
  }

  // ---------------------------------------------------------------- bills
  private async usableCategory(id: string) {
    const c = await this.tenant.db.expenseCategory.findUnique({ where: { id }, select: { isActive: true } });
    if (!c) throw new NotFoundException('النوع غير موجود');
    if (!c.isActive) throw new BadRequestException('هذا النوع موقوف');
  }

  private async usableSupplier(id: string) {
    const s = await this.tenant.db.supplier.findUnique({ where: { id }, select: { isActive: true } });
    if (!s) throw new NotFoundException('الجهة غير موجودة');
    if (!s.isActive) throw new BadRequestException('هذه الجهة موقوفة');
  }

  async list(user: AuthUser, q: ListExpensesQuery) {
    const tz = await this.tz(user.clinicId!);
    const rows = await this.tenant.db.expense.findMany({
      where: {
        ...(q.from || q.to ? { incurredAt: { ...(q.from ? { gte: instantAt(q.from, 0, tz) } : {}), ...(q.to ? { lt: instantAt(addDaysTo(q.to, 1), 0, tz) } : {}) } } : {}),
        ...(q.supplierId ? { supplierId: q.supplierId } : {}),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      },
      orderBy: [{ incurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: 500,
      select: SELECT,
    });
    const out = rows.map(present);
    return q.unpaid ? out.filter((e) => e.remaining > 0) : out;
  }

  async get(id: string) {
    const row = await this.tenant.db.expense.findUnique({ where: { id }, select: SELECT });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return present(row);
  }

  async create(user: AuthUser, dto: CreateExpenseDto) {
    const clinicId = user.clinicId!;
    if (dto.incurredAt.getTime() > Date.now() + GRACE_MS) throw new BadRequestException('تاريخ المصروف بالمستقبل');
    await this.usableCategory(dto.categoryId);
    if (dto.supplierId) await this.usableSupplier(dto.supplierId);
    const paid = dto.paidAmount ?? dto.amount;
    if (paid > dto.amount) throw new BadRequestException('المدفوع أكبر من مبلغ المصروف');
    const id = await this.prisma.$transaction(async (tx) => {
      const e = await tx.expense.create({
        data: { clinicId, categoryId: dto.categoryId, supplierId: dto.supplierId ?? null, description: dto.description ?? null, amount: dto.amount, incurredAt: dto.incurredAt, createdByUserId: user.id },
      });
      if (paid > 0) {
        await tx.expensePayment.create({ data: { clinicId, expenseId: e.id, amount: paid, method: dto.method ?? 'CASH', paidAt: dto.incurredAt, createdByUserId: user.id } });
      }
      await this.audit(tx, clinicId, user.id, 'EXPENSE_CREATED', e.id, { after: { amount: dto.amount, paid, categoryId: dto.categoryId, supplierId: dto.supplierId ?? null } });
      return e.id;
    });
    return this.get(id);
  }

  async update(user: AuthUser, id: string, dto: UpdateExpenseDto) {
    const clinicId = user.clinicId!;
    if (!(await this.tenant.db.expense.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException(NOT_FOUND);
    if (dto.categoryId) await this.usableCategory(dto.categoryId);
    if (dto.supplierId) await this.usableSupplier(dto.supplierId);
    if (dto.incurredAt && dto.incurredAt.getTime() > Date.now() + GRACE_MS) throw new BadRequestException('تاريخ المصروف بالمستقبل');
    await this.prisma.$transaction(async (tx) => {
      const e = await this.lock(tx, clinicId, id);
      if (e.status !== 'ACTIVE') throw new ConflictException('المصروف ملغي');
      if (dto.amount !== undefined && dto.amount < paidTotal(e.payments)) throw new BadRequestException('المبلغ أقل من المدفوع');
      await tx.expense.update({ where: { id }, data: dto });
      await this.audit(tx, clinicId, user.id, 'EXPENSE_UPDATED', id, { before: { amount: e.amount, categoryId: e.categoryId, supplierId: e.supplierId }, after: dto });
    });
    return this.get(id);
  }

  /** A wrong bill is voided with a reason, together with the payments made on it; it stays visible. */
  async void(user: AuthUser, id: string, reason: string) {
    const clinicId = user.clinicId!;
    if (!(await this.tenant.db.expense.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException(NOT_FOUND);
    await this.prisma.$transaction(async (tx) => {
      const e = await this.lock(tx, clinicId, id);
      const done = await tx.expense.updateMany({ where: { id, clinicId, status: 'ACTIVE' }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason, voidedByUserId: user.id } });
      if (done.count !== 1) throw new ConflictException('المصروف ملغي من قبل');
      await tx.expensePayment.updateMany({
        where: { expenseId: id, clinicId, status: 'ACTIVE' },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: `ألغي المصروف: ${reason}`, voidedByUserId: user.id },
      });
      await this.audit(tx, clinicId, user.id, 'EXPENSE_VOIDED', id, { before: { amount: e.amount, paid: paidTotal(e.payments) }, after: { reason } });
    });
    return this.get(id);
  }

  async addPayment(user: AuthUser, id: string, dto: ExpensePaymentDto) {
    const clinicId = user.clinicId!;
    if (!(await this.tenant.db.expense.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException(NOT_FOUND);
    if (dto.paidAt.getTime() > Date.now() + GRACE_MS) throw new BadRequestException('تاريخ الدفعة بالمستقبل');
    await this.prisma.$transaction(async (tx) => {
      const e = await this.lock(tx, clinicId, id);
      if (e.status !== 'ACTIVE') throw new ConflictException('المصروف ملغي');
      if (dto.amount > remainingOf(e.amount, e.payments)) throw new BadRequestException('المبلغ أكبر من المتبقي على المصروف');
      const p = await tx.expensePayment.create({ data: { clinicId, expenseId: id, amount: dto.amount, method: dto.method, paidAt: dto.paidAt, note: dto.note ?? null, createdByUserId: user.id } });
      await this.audit(tx, clinicId, user.id, 'EXPENSE_PAYMENT_CREATED', p.id, { after: { expenseId: id, amount: dto.amount, method: dto.method } });
    });
    return this.get(id);
  }

  async voidPayment(user: AuthUser, paymentId: string, reason: string) {
    const clinicId = user.clinicId!;
    const p = await this.tenant.db.expensePayment.findUnique({ where: { id: paymentId }, select: { id: true, expenseId: true, amount: true } });
    if (!p) throw new NotFoundException('الدفعة غير موجودة');
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, clinicId, p.expenseId);
      const done = await tx.expensePayment.updateMany({ where: { id: paymentId, clinicId, status: 'ACTIVE' }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason, voidedByUserId: user.id } });
      if (done.count !== 1) throw new ConflictException('هذه الدفعة ملغية من قبل');
      await this.audit(tx, clinicId, user.id, 'EXPENSE_PAYMENT_VOIDED', paymentId, { before: { amount: p.amount, expenseId: p.expenseId }, after: { reason } });
    });
    return this.get(p.expenseId);
  }

  // ---------------------------------------------------------------- one period (day, week, month, year)
  /**
   * Income is what patients paid in the period; expenses are what the clinic actually paid out in it
   * (by the day the money left), so profit is plain cash in minus cash out. Bills not paid yet are shown as debt.
   */
  async summary(user: AuthUser, period: Period, date: string) {
    if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new BadRequestException('تاريخ غير صالح');
    const tz = await this.tz(user.clinicId!);
    const r = periodRange(period, date);
    const range = { gte: instantAt(r.from, 0, tz), lt: instantAt(r.to, 0, tz) };
    const [income, paidOut, incurred, categories, owed, salaryPaid] = await Promise.all([
      this.tenant.db.payment.aggregate({ where: { status: 'ACTIVE', paidAt: range }, _sum: { amount: true }, _count: true }),
      this.tenant.db.expensePayment.findMany({ where: { status: 'ACTIVE', paidAt: range }, select: { amount: true, expense: { select: { categoryId: true } } } }),
      this.tenant.db.expense.findMany({ where: { status: 'ACTIVE', incurredAt: range }, select: { amount: true, categoryId: true } }),
      this.tenant.db.expenseCategory.findMany({ select: { id: true, name: true } }),
      this.debts(),
      this.tenant.db.salaryPayment.aggregate({ where: { status: 'ACTIVE', paidAt: range }, _sum: { amount: true } }),
    ]);
    const salaries = salaryPaid._sum.amount ?? 0;
    const byCat = new Map<string, { incurred: number; paid: number }>();
    const slot = (id: string) => byCat.get(id) ?? byCat.set(id, { incurred: 0, paid: 0 }).get(id)!;
    for (const e of incurred) slot(e.categoryId).incurred += e.amount;
    for (const p of paidOut) slot(p.expense.categoryId).paid += p.amount;
    const names = new Map(categories.map((c) => [c.id, c.name]));
    const expensesPaid = paidOut.reduce((t, p) => t + p.amount, 0) + salaries;
    const incomeTotal = income._sum.amount ?? 0;
    return {
      period,
      from: r.from,
      to: addDaysTo(r.to, -1), // the last day, included
      income: incomeTotal,
      incomeCount: income._count,
      expensesPaid,
      expensesIncurred: incurred.reduce((t, e) => t + e.amount, 0) + salaries,
      profit: incomeTotal - expensesPaid,
      byCategory: [
        ...[...byCat.entries()].map(([categoryId, v]) => ({ categoryId, name: names.get(categoryId) ?? '-', ...v })),
        ...(salaries > 0 ? [{ categoryId: 'salaries', name: 'رواتب وسلف', incurred: salaries, paid: salaries }] : []),
      ].sort((a, b) => b.paid + b.incurred - (a.paid + a.incurred) || a.name.localeCompare(b.name, 'ar')),
      owedNow: [...owed.values()].reduce((t, v) => t + v, 0),
    };
  }

  // ---------------------------------------------------------------- internals
  private async lock(tx: Tx, clinicId: string, id: string) {
    const touched = await tx.expense.updateMany({ where: { id, clinicId }, data: { updatedAt: new Date() } });
    if (touched.count !== 1) throw new NotFoundException(NOT_FOUND);
    return tx.expense.findFirstOrThrow({ where: { id, clinicId }, include: { payments: true } });
  }

  private audit(tx: Tx, clinicId: string, actorUserId: string, action: string, id: string, extra: { before?: object; after?: object } = {}) {
    return tx.auditLog.create({ data: { clinicId, actorUserId, action, entityType: action.startsWith('EXPENSE_PAYMENT') ? 'ExpensePayment' : 'Expense', entityId: id, ...extra } as never });
  }
}
