import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { detectImage } from '../clinic/logo.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { localDate } from '../scheduling/clinic-time.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import { paidTotal } from '../treatments/money.js';
import { releaseChequesOf } from './cash-income.js';
import type { CreateChequeDto, CreateOutgoingChequeDto, EndorseChequesDto, ListChequesQuery, UpdateChequeDto } from './cheques.dto.js';
import { ChequeStorage } from './cheques.storage.js';

type Tx = Prisma.TransactionClient;

export const CHEQUE_MAX_BYTES = 10 * 1024 * 1024;
const GRACE_MS = 5 * 60_000; // clock differences between the browser and the server
const NOT_FOUND = 'الشك غير موجود';

const SELECT = {
  id: true,
  direction: true,
  status: true,
  amount: true,
  dueDate: true,
  chequeNumber: true,
  bankName: true,
  accountNumber: true,
  drawerName: true,
  drawerPhone: true,
  notes: true,
  image: true,
  patientId: true,
  treatmentId: true,
  paymentId: true,
  expensePaymentId: true,
  endorsedAt: true,
  cashedAt: true,
  returnedAt: true,
  returnReason: true,
  createdAt: true,
  patient: { select: { id: true, fullName: true } },
  treatment: { select: { id: true, description: true, doctorId: true } },
  // the bill this cheque pays (outgoing) or was handed over for (endorsed): owner only, bills are the owner's
  expensePayment: { select: { expense: { select: { id: true, description: true, category: { select: { name: true } }, supplier: { select: { id: true, name: true } } } } } },
} satisfies Prisma.ChequeSelect;

type Row = Prisma.ChequeGetPayload<{ select: typeof SELECT }>;

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const isComplete = (c: { amount: number | null; dueDate: Date | null }) => c.amount !== null && c.dueDate !== null;

/**
 * Cheques. An incoming cheque is a kind of payment: when it is complete (amount + due date) it owns a Payment of method CHEQUE, so the
 * patient's balance drops at once. It only becomes clinic cash income when it is cashed. A cheque saved without amount or due date is
 * "incomplete": no payment yet, and the clinic keeps being reminded. Same permissions as payments (owner or the payments key; a doctor
 * only on treatments registered under their own name). Nothing is ever deleted: a bad one is returned (voids its payment) or cancelled.
 */
