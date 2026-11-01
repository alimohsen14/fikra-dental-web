import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import { moneyOf, paidTotal, shouldClose } from './money.js';
import type { CreatePaymentDto, CreateTreatmentDto, ListTreatmentsQuery, UpdateTreatmentDto } from './treatments.dto.js';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = 'العلاج غير موجود';
const GRACE_MS = 5 * 60_000; // clock differences between the browser and the server

const DETAIL = {
  id: true,
  patientId: true,
  doctorId: true,
  treatmentTypeId: true,
  appointmentId: true,
  description: true,
  totalCost: true,
  plannedSessions: true,
  status: true,
  startedAt: true,
  closedAt: true,
  createdAt: true,
  treatmentType: { select: { id: true, name: true } },
  doctor: { select: { id: true, fullName: true } },
  patient: { select: { id: true, fullName: true } },
  teeth: { select: { toothCode: true }, orderBy: { toothCode: 'asc' } },
  sessions: { orderBy: { number: 'asc' }, select: { id: true, number: true, status: true, completedAt: true, notes: true, appointmentId: true } },
  payments: {
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, amount: true, method: true, paidAt: true, note: true, status: true, voidedAt: true, voidReason: true, createdAt: true },
  },
} satisfies Prisma.TreatmentSelect;

/** Owner, or any account the owner gave the payments key. */
export const canSeeMoney = (u: AuthUser): boolean => u.role === 'OWNER' || u.canManagePayments;

