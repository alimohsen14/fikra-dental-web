import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AppointmentsService } from '../scheduling/appointments.service.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import { moneyOf, paidTotal } from './money.js';
import type { BookSessionDto, CreatePaymentDto, CreateTreatmentDto, ListTreatmentsQuery, UpdateTreatmentDto } from './treatments.dto.js';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = 'العلاج غير موجود';
const GRACE_MS = 5 * 60_000; // clock differences between the browser and the server

const DETAIL = {
  id: true,
  patientId: true,
  doctorId: true,
  appointmentId: true,
  description: true,
  totalCost: true,
  plannedSessions: true,
  status: true,
  startedAt: true,
  closedAt: true,
  createdAt: true,
  doctor: { select: { id: true, fullName: true } },
  patient: { select: { id: true, fullName: true } },
  teeth: { select: { toothCode: true, treatmentTypeId: true, treatmentType: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } } }, orderBy: { toothCode: 'asc' } },
  sessions: { orderBy: { number: 'asc' }, select: { id: true, number: true, status: true, completedAt: true, notes: true, appointmentId: true, appointment: { select: { id: true, startsAt: true, endsAt: true, status: true } } } },
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
    private readonly appointments: AppointmentsService,
  ) {}

  // ---------------------------------------------------------------- who can see what / who can change what
  /** Everyone who may open treatments sees all of them (doctors hand patients over to each other). A secretary only gets in with the payments key. */
  private async scopeFor(user: AuthUser): Promise<{ doctorId?: string }> {
    if (user.role === 'SECRETARY' && !user.canManagePayments) throw new ForbiddenException();
    return {};
  }

  private async ownDoctorId(user: AuthUser): Promise<string | null> {
    if (user.role !== 'DOCTOR') return null;
    const own = await this.tenant.db.doctor.findFirst({ where: { userId: user.id }, select: { id: true } });
    if (!own) throw new ForbiddenException();
    return own.id;
  }

  /** A doctor may change ONLY treatments registered under their own name: no edit, no session, no close, no cancel, no booking, no payment. */
  private async assertCanAct(user: AuthUser, treatmentDoctorId: string) {
    if (user.role !== 'DOCTOR') return;
    if ((await this.ownDoctorId(user)) !== treatmentDoctorId) throw new ForbiddenException('هذا العلاج مش مسجل باسمك: بتقدر تشوفه بس ما بتقدر تعدّل عليه');
  }

  /** What this user may do on this treatment, so the screen shows only buttons that will work. */
  private access(user: AuthUser, treatmentDoctorId: string, ownId: string | null) {
    const mine = user.role === 'OWNER' || (user.role === 'DOCTOR' && ownId === treatmentDoctorId);
    return { edit: mine, pay: (mine || user.role === 'SECRETARY') && canSeeMoney(user) };
  }

  private present<T extends { doctorId: string; teeth: { toothCode: number }[]; totalCost: number; payments: { amount: number; status: string }[] }>(row: T, user: AuthUser, ownId: string | null) {
    const { teeth, payments, ...rest } = row;
    const base = { ...rest, teeth, toothCodes: teeth.map((t) => t.toothCode), access: this.access(user, row.doctorId, ownId) };
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
    return this.present(await this.load(user, id), user, await this.ownDoctorId(user));
  }

  async list(user: AuthUser, q: ListTreatmentsQuery) {
    const scope = await this.scopeFor(user);
    const rows = await this.tenant.db.treatment.findMany({
      where: { ...scope, ...(q.patientId ? { patientId: q.patientId } : {}), ...(q.status ? { status: q.status } : {}) },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
      take: 500,
      select: DETAIL,
    });
    const ownId = await this.ownDoctorId(user);
    return rows.map((r) => this.present(r, user, ownId));
  }

  /** A treatment points at the most specific type: a type that has sub-types cannot be chosen itself. */
  private async usableTypes(ids: string[]) {
    for (const id of new Set(ids)) await this.usableType(id);
  }

  private async usableType(id: string) {
    const type = await this.tenant.db.treatmentType.findUnique({
      where: { id },
      select: { isActive: true, parent: { select: { isActive: true } }, children: { where: { isActive: true }, select: { id: true }, take: 1 } },
    });
    if (!type) throw new NotFoundException('نوع العلاج غير موجود');
    if (!type.isActive || type.parent?.isActive === false) throw new BadRequestException('نوع العلاج هذا موقوف');
    if (type.children.length > 0) throw new BadRequestException('اختر النوع الفرعي');
  }

  // ---------------------------------------------------------------- shared helpers
  /** Locks the treatment row until this transaction ends, so two requests can never both pass the same check. */
  private async lock(tx: Tx, clinicId: string, id: string) {
    const touched = await tx.treatment.updateMany({ where: { id, clinicId }, data: { updatedAt: new Date() } });
    if (touched.count !== 1) throw new NotFoundException(NOT_FOUND);
    return tx.treatment.findFirstOrThrow({ where: { id, clinicId }, include: { sessions: true, payments: true } });
  }

  /** Marks a still-open appointment as done. A cancelled or already finished one is left alone. */
  /**
   * The visit happened: the appointment is completed. If the patient came before the booked time, the appointment
   * moves to the real time of the visit, so the booked day empties and the visit shows on the day it happened.
   */
  private async completeAppointment(tx: Tx, clinicId: string, appointmentId: string) {
    const apt = await tx.appointment.findFirst({ where: { id: appointmentId, clinicId, status: { in: ['PENDING', 'CONFIRMED'] } }, select: { startsAt: true, endsAt: true } });
    if (!apt) return;
    const now = new Date();
    const early = apt.startsAt.getTime() > now.getTime();
    const startsAt = early ? new Date(Math.floor(now.getTime() / 60_000) * 60_000) : apt.startsAt;
    const endsAt = early ? new Date(startsAt.getTime() + (apt.endsAt.getTime() - apt.startsAt.getTime())) : apt.endsAt;
    await tx.appointment.updateMany({ where: { id: appointmentId, clinicId }, data: { status: 'COMPLETED', completedAt: now, ...(early ? { startsAt, endsAt } : {}) } });
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

    const [patient, doctor] = await Promise.all([
      this.tenant.db.patient.findUnique({ where: { id: dto.patientId }, select: { id: true, archivedAt: true } }),
      this.tenant.db.doctor.findUnique({ where: { id: doctorId }, select: { id: true, isActive: true } }),
    ]);
    if (!patient) throw new NotFoundException('المريض غير موجود');
    if (patient.archivedAt) throw new BadRequestException('هذا المريض بالأرشيف');
    if (!doctor) throw new NotFoundException('الدكتور غير موجود');
    if (!doctor.isActive) throw new BadRequestException('هذا الدكتور موقوف');
    await this.usableTypes(dto.teeth.map((t) => t.treatmentTypeId));
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
          appointmentId: dto.appointmentId ?? null,
          description: dto.description ?? null,
          totalCost: dto.totalCost,
          plannedSessions: dto.plannedSessions,
          startedAt: dto.startedAt ?? new Date(),
        },
      });
      await tx.treatmentTooth.createMany({ data: dto.teeth.map((x) => ({ clinicId, treatmentId: t.id, toothCode: x.toothCode, treatmentTypeId: x.treatmentTypeId })) });
      await tx.session.createMany({ data: Array.from({ length: dto.plannedSessions }, (_, i) => ({ clinicId, treatmentId: t.id, number: i + 1 })) });
      // A patient who registered himself through the booking page becomes an ordinary patient once a treatment is opened for him.
      await tx.patient.updateMany({ where: { id: dto.patientId, clinicId, selfRegistered: true }, data: { selfRegistered: false } });
      // Opening a treatment on an appointment means the visit happened: the appointment is completed.
      if (dto.appointmentId) await this.completeAppointment(tx, clinicId, dto.appointmentId);
      await this.audit(tx, clinicId, user.id, 'TREATMENT_CREATED', t.id, { after: { patientId: dto.patientId, totalCost: dto.totalCost, plannedSessions: dto.plannedSessions, toothCodes: dto.teeth.map((x) => x.toothCode) } });
      return t.id;
    });
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, dto: UpdateTreatmentDto) {
    await this.assertCanAct(user, (await this.load(user, id)).doctorId);
    const clinicId = user.clinicId!;
    if (dto.teeth) await this.usableTypes(dto.teeth.map((t) => t.treatmentTypeId));
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
      if (dto.teeth) {
        await tx.treatmentTooth.deleteMany({ where: { treatmentId: id } });
        await tx.treatmentTooth.createMany({ data: dto.teeth.map((x) => ({ clinicId, treatmentId: id, toothCode: x.toothCode, treatmentTypeId: x.treatmentTypeId })) });
      }
      await tx.treatment.update({
        where: { id },
        data: {
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.totalCost !== undefined ? { totalCost: dto.totalCost } : {}),
          ...(dto.plannedSessions !== undefined ? { plannedSessions: dto.plannedSessions } : {}),
        },
      });
      await this.audit(tx, clinicId, user.id, 'TREATMENT_UPDATED', id, {
        before: { totalCost: t.totalCost, plannedSessions: t.plannedSessions },
        after: { ...(dto.totalCost !== undefined ? { totalCost: dto.totalCost } : {}), ...(dto.plannedSessions !== undefined ? { plannedSessions: dto.plannedSessions } : {}), fields: Object.keys(dto) },
      });
    });
    return this.get(user, id);
  }

  async completeSession(user: AuthUser, id: string, number: number, notes: string | undefined) {
    await this.assertCanAct(user, (await this.load(user, id)).doctorId);
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
      if (session.appointmentId) await this.completeAppointment(tx, clinicId, session.appointmentId); // the visit of this session happened
    });
    return this.get(user, id);
  }

  /** Books the appointment for one planned session. A cancelled appointment frees the session to be booked again. */
  async bookSession(user: AuthUser, id: string, number: number, dto: BookSessionDto) {
    const t = await this.load(user, id);
    await this.assertCanAct(user, t.doctorId);
    if (t.status !== 'OPEN') throw new ConflictException('العلاج مش مفتوح');
    const session = t.sessions.find((s) => s.number === number);
    if (!session) throw new NotFoundException('الجلسة غير موجودة');
    if (session.status !== 'PLANNED') throw new ConflictException('هذه الجلسة منتهية');
    if (session.appointment && session.appointment.status !== 'CANCELLED') throw new ConflictException('هذه الجلسة محجوزة من قبل');

    const apt = await this.appointments.create(user, { patientId: t.patientId, doctorId: dto.doctorId ?? t.doctorId, startsAt: dto.startsAt, durationMinutes: dto.durationMinutes, notes: dto.notes });
    const clinicId = user.clinicId!;
    const linked = await this.prisma.session.updateMany({
      where: { id: session.id, clinicId, status: 'PLANNED', OR: [{ appointmentId: null }, { appointment: { status: 'CANCELLED' } }] },
      data: { appointmentId: apt.id },
    });
    if (linked.count !== 1) {
      await this.appointments.cancel(user, apt.id, 'تعذر ربطه بالجلسة');
      throw new ConflictException('هذه الجلسة انحجزت للتو');
    }
    await this.prisma.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'SESSION_BOOKED', entityType: 'Treatment', entityId: id, after: { number, appointmentId: apt.id } } });
    return this.get(user, id);
  }

  /** Closing is a button, never automatic: allowed only when every session is done AND everything is paid. */
  async close(user: AuthUser, id: string) {
    await this.assertCanAct(user, (await this.load(user, id)).doctorId);
    const clinicId = user.clinicId!;
    await this.prisma.$transaction(async (tx) => {
      const t = await this.lock(tx, clinicId, id);
      if (t.status !== 'OPEN') throw new ConflictException('العلاج مش مفتوح');
      const done = t.sessions.filter((s) => s.status === 'COMPLETED');
      if (done.length === 0) throw new ConflictException('لازم تتم جلسة وحدة على الأقل');
      if (paidTotal(t.payments) < t.totalCost) throw new ConflictException('لسا في مبلغ متبقي ما انستلم');
      // The doctor may finish early: sessions that never happened are dropped, and their appointments are released.
      const dropped = t.sessions.filter((s) => s.status !== 'COMPLETED');
      if (dropped.length > 0) {
        const aptIds = dropped.map((s) => s.appointmentId).filter((x): x is string => !!x);
        if (aptIds.length > 0) await tx.appointment.updateMany({ where: { id: { in: aptIds }, clinicId, status: { in: ['PENDING', 'CONFIRMED'] } }, data: { status: 'CANCELLED' } });
        await tx.session.deleteMany({ where: { clinicId, treatmentId: id, status: 'PLANNED' } });
      }
      await tx.treatment.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), plannedSessions: done.length } });
      await this.audit(tx, clinicId, user.id, 'TREATMENT_CLOSED', id, dropped.length > 0 ? { before: { plannedSessions: t.plannedSessions }, after: { plannedSessions: done.length, droppedSessions: dropped.map((s) => s.number) } } : {});
    });
    return this.get(user, id);
  }

  async cancel(user: AuthUser, id: string, reason: string | undefined) {
    await this.assertCanAct(user, (await this.load(user, id)).doctorId);
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
    await this.assertCanAct(user, row.doctorId);
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
  /** Who still owes the clinic: per patient, what the (non-cancelled) treatments cost minus what was actually paid. Same maths as patientFinance. */
  async patientBalances(user: AuthUser) {
    const scope = await this.scopeFor(user);
    const rows = await this.tenant.db.treatment.findMany({
      where: { status: { not: 'CANCELLED' }, ...scope },
      select: { patientId: true, totalCost: true, status: true, patient: { select: { fullName: true, phone: true } }, payments: { select: { amount: true, status: true, paidAt: true } } },
    });
    const byPatient = new Map<string, { patientId: string; fullName: string; phone: string; total: number; paid: number; openTreatments: number; lastPaidAt: Date | null }>();
    for (const r of rows) {
      const e = byPatient.get(r.patientId) ?? { patientId: r.patientId, fullName: r.patient.fullName, phone: r.patient.phone, total: 0, paid: 0, openTreatments: 0, lastPaidAt: null };
      e.total += r.totalCost;
      e.paid += paidTotal(r.payments);
      if (r.status === 'OPEN') e.openTreatments += 1;
      for (const p of r.payments) if (p.status === 'ACTIVE' && (!e.lastPaidAt || p.paidAt > e.lastPaidAt)) e.lastPaidAt = p.paidAt;
      byPatient.set(r.patientId, e);
    }
    const items = [...byPatient.values()]
      .map((e) => ({ ...e, remaining: Math.max(0, e.total - e.paid) }))
      .filter((e) => e.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining || a.fullName.localeCompare(b.fullName, 'ar'));
    return { items, totalRemaining: items.reduce((t, e) => t + e.remaining, 0) };
  }
}