@Injectable()
export class ChequesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantPrismaService,
    private readonly storage: ChequeStorage,
  ) {}

  // ---------------------------------------------------------------- helpers
  private async tz(clinicId: string): Promise<string> {
    return (await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { timezone: true } })).timezone;
  }

  private async ownDoctorId(user: AuthUser): Promise<string | null> {
    if (user.role !== 'DOCTOR') return null;
    const own = await this.tenant.db.doctor.findFirst({ where: { userId: user.id }, select: { id: true } });
    if (!own) throw new ForbiddenException();
    return own.id;
  }

  /** A doctor sees and handles only cheques of treatments registered under their own name. */
  private async scope(user: AuthUser): Promise<Prisma.ChequeWhereInput> {
    if (user.role === 'OWNER') return {};
    const own = await this.ownDoctorId(user);
    // bills (and so the cheques that pay them) are the owner's: everyone else only meets the cheques patients gave
    return own ? { direction: 'INCOMING', treatment: { is: { doctorId: own } } } : { direction: 'INCOMING' };
  }

  private async assertDoctorOwns(user: AuthUser, doctorId: string) {
    const own = await this.ownDoctorId(user);
    if (own && own !== doctorId) throw new ForbiddenException('هذا العلاج غير مسجل باسمك');
  }

  private present(c: Row, today: string, isOwner: boolean) {
    const { image, treatment, expensePayment, expensePaymentId, ...rest } = c;
    const due = day(c.dueDate);
    const bill = isOwner ? expensePayment?.expense : undefined;
    return {
      ...rest,
      // what it paid for (owner only): the bill, and who it was paid to
      bill: bill ? { id: bill.id, description: bill.description, category: bill.category.name, supplier: bill.supplier } : null,
      forBill: expensePaymentId !== null,
      dueDate: due,
      amount: c.amount,
      treatment: treatment ? { id: treatment.id, description: treatment.description } : null,
      hasImage: image !== null,
      incomplete: c.status === 'PENDING' && !isComplete(c),
      // for a cheque still in hand: has its day come?
      due: c.status === 'PENDING' && due ? (due < today ? 'overdue' : due === today ? 'today' : 'later') : null,
    };
  }

  private async load(user: AuthUser, id: string): Promise<Row> {
    const row = await this.tenant.db.cheque.findFirst({ where: { id, ...(await this.scope(user)) }, select: SELECT });
    if (!row) throw new NotFoundException(NOT_FOUND);
    if (row.treatment) await this.assertDoctorOwns(user, row.treatment.doctorId);
    return row;
  }

  /** Locks the treatment row until this transaction ends, so two requests can never both pass the same check. */
  private async lock(tx: Tx, clinicId: string, id: string) {
    const touched = await tx.treatment.updateMany({ where: { id, clinicId }, data: { updatedAt: new Date() } });
    if (touched.count !== 1) throw new NotFoundException('العلاج غير موجود');
    return tx.treatment.findFirstOrThrow({ where: { id, clinicId }, include: { payments: true } });
  }

  /** The same physical cheque must not be recorded twice (same number on the same account). A returned one may come back. */
  private async assertNotDuplicate(chequeNumber: string | null | undefined, accountNumber: string | null | undefined, bankName: string | null | undefined, exceptId?: string, direction: 'INCOMING' | 'OUTGOING' = 'INCOMING') {
    if (!chequeNumber || !accountNumber) return;
    const dup = await this.tenant.db.cheque.findFirst({
      where: { direction, chequeNumber, accountNumber, ...(bankName ? { bankName } : {}), status: { in: ['PENDING', 'CASHED'] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new ConflictException('هذا الشك (نفس الرقم والحساب) مسجل من قبل');
  }

  // ---------------------------------------------------------------- create
  async createIncoming(user: AuthUser, treatmentId: string, dto: CreateChequeDto) {
    const clinicId = user.clinicId!;
    const t = await this.tenant.db.treatment.findUnique({ where: { id: treatmentId }, select: { id: true, patientId: true, doctorId: true, status: true } });
    if (!t) throw new NotFoundException('العلاج غير موجود');
    await this.assertDoctorOwns(user, t.doctorId);
    await this.assertNotDuplicate(dto.chequeNumber, dto.accountNumber, dto.bankName);
    const complete = dto.amount !== undefined && dto.dueDate !== undefined;
    const id = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, clinicId, treatmentId);
      if (locked.status !== 'OPEN') throw new ConflictException(locked.status === 'CLOSED' ? 'العلاج مغلق' : 'العلاج ملغي');
      if (dto.amount !== undefined && dto.amount > locked.totalCost - paidTotal(locked.payments)) throw new BadRequestException('المبلغ أكبر من المتبقي على العلاج');
      const c = await tx.cheque.create({
        data: {
          clinicId,
          direction: 'INCOMING',
          patientId: t.patientId,
          treatmentId,
          amount: dto.amount ?? null,
          dueDate: dto.dueDate ? new Date(`${dto.dueDate}T00:00:00Z`) : null,
          chequeNumber: dto.chequeNumber ?? null,
          bankName: dto.bankName ?? null,
          accountNumber: dto.accountNumber ?? null,
          drawerName: dto.drawerName ?? null,
          drawerPhone: dto.drawerPhone ?? null,
          notes: dto.notes ?? null,
          createdByUserId: user.id,
        },
        select: { id: true },
      });
      if (complete) {
        const p = await tx.payment.create({ data: { clinicId, patientId: t.patientId, treatmentId, amount: dto.amount!, method: 'CHEQUE', paidAt: new Date(), createdByUserId: user.id } });
        await tx.cheque.update({ where: { id: c.id }, data: { paymentId: p.id } });
        await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'PAYMENT_CREATED', entityType: 'Payment', entityId: p.id, after: { treatmentId, amount: dto.amount, method: 'CHEQUE', chequeId: c.id } } });
      }
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'CHEQUE_CREATED', entityType: 'Cheque', entityId: c.id, after: { treatmentId, amount: dto.amount ?? null, dueDate: dto.dueDate ?? null, complete } } });
      return c.id;
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- edit (only while it is still in hand)
  async update(user: AuthUser, id: string, dto: UpdateChequeDto) {
    const clinicId = user.clinicId!;
    const before = await this.load(user, id);
    if (before.direction === 'OUTGOING') return this.updateOutgoing(user, id, before, dto);
    if (before.status !== 'PENDING') throw new ConflictException('لا يمكن تعديل شك بعد صرفه أو ارتجاعه');
    if (!before.treatmentId || !before.patientId) throw new ConflictException('الشك غير مربوط بعلاج');
    await this.assertNotDuplicate(dto.chequeNumber === undefined ? before.chequeNumber : dto.chequeNumber, dto.accountNumber === undefined ? before.accountNumber : dto.accountNumber, dto.bankName === undefined ? before.bankName : dto.bankName, id);
    const treatmentId = before.treatmentId;
    const patientId = before.patientId;
    await this.prisma.$transaction(async (tx) => {
      const t = await this.lock(tx, clinicId, treatmentId);
      const current = await tx.cheque.findFirstOrThrow({ where: { id, clinicId }, select: { status: true, amount: true, dueDate: true, paymentId: true } });
      if (current.status !== 'PENDING') throw new ConflictException('لا يمكن تعديل شك بعد صرفه أو ارتجاعه');
      const amount = dto.amount ?? current.amount;
      const dueDate = dto.dueDate ? new Date(`${dto.dueDate}T00:00:00Z`) : current.dueDate;
      const amountChanged = dto.amount !== undefined && dto.amount !== current.amount;
      if (amountChanged || (!current.paymentId && amount !== null && dueDate !== null)) {
        if (t.status !== 'OPEN') throw new ConflictException('العلاج غير مفتوح');
        const paidWithoutThis = paidTotal(t.payments.filter((p) => p.id !== current.paymentId));
        if (amount! > t.totalCost - paidWithoutThis) throw new BadRequestException('المبلغ أكبر من المتبقي على العلاج');
      }
      let paymentId = current.paymentId;
      if (paymentId) {
        if (amountChanged) await tx.payment.updateMany({ where: { id: paymentId, clinicId, status: 'ACTIVE' }, data: { amount: dto.amount } });
      } else if (amount !== null && dueDate !== null) {
        const p = await tx.payment.create({ data: { clinicId, patientId, treatmentId, amount, method: 'CHEQUE', paidAt: new Date(), createdByUserId: user.id } });
        paymentId = p.id;
        await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'PAYMENT_CREATED', entityType: 'Payment', entityId: p.id, after: { treatmentId, amount, method: 'CHEQUE', chequeId: id } } });
      }
      const { amount: _a, dueDate: _d, ...texts } = dto;
      const moved = await tx.cheque.updateMany({
        where: { id, clinicId, status: 'PENDING' },
        data: { ...texts, ...(dto.amount !== undefined ? { amount: dto.amount } : {}), ...(dto.dueDate ? { dueDate } : {}), paymentId },
      });
      if (moved.count !== 1) throw new ConflictException('لا يمكن تعديل شك بعد صرفه أو ارتجاعه');
      await tx.auditLog.create({
        data: { clinicId, actorUserId: user.id, action: 'CHEQUE_UPDATED', entityType: 'Cheque', entityId: id, before: { amount: current.amount, dueDate: day(current.dueDate) }, after: { amount, dueDate: day(dueDate) } },
      });
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- cashed / returned / cancelled
  async cash(user: AuthUser, id: string, cashedAt: Date | undefined) {
    const clinicId = user.clinicId!;
    const c = await this.load(user, id);
    if (c.status !== 'PENDING') throw new ConflictException('هذا الشك ليس بانتظار الصرف');
    if (!isComplete(c)) throw new ConflictException('أكمل المبلغ وتاريخ الصرف أولاً');
    if (cashedAt && cashedAt.getTime() > Date.now() + GRACE_MS) throw new BadRequestException('تاريخ الصرف في المستقبل');
    const when = cashedAt ?? new Date();
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.cheque.updateMany({ where: { id, clinicId, status: 'PENDING' }, data: { status: 'CASHED', cashedAt: when } });
      if (done.count !== 1) throw new ConflictException('هذا الشك ليس بانتظار الصرف');
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'CHEQUE_CASHED', entityType: 'Cheque', entityId: id, after: { amount: c.amount, cashedAt: when.toISOString() } } });
    });
    return this.get(user, id);
  }

  /** A returned cheque is not money: its payment is voided (the patient owes it again) and the treatment reopens if it had closed. */
  async returnCheque(user: AuthUser, id: string, reason: string | undefined) {
    const clinicId = user.clinicId!;
    const c = await this.load(user, id);
    if (c.direction === 'OUTGOING') throw new BadRequestException('الشك الصادر يُلغى ولا يُرجَع');
    if (c.status !== 'PENDING') throw new ConflictException('يمكن إرجاع الشك قبل صرفه فقط');
    await this.prisma.$transaction(async (tx) => {
      const t = c.treatmentId ? await this.lock(tx, clinicId, c.treatmentId) : null;
      const done = await tx.cheque.updateMany({ where: { id, clinicId, status: 'PENDING' }, data: { status: 'RETURNED', returnedAt: new Date(), returnReason: reason ?? null } });
      if (done.count !== 1) throw new ConflictException('يمكن إرجاع الشك قبل صرفه فقط');
      if (c.paymentId) {
        await tx.payment.updateMany({ where: { id: c.paymentId, clinicId, status: 'ACTIVE' }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: 'شك مرتجع', voidedByUserId: user.id } });
        if (t && t.status === 'CLOSED') await tx.treatment.update({ where: { id: t.id }, data: { status: 'OPEN', closedAt: null } });
        await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'PAYMENT_VOIDED', entityType: 'Payment', entityId: c.paymentId, before: { amount: c.amount }, after: { reason: 'شك مرتجع', chequeId: id } } });
      }
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'CHEQUE_RETURNED', entityType: 'Cheque', entityId: id, after: { reason: reason ?? null } } });
    });
    return this.get(user, id);
  }

  /** For a cheque that was only photographed by mistake (no payment behind it). A complete one is returned instead. */
  async cancel(user: AuthUser, id: string) {
    const clinicId = user.clinicId!;
    const c = await this.load(user, id);
    if (c.direction === 'OUTGOING') return this.cancelOutgoing(user, id, c);
    if (c.status !== 'PENDING' || c.paymentId) throw new ConflictException('لا يمكن إلغاء هذا الشك: استخدم «مرتجع» بدلاً من ذلك');
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.cheque.updateMany({ where: { id, clinicId, status: 'PENDING', paymentId: null }, data: { status: 'CANCELLED' } });
      if (done.count !== 1) throw new ConflictException('لا يمكن إلغاء هذا الشك');
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'CHEQUE_CANCELLED', entityType: 'Cheque', entityId: id } });
    });
    return this.get(user, id);
  }


  // ---------------------------------------------------------------- paying a bill with a cheque (the owner's side)
  /** Locks the bill row until this transaction ends, so two requests can never both pass the same check. */
  private async lockExpense(tx: Tx, clinicId: string, id: string) {
    const touched = await tx.expense.updateMany({ where: { id, clinicId }, data: { updatedAt: new Date() } });
    if (touched.count !== 1) throw new NotFoundException('المصروف غير موجود');
    return tx.expense.findFirstOrThrow({ where: { id, clinicId }, include: { payments: true } });
  }

  private assertPaidAt(paidAt: Date) {
    if (paidAt.getTime() > Date.now() + GRACE_MS) throw new BadRequestException('تاريخ الدفعة في المستقبل');
  }

  /** The clinic writes a cheque to pay (part of) a bill. The bill is paid down at once and it counts as an expense of the day it was handed over; the day it will be cashed is kept for information. */
  async issueForExpense(user: AuthUser, expenseId: string, dto: CreateOutgoingChequeDto) {
    const clinicId = user.clinicId!;
    const paidAt = dto.paidAt ?? new Date();
    this.assertPaidAt(paidAt);
    await this.assertNotDuplicate(dto.chequeNumber, dto.accountNumber, dto.bankName, undefined, 'OUTGOING');
    const id = await this.prisma.$transaction(async (tx) => {
      const e = await this.lockExpense(tx, clinicId, expenseId);
      if (e.status !== 'ACTIVE') throw new ConflictException('المصروف ملغي');
      if (dto.amount > e.amount - paidTotal(e.payments)) throw new BadRequestException('المبلغ أكبر من المتبقي على المصروف');
      const p = await tx.expensePayment.create({ data: { clinicId, expenseId, amount: dto.amount, method: 'CHEQUE', paidAt, createdByUserId: user.id } });
      const c = await tx.cheque.create({
        data: {
          clinicId,
          direction: 'OUTGOING',
          amount: dto.amount,
          dueDate: new Date(`${dto.dueDate}T00:00:00Z`),
          chequeNumber: dto.chequeNumber ?? null,
          bankName: dto.bankName ?? null,
          accountNumber: dto.accountNumber ?? null,
          drawerName: dto.drawerName ?? null,
          drawerPhone: dto.drawerPhone ?? null,
          notes: dto.notes ?? null,
          expensePaymentId: p.id,
          createdByUserId: user.id,
        },
        select: { id: true },
      });
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'EXPENSE_PAYMENT_CREATED', entityType: 'ExpensePayment', entityId: p.id, after: { expenseId, amount: dto.amount, method: 'CHEQUE', chequeId: c.id } } });
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'CHEQUE_ISSUED', entityType: 'Cheque', entityId: c.id, after: { expenseId, amount: dto.amount, dueDate: dto.dueDate } } });
      return c.id;
    });
    return this.get(user, id);
  }

  /**
   * Cheques patients gave us (still in hand) are handed over to pay a bill: one or several, together not more than what is left of it.
   * They leave "not cashed yet", become "handed on" (an outgoing cheque), and count as income AND as expense of that day, so the profit does not move.
   */
  async handOverForExpense(user: AuthUser, expenseId: string, dto: EndorseChequesDto) {
    const clinicId = user.clinicId!;
    const paidAt = dto.paidAt ?? new Date();
    this.assertPaidAt(paidAt);
    const ids = [...new Set(dto.chequeIds)];
    const out = await this.prisma.$transaction(async (tx) => {
      const e = await this.lockExpense(tx, clinicId, expenseId);
      if (e.status !== 'ACTIVE') throw new ConflictException('المصروف ملغي');
      const found = await tx.cheque.findMany({ where: { id: { in: ids }, clinicId, direction: 'INCOMING', status: 'PENDING', amount: { not: null }, dueDate: { not: null } }, select: { id: true, amount: true } });
      if (found.length !== ids.length) throw new ConflictException('بعض الشكات غير متاحة للتحويل (انصرفت أو أُرجعت أو لم تكتمل بياناتها)');
      const total = found.reduce((t, c) => t + c.amount!, 0);
      if (total > e.amount - paidTotal(e.payments)) throw new BadRequestException('مجموع الشكات أكبر من المتبقي على المصروف');
      const p = await tx.expensePayment.create({ data: { clinicId, expenseId, amount: total, method: 'CHEQUE', paidAt, createdByUserId: user.id } });
      const moved = await tx.cheque.updateMany({ where: { id: { in: ids }, clinicId, status: 'PENDING' }, data: { status: 'ENDORSED', endorsedAt: paidAt, expensePaymentId: p.id } });
      if (moved.count !== ids.length) throw new ConflictException('بعض الشكات تغيّرت حالتها للتو، حاول مرة أخرى');
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'EXPENSE_PAYMENT_CREATED', entityType: 'ExpensePayment', entityId: p.id, after: { expenseId, amount: total, method: 'CHEQUE', chequeIds: ids } } });
      for (const c of found) await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'CHEQUE_ENDORSED', entityType: 'Cheque', entityId: c.id, after: { expenseId, amount: c.amount } } });
      return { count: ids.length, total };
    });
    return out;
  }

  private async updateOutgoing(user: AuthUser, id: string, before: Row, dto: UpdateChequeDto) {
    const clinicId = user.clinicId!;
    if (user.role !== 'OWNER') throw new ForbiddenException();
    if (before.status !== 'PENDING') throw new ConflictException('لا يمكن تعديل شك بعد صرفه أو إلغائه');
    if (dto.amount !== undefined && dto.amount !== before.amount) throw new BadRequestException('لا يمكن تغيير مبلغ شك صادر: ألغِه واكتب شكاً جديداً');
    await this.assertNotDuplicate(dto.chequeNumber === undefined ? before.chequeNumber : dto.chequeNumber, dto.accountNumber === undefined ? before.accountNumber : dto.accountNumber, dto.bankName === undefined ? before.bankName : dto.bankName, id, 'OUTGOING');
    const { amount: _a, dueDate, ...texts } = dto;
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.cheque.updateMany({ where: { id, clinicId, status: 'PENDING' }, data: { ...texts, ...(dueDate ? { dueDate: new Date(`${dueDate}T00:00:00Z`) } : {}) } });
      if (moved.count !== 1) throw new ConflictException('لا يمكن تعديل شك بعد صرفه أو إلغائه');
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'CHEQUE_UPDATED', entityType: 'Cheque', entityId: id, before: { dueDate: day(before.dueDate) }, after: { dueDate: dueDate ?? day(before.dueDate) } } });
    });
    return this.get(user, id);
  }

  /** Cancelling a cheque we wrote: its payment on the bill is voided (the bill is owed again). Only while it has not been cashed. */
  private async cancelOutgoing(user: AuthUser, id: string, c: Row) {
    const clinicId = user.clinicId!;
    if (user.role !== 'OWNER') throw new ForbiddenException();
    if (c.status !== 'PENDING' || !c.expensePaymentId) throw new ConflictException('لا يمكن إلغاء هذا الشك');
    const payment = await this.tenant.db.expensePayment.findUnique({ where: { id: c.expensePaymentId }, select: { expenseId: true } });
    if (!payment) throw new NotFoundException('الدفعة غير موجودة');
    await this.prisma.$transaction(async (tx) => {
      await this.lockExpense(tx, clinicId, payment.expenseId);
      const done = await tx.cheque.updateMany({ where: { id, clinicId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      if (done.count !== 1) throw new ConflictException('لا يمكن إلغاء هذا الشك');
      await tx.expensePayment.updateMany({ where: { id: c.expensePaymentId!, clinicId, status: 'ACTIVE' }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: 'شك صادر مُلغى', voidedByUserId: user.id } });
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'CHEQUE_CANCELLED', entityType: 'Cheque', entityId: id, after: { expensePaymentId: c.expensePaymentId } } });
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- reading
  async get(user: AuthUser, id: string) {
    const today = localDate(new Date(), await this.tz(user.clinicId!));
    return this.present(await this.load(user, id), today, user.role === 'OWNER');
  }

  async list(user: AuthUser, q: ListChequesQuery) {
    const scope = await this.scope(user);
    const today = localDate(new Date(), await this.tz(user.clinicId!));
    const filters: Prisma.ChequeWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.dueDate ? { dueDate: new Date(`${q.dueDate}T00:00:00Z`) } : {}),
      ...(q.treatmentId ? { treatmentId: q.treatmentId } : {}),
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(q.incomplete ? { status: 'PENDING', OR: [{ amount: null }, { dueDate: null }] } : {}),
      ...(q.q
        ? {
            AND: [
              {
                OR: [
                  { drawerName: { contains: q.q, mode: 'insensitive' } },
                  { chequeNumber: { contains: q.q } },
                  { bankName: { contains: q.q, mode: 'insensitive' } },
                  { patient: { is: { fullName: { contains: q.q, mode: 'insensitive' } } } },
                  // what we paid with it (the owner only ever has these: others' scope shows incoming cheques, whose bill is hidden anyway)
                  ...(user.role === 'OWNER' ? [{ expensePayment: { is: { expense: { is: { supplier: { is: { name: { contains: q.q, mode: 'insensitive' as const } } } } } } } }] : []),
                ],
              },
            ],
          }
        : {}),
    };
    // the "outgoing" tab also holds the incoming cheques we handed over to pay a bill (owner only)
    const dir: Prisma.ChequeWhereInput = !q.direction ? {} : q.direction === 'OUTGOING' && user.role === 'OWNER' ? { OR: [{ direction: 'OUTGOING' }, { status: 'ENDORSED' }] } : { direction: q.direction };
    const where: Prisma.ChequeWhereInput = { AND: [scope, filters, dir] }; // the scope can never be widened by a filter
    const finished = q.status === 'CASHED' || q.status === 'RETURNED' || q.status === 'CANCELLED';
    const items = await this.tenant.db.cheque.findMany({
      where,
      select: SELECT,
      orderBy: [{ dueDate: { sort: finished ? 'desc' : 'asc', nulls: 'first' } }, { createdAt: 'desc' }, { id: 'asc' }],
      take: 300,
    });
    return { items: items.map((c) => this.present(c, today, user.role === 'OWNER')),
      totals: await this.totals(scope, 'INCOMING', today),
      // what we wrote ourselves to pay bills: the owner's only
      outgoing: user.role === 'OWNER' ? await this.totals(scope, 'OUTGOING', today) : null,
    };
  }

  /** The "cheques box": what is still in hand, what was cashed, what came back; plus what needs attention today. */
  private async totals(scope: Prisma.ChequeWhereInput, direction: 'INCOMING' | 'OUTGOING', today: string) {
    const base: Prisma.ChequeWhereInput = { ...scope, direction };
    const [pending, finished] = await Promise.all([
      this.tenant.db.cheque.findMany({ where: { ...base, status: 'PENDING' }, select: { amount: true, dueDate: true } }),
      this.tenant.db.cheque.groupBy({ by: ['status'], where: { ...base, status: { in: ['CASHED', 'RETURNED', 'ENDORSED'] } }, _sum: { amount: true }, _count: true }),
    ]);
    const box = { count: 0, amount: 0 };
    const out = { pending: { ...box }, overdue: { ...box }, dueToday: { ...box }, cashed: { ...box }, returned: { ...box }, endorsed: { ...box }, incomplete: 0 };
    for (const p of pending) {
      if (p.amount === null || p.dueDate === null) {
        out.incomplete += 1;
        continue;
      }
      out.pending.count += 1;
      out.pending.amount += p.amount;
      const due = day(p.dueDate)!;
      const bucket = due < today ? out.overdue : due === today ? out.dueToday : null;
      if (bucket) {
        bucket.count += 1;
        bucket.amount += p.amount;
      }
    }
    for (const g of finished) {
      const bucket = g.status === 'CASHED' ? out.cashed : g.status === 'RETURNED' ? out.returned : out.endorsed;
      bucket.count = g._count;
      bucket.amount = g._sum.amount ?? 0;
    }
    return out;
  }

  /** For the home page: only what needs attention. */
  async summary(user: AuthUser) {
    const today = localDate(new Date(), await this.tz(user.clinicId!));
    const scope = await this.scope(user);
    const t = await this.totals(scope, 'INCOMING', today);
    const o = user.role === 'OWNER' ? await this.totals(scope, 'OUTGOING', today) : null;
    return { incomplete: t.incomplete, dueToday: t.dueToday, overdue: t.overdue, pending: t.pending, outgoing: o ? { dueToday: o.dueToday, overdue: o.overdue, pending: o.pending } : null };
  }

  // ---------------------------------------------------------------- photo
  async setImage(user: AuthUser, id: string, data: Buffer) {
    const clinicId = user.clinicId!;
    const c = await this.load(user, id);
    if (c.status !== 'PENDING') throw new ConflictException('لا يمكن تغيير صورة الشك بعد صرفه أو ارتجاعه');
    const kind = detectImage(data);
    if (!kind) throw new UnsupportedMediaTypeException('يجب أن يكون الملف صورة (JPG أو PNG أو WEBP)');
    const file = await this.storage.save(clinicId, data, kind);
    const old = await this.tenant.db.cheque.findUnique({ where: { id }, select: { image: true } });
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.cheque.updateMany({ where: { id, clinicId }, data: { image: file, imageMime: kind.mime, imageSize: data.length } });
        await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'CHEQUE_IMAGE_SET', entityType: 'Cheque', entityId: id, after: { size: data.length } } });
      });
    } catch (e) {
      await this.storage.remove(file); // the database refused: do not leave an orphan file
      throw e;
    }
    if (old?.image) await this.storage.remove(old.image);
    return this.get(user, id);
  }

  /** The photo is only ever sent to a logged-in user of the SAME clinic who may see this cheque: the stored name is never a link. */
  async imageOf(user: AuthUser, id: string) {
    await this.load(user, id);
    const c = await this.tenant.db.cheque.findUnique({ where: { id }, select: { image: true, imageMime: true } });
    const path = c?.image ? this.storage.pathOf(c.image) : null;
    if (!c || !path || !c.imageMime) throw new NotFoundException('لا توجد صورة لهذا الشك');
    return { path, mime: c.imageMime };
  }
}