@Injectable()
export class TreatmentsService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------- who can see what
  /** A secretary only gets in with the payments key (she then sees money, never edits treatments). A doctor sees only their own. */
  private async scopeFor(user: AuthUser): Promise<{ doctorId?: string }> {
    if (user.role === 'SECRETARY' && !user.canManagePayments) throw new ForbiddenException();
    if (user.role !== 'DOCTOR') return {};
    const own = await this.tenant.db.doctor.findFirst({ where: { userId: user.id }, select: { id: true } });
    if (!own) throw new ForbiddenException();
    return { doctorId: own.id };
  }

  private present<T extends { teeth: { toothCode: number }[]; totalCost: number; payments: { amount: number; status: string }[] }>(row: T, user: AuthUser) {
    const { teeth, payments, ...rest } = row;
    const base = { ...rest, toothCodes: teeth.map((t) => t.toothCode) };
    if (!canSeeMoney(user)) return base;
    return { ...base, ...moneyOf(row.totalCost, payments as { amount: number; status: 'ACTIVE' | 'VOIDED' }[]), payments };
  }

  private async load(user: AuthUser, id: string) {
    const scope = await this.scopeFor(user);
    const row = await this.tenant.db.treatment.findFirst({ where: { id, ...scope }, select: DETAIL });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  async get(user: AuthUser, id: string) {
    return this.present(await this.load(user, id), user);
  }

  async list(user: AuthUser, q: ListTreatmentsQuery) {
    const scope = await this.scopeFor(user);
    const rows = await this.tenant.db.treatment.findMany({
      where: { ...scope, ...(q.patientId ? { patientId: q.patientId } : {}), ...(q.status ? { status: q.status } : {}) },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
      take: 500,
      select: DETAIL,
    });
    return rows.map((r) => this.present(r, user));
  }

  // ---------------------------------------------------------------- shared helpers
  /** Locks the treatment row until this transaction ends, so two requests can never both pass the same check. */
  private async lock(tx: Tx, clinicId: string, id: string) {
    const touched = await tx.treatment.updateMany({ where: { id, clinicId }, data: { updatedAt: new Date() } });
    if (touched.count !== 1) throw new NotFoundException(NOT_FOUND);
    return tx.treatment.findFirstOrThrow({ where: { id, clinicId }, include: { sessions: true, payments: true } });
  }

  /** Closes the treatment when it is fully paid and every session is done. Never closes anything else. */
  private async settle(tx: Tx, clinicId: string, id: string) {
    const t = await tx.treatment.findFirstOrThrow({ where: { id, clinicId }, include: { sessions: true, payments: true } });
    if (t.status === 'OPEN' && shouldClose(t.totalCost, t.payments, t.sessions)) {
      await tx.treatment.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
      await tx.auditLog.create({ data: { clinicId, action: 'TREATMENT_CLOSED', entityType: 'Treatment', entityId: id } });
    }
  }

  private audit(tx: Tx, clinicId: string, actorUserId: string, action: string, id: string, extra: { before?: object; after?: object } = {}) {
    return tx.auditLog.create({ data: { clinicId, actorUserId, action, entityType: 'Treatment', entityId: id, ...extra } as never });
  }

  // ---------------------------------------------------------------- treatments
  async create(user: AuthUser, dto: CreateTreatmentDto) {
    const clinicId = user.clinicId!;
    const own = user.role === 'DOCTOR' ? await this.tenant.db.doctor.findFirst({ where: { userId: user.id }, select: { id: true } }) : null;
    if (user.role === 'DOCTOR') {
      if (!own) throw new ForbiddenException();
      if (dto.doctorId && dto.doctorId !== own.id) throw new ForbiddenException('بتقدر تسجل علاجات على مرضاك أنت بس');
    }
    const ownerDoctor = user.role === 'OWNER' && !dto.doctorId ? await this.tenant.db.doctor.findFirst({ where: { userId: user.id }, select: { id: true } }) : null;
    const doctorId = own?.id ?? dto.doctorId ?? ownerDoctor?.id;
    if (!doctorId) throw new BadRequestException('اختر الدكتور');

    const [patient, doctor, type] = await Promise.all([
      this.tenant.db.patient.findUnique({ where: { id: dto.patientId }, select: { id: true, archivedAt: true } }),
      this.tenant.db.doctor.findUnique({ where: { id: doctorId }, select: { id: true, isActive: true } }),
      this.tenant.db.treatmentType.findUnique({ where: { id: dto.treatmentTypeId }, select: { id: true, isActive: true } }),
    ]);
    if (!patient) throw new NotFoundException('المريض غير موجود');
    if (patient.archivedAt) throw new BadRequestException('هذا المريض بالأرشيف');
    if (!doctor) throw new NotFoundException('الدكتور غير موجود');
    if (!doctor.isActive) throw new BadRequestException('هذا الدكتور موقوف');
    if (!type) throw new NotFoundException('نوع العلاج غير موجود');
    if (!type.isActive) throw new BadRequestException('نوع العلاج هذا موقوف');
    if (dto.startedAt && dto.startedAt.getTime() > Date.now() + GRACE_MS) throw new BadRequestException('تاريخ بداية العلاج بالمستقبل');

    if (dto.appointmentId) {
      const apt = await this.tenant.db.appointment.findUnique({ where: { id: dto.appointmentId }, select: { patientId: true, doctorId: true, status: true } });
      if (!apt) throw new NotFoundException('الموعد غير موجود');
      if (apt.patientId !== dto.patientId || apt.doctorId !== doctorId) throw new BadRequestException('الموعد مش لنفس المريض والدكتور');
      if (apt.status === 'CANCELLED') throw new BadRequestException('الموعد ملغي');
      if (await this.tenant.db.treatment.findFirst({ where: { appointmentId: dto.appointmentId }, select: { id: true } })) throw new ConflictException('هذا الموعد مربوط بعلاج');
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const t = await tx.treatment.create({
        data: {
          clinicId,
          patientId: dto.patientId,
          doctorId,
          treatmentTypeId: dto.treatmentTypeId,
          appointmentId: dto.appointmentId ?? null,
          description: dto.description ?? null,
          totalCost: dto.totalCost,
          plannedSessions: dto.plannedSessions,
          startedAt: dto.startedAt ?? new Date(),
        },
      });
      await tx.treatmentTooth.createMany({ data: dto.toothCodes.map((toothCode) => ({ clinicId, treatmentId: t.id, toothCode })) });
      await tx.session.createMany({ data: Array.from({ length: dto.plannedSessions }, (_, i) => ({ clinicId, treatmentId: t.id, number: i + 1 })) });
      await this.audit(tx, clinicId, user.id, 'TREATMENT_CREATED', t.id, { after: { patientId: dto.patientId, totalCost: dto.totalCost, plannedSessions: dto.plannedSessions, toothCodes: dto.toothCodes } });
      return t.id;
    });
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, dto: UpdateTreatmentDto) {
    await this.load(user, id); // 404 if it is not yours to see
    const clinicId = user.clinicId!;
    if (dto.treatmentTypeId) {
      const type = await this.tenant.db.treatmentType.findUnique({ where: { id: dto.treatmentTypeId }, select: { isActive: true } });
      if (!type) throw new NotFoundException('نوع العلاج غير موجود');
      if (!type.isActive) throw new BadRequestException('نوع العلاج هذا موقوف');
    }
    await this.prisma.$transaction(async (tx) => {
      const t = await this.lock(tx, clinicId, id);
      if (t.status !== 'OPEN') throw new ConflictException('العلاج مش مفتوح، ما بينعدل');
      if (dto.totalCost !== undefined && dto.totalCost < paidTotal(t.payments)) throw new BadRequestException('التكلفة أقل من المبلغ المدفوع');

      if (dto.plannedSessions !== undefined && dto.plannedSessions !== t.plannedSessions) {
        if (dto.plannedSessions > t.plannedSessions) {
          await tx.session.createMany({ data: Array.from({ length: dto.plannedSessions - t.plannedSessions }, (_, i) => ({ clinicId, treatmentId: id, number: t.plannedSessions + i + 1 })) });
        } else {
          const doomed = t.sessions.filter((s) => s.number > dto.plannedSessions!);
          if (doomed.some((s) => s.status === 'COMPLETED' || s.appointmentId)) throw new BadRequestException('ما بتقدر تنقص جلسات منتهية أو محجوزة');
          await tx.session.deleteMany({ where: { treatmentId: id, number: { gt: dto.plannedSessions } } });
        }
      }
      if (dto.toothCodes) {
        await tx.treatmentTooth.deleteMany({ where: { treatmentId: id } });
        await tx.treatmentTooth.createMany({ data: dto.toothCodes.map((toothCode) => ({ clinicId, treatmentId: id, toothCode })) });
      }
      await tx.treatment.update({
        where: { id },
        data: {
          ...(dto.treatmentTypeId !== undefined ? { treatmentTypeId: dto.treatmentTypeId } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.totalCost !== undefined ? { totalCost: dto.totalCost } : {}),
          ...(dto.plannedSessions !== undefined ? { plannedSessions: dto.plannedSessions } : {}),
        },
      });
      await this.audit(tx, clinicId, user.id, 'TREATMENT_UPDATED', id, {
        before: { totalCost: t.totalCost, plannedSessions: t.plannedSessions },
        after: { ...(dto.totalCost !== undefined ? { totalCost: dto.totalCost } : {}), ...(dto.plannedSessions !== undefined ? { plannedSessions: dto.plannedSessions } : {}), fields: Object.keys(dto) },
      });
      await this.settle(tx, clinicId, id);
    });
    return this.get(user, id);
  }

  async completeSession(user: AuthUser, id: string, number: number, notes: string | undefined) {
    await this.load(user, id);
    const clinicId = user.clinicId!;
    await this.prisma.$transaction(async (tx) => {
      const t = await this.lock(tx, clinicId, id);
      if (t.status !== 'OPEN') throw new ConflictException('العلاج مش مفتوح');
      const session = t.sessions.find((s) => s.number === number);
      if (!session) throw new NotFoundException('الجلسة غير موجودة');
      const done = await tx.session.updateMany({
        where: { id: session.id, clinicId, status: 'PLANNED' },
        data: { status: 'COMPLETED', completedAt: new Date(), ...(notes !== undefined ? { notes } : {}) },
      });
      if (done.count !== 1) throw new ConflictException('هذه الجلسة منتهية من قبل');
      await this.audit(tx, clinicId, user.id, 'SESSION_COMPLETED', id, { after: { number } });
      await this.settle(tx, clinicId, id);
    });
    return this.get(user, id);
  }

  async cancel(user: AuthUser, id: string, reason: string | undefined) {
    await this.load(user, id);
    const clinicId = user.clinicId!;
    await this.prisma.$transaction(async (tx) => {
      const t = await this.lock(tx, clinicId, id);
      if (t.status !== 'OPEN') throw new ConflictException('العلاج مش مفتوح');
      if (paidTotal(t.payments) > 0) throw new ConflictException('في دفعات على هذا العلاج: لازم المالك يلغيها أولاً');
      await tx.treatment.update({ where: { id }, data: { status: 'CANCELLED', closedAt: new Date() } });
      await this.audit(tx, clinicId, user.id, 'TREATMENT_CANCELLED', id, { after: { reason: reason ?? null } });
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- payments
  async addPayment(user: AuthUser, id: string, dto: CreatePaymentDto) {
    const row = await this.load(user, id);
    const clinicId = user.clinicId!;
    if (dto.paidAt.getTime() > Date.now() + GRACE_MS) throw new BadRequestException('تاريخ الدفعة بالمستقبل');
    await this.prisma.$transaction(async (tx) => {
      const t = await this.lock(tx, clinicId, id);
      if (t.status !== 'OPEN') throw new ConflictException(t.status === 'CLOSED' ? 'العلاج مغلق' : 'العلاج ملغي');
      const remaining = t.totalCost - paidTotal(t.payments);
      if (dto.amount > remaining) throw new BadRequestException('المبلغ أكبر من المتبقي على العلاج');
      const p = await tx.payment.create({
        data: { clinicId, patientId: row.patientId, treatmentId: id, amount: dto.amount, method: dto.method, paidAt: dto.paidAt, note: dto.note ?? null, createdByUserId: user.id },
      });
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'PAYMENT_CREATED', entityType: 'Payment', entityId: p.id, after: { treatmentId: id, amount: dto.amount, method: dto.method } } });
      await this.settle(tx, clinicId, id);
    });
    return this.get(user, id);
  }

  /** A wrong payment is never deleted: the owner voids it with a written reason and it stays visible. */
  async voidPayment(user: AuthUser, paymentId: string, reason: string) {
    const clinicId = user.clinicId!;
    const payment = await this.tenant.db.payment.findUnique({ where: { id: paymentId }, select: { id: true, treatmentId: true } });
    if (!payment) throw new NotFoundException('الدفعة غير موجودة');
    await this.prisma.$transaction(async (tx) => {
      const t = await this.lock(tx, clinicId, payment.treatmentId);
      const p = t.payments.find((x) => x.id === paymentId);
      if (!p) throw new NotFoundException('الدفعة غير موجودة');
      const voided = await tx.payment.updateMany({
        where: { id: paymentId, clinicId, status: 'ACTIVE' },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason, voidedByUserId: user.id },
      });
      if (voided.count !== 1) throw new ConflictException('هذه الدفعة ملغية من قبل');
      if (t.status === 'CLOSED') await tx.treatment.update({ where: { id: t.id }, data: { status: 'OPEN', closedAt: null } }); // the money is owed again
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'PAYMENT_VOIDED', entityType: 'Payment', entityId: paymentId, before: { amount: p.amount, treatmentId: t.id }, after: { reason } } });
    });
    return this.get(user, payment.treatmentId);
  }

  // ---------------------------------------------------------------- patient money summary
  async patientFinance(user: AuthUser, patientId: string) {
    const scope = await this.scopeFor(user);
    const patient = await this.tenant.db.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('المريض غير موجود');
    const rows = await this.tenant.db.treatment.findMany({
      where: { patientId, status: { not: 'CANCELLED' }, ...scope },
      select: { totalCost: true, status: true, payments: { select: { amount: true, status: true } } },
    });
    let total = 0;
    let paid = 0;
    for (const r of rows) {
      total += r.totalCost;
      paid += paidTotal(r.payments);
    }
    return { treatments: rows.length, openTreatments: rows.filter((r) => r.status === 'OPEN').length, total, paid, remaining: Math.max(0, total - paid) };
  }
}
