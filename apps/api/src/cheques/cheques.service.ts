import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { detectImage } from '../clinic/logo.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { localDate } from '../scheduling/clinic-time.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import { paidTotal } from '../treatments/money.js';
import type { CreateChequeDto, ListChequesQuery, UpdateChequeDto } from './cheques.dto.js';
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
  cashedAt: true,
  returnedAt: true,
  returnReason: true,
  createdAt: true,
  patient: { select: { id: true, fullName: true } },
  treatment: { select: { id: true, description: true, doctorId: true } },
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
    const own = await this.ownDoctorId(user);
    return own ? { treatment: { is: { doctorId: own } } } : {};
  }

  private async assertDoctorOwns(user: AuthUser, doctorId: string) {
    const own = await this.ownDoctorId(user);
    if (own && own !== doctorId) throw new ForbiddenException('هذا العلاج غير مسجل باسمك');
  }

  private present(c: Row, today: string) {
    const { image, treatment, ...rest } = c;
    const due = day(c.dueDate);
    return {
      ...rest,
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
  private async assertNotDuplicate(chequeNumber: string | null | undefined, accountNumber: string | null | undefined, bankName: string | null | undefined, exceptId?: string) {
    if (!chequeNumber || !accountNumber) return;
    const dup = await this.tenant.db.cheque.findFirst({
      where: { direction: 'INCOMING', chequeNumber, accountNumber, ...(bankName ? { bankName } : {}), status: { in: ['PENDING', 'CASHED'] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
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
    if (before.direction !== 'INCOMING') throw new BadRequestException('غير مدعوم');
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
    if (c.status !== 'PENDING' || c.paymentId) throw new ConflictException('لا يمكن إلغاء هذا الشك: استخدم «مرتجع» بدلاً من ذلك');
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.cheque.updateMany({ where: { id, clinicId, status: 'PENDING', paymentId: null }, data: { status: 'CANCELLED' } });
      if (done.count !== 1) throw new ConflictException('لا يمكن إلغاء هذا الشك');
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'CHEQUE_CANCELLED', entityType: 'Cheque', entityId: id } });
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- reading
  async get(user: AuthUser, id: string) {
    const today = localDate(new Date(), await this.tz(user.clinicId!));
    return this.present(await this.load(user, id), today);
  }

  async list(user: AuthUser, q: ListChequesQuery) {
    const scope = await this.scope(user);
    const today = localDate(new Date(), await this.tz(user.clinicId!));
    const where: Prisma.ChequeWhereInput = {
      ...scope,
      ...(q.direction ? { direction: q.direction } : {}),
      ...(q.status ? { status: q.status } : {}),
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
                ],
              },
            ],
          }
        : {}),
    };
    const finished = q.status === 'CASHED' || q.status === 'RETURNED' || q.status === 'CANCELLED';
    const items = await this.tenant.db.cheque.findMany({
      where,
      select: SELECT,
      orderBy: [{ dueDate: { sort: finished ? 'desc' : 'asc', nulls: 'first' } }, { createdAt: 'desc' }, { id: 'asc' }],
      take: 300,
    });
    return { items: items.map((c) => this.present(c, today)), totals: await this.totals(scope, q.direction ?? 'INCOMING', today) };
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
    const t = await this.totals(await this.scope(user), 'INCOMING', today);
    return { incomplete: t.incomplete, dueToday: t.dueToday, overdue: t.overdue, pending: t.pending };
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
