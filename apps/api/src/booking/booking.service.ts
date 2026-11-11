import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { checkClinicAccess } from '../auth/clinic-access.js';
import { normalizePhone } from '../common/phone.js';
import { getPublicWebUrl } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { WHATSAPP_PROVIDER } from '../messaging/whatsapp.provider.js';
import type { WhatsAppProvider } from '../messaging/whatsapp.provider.js';
import { welcomeText } from '../messaging/message-text.js';
import { PatientsService } from '../patients/patients.service.js';
import { AppointmentsService } from '../scheduling/appointments.service.js';
import { localDate } from '../scheduling/clinic-time.js';
import { tenantStorage } from '../tenant/tenant-context.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import type { bookSchema, registerSchema, rescheduleSchema } from './booking.dto.js';
import { daysWithFreeTime, freeSlots } from './free-slots.js';

export const LINK_VALID_HOURS = 2;
export const LINKS_PER_HOUR = 5; // per phone number
export const HORIZON_DAYS = 60; // how far ahead a patient may book
export const MAX_SELF_REGISTERED_PER_PHONE = 5;
const HOUR = 3_600_000;
const LIVE = ['PENDING', 'CONFIRMED'] as const;
const INVALID_LINK = 'الرابط غير صالح أو انتهت صلاحيته. أرسل رسالة جديدة إلى العيادة عبر واتساب ليصلك رابط جديد.';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface Ctx {
  clinicId: string;
  phone: string;
  timeZone: string;
  user: AuthUser;
}

/** Who the booking page acts as inside the existing services: a secretary-level user without payment rights. */
function bookerUser(clinicId: string): AuthUser {
  return { id: '00000000-0000-0000-0000-000000000000', role: 'SECRETARY', clinicId, fullName: 'حجز ذاتي', canManagePayments: false, mustChangePassword: false, clinic: null, subscriptionWarning: null };
}

@Injectable()
export class BookingService {
  private readonly log = new Logger(BookingService.name);
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantPrismaService,
    private readonly patients: PatientsService,
    private readonly appointments: AppointmentsService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  // ---------------------------------------------------------------- a patient writes to the clinic's number
  /**
   * `fromPhone` is the number WhatsApp itself reports as the sender (cannot be faked), so everything on the
   * booking page is tied to it. The same method serves the test button now and the real webhook later.
   */
  async handleIncoming(clinicId: string, fromPhone: string, now = new Date()): Promise<{ sent: boolean; url?: string }> {
    const phone = normalizePhone(fromPhone);
    if (!phone) return { sent: false };
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true, name: true, status: true, subscriptionEndsAt: true } });
    if (!clinic || !checkClinicAccess(clinic, now).allowed) return { sent: false };

    const recent = await this.prisma.bookingLink.count({ where: { clinicId, phone, createdAt: { gt: new Date(now.getTime() - HOUR) } } });
    if (recent >= LINKS_PER_HOUR) return { sent: false }; // somebody is spamming: stay silent

    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.bookingLink.deleteMany({ where: { clinicId, phone, expiresAt: { lt: now } } }), // tidy up old ones
      this.prisma.bookingLink.create({ data: { clinicId, phone, tokenHash: sha(token), expiresAt: new Date(now.getTime() + LINK_VALID_HOURS * HOUR) } }),
    ]);
    const url = `${getPublicWebUrl()}/book/${token}`;
    try {
      await this.provider.sendText({ clinicId, to: phone, body: welcomeText(clinic.name, url, LINK_VALID_HOURS) });
    } catch (e) {
      this.log.error(`welcome message failed: ${String(e)}`);
      return { sent: false };
    }
    return { sent: true, url };
  }

  /** Test mode only (the real number never goes through here). */
  async simulateIncoming(clinicId: string, phone: string) {
    if (this.provider.name !== 'dummy') throw new BadRequestException('هذا الزر للتجربة فقط');
    const r = await this.handleIncoming(clinicId, phone);
    if (!r.sent) throw new BadRequestException('الرقم غير صالح، أو أن الطلبات كثيرة في وقت قصير');
    return { url: r.url };
  }

  // ---------------------------------------------------------------- the booking page
  private async resolve(token: string): Promise<{ clinicId: string; phone: string; clinic: { name: string; themeColor: string | null; logoUrl: string | null; timezone: string } }> {
    const link = await this.prisma.bookingLink.findUnique({ where: { tokenHash: sha(token) } });
    if (!link || link.expiresAt.getTime() <= Date.now()) throw new NotFoundException(INVALID_LINK);
    const clinic = await this.prisma.clinic.findUnique({ where: { id: link.clinicId }, select: { name: true, themeColor: true, logoUrl: true, timezone: true, status: true, subscriptionEndsAt: true } });
    if (!clinic) throw new NotFoundException(INVALID_LINK);
    if (!checkClinicAccess(clinic).allowed) throw new ForbiddenException('الحجز الإلكتروني غير متاح حالياً، تواصل مع العيادة');
    return { clinicId: link.clinicId, phone: link.phone, clinic };
  }

  /** Runs `fn` as that clinic (the same isolation every logged-in request gets). */
  private async scoped<T>(token: string, fn: (c: Ctx, clinic: { name: string; themeColor: string | null; logoUrl: string | null }) => Promise<T>): Promise<T> {
    const r = await this.resolve(token);
    return tenantStorage.run({ clinicId: r.clinicId }, () => fn({ clinicId: r.clinicId, phone: r.phone, timeZone: r.clinic.timezone, user: bookerUser(r.clinicId) }, r.clinic));
  }

  /** One at a time per patient, so a double click cannot book two appointments. */
  private async exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.locks.set(key, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === run) this.locks.delete(key);
    }
  }

  private async upcoming(patientId: string) {
    return this.tenant.db.appointment.findFirst({
      where: { patientId, status: { in: [...LIVE] }, endsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, startsAt: true, endsAt: true, status: true, doctor: { select: { id: true, fullName: true } } },
    });
  }

  private async ownPatient(c: Ctx, patientId: string) {
    // The phone is part of the filter: another phone's record simply "does not exist" for this link.
    const p = await this.tenant.db.patient.findFirst({ where: { id: patientId, phone: c.phone, archivedAt: null }, select: { id: true, fullName: true } });
    if (!p) throw new NotFoundException('لم نعثر على هذا المريض');
    return p;
  }

  private async ownAppointment(c: Ctx, id: string) {
    const a = await this.tenant.db.appointment.findFirst({ where: { id, patient: { phone: c.phone }, status: { in: [...LIVE] } }, select: { id: true, patientId: true, doctorId: true, startsAt: true } });
    if (!a) throw new NotFoundException('لم نعثر على هذا الموعد');
    return a;
  }

  private async audit(c: Ctx, action: string, entityId: string, after: Record<string, unknown>) {
    await this.tenant.db.auditLog.create({ data: { clinicId: c.clinicId, action, entityType: 'Appointment', entityId, after: { ...after, phone: c.phone, viaWhatsappLink: true } } as never });
  }

  /** First screen: the clinic, the records on this phone (with their upcoming appointment), and the doctors. */
  async overview(token: string) {
    return this.scoped(token, async (c, clinic) => {
      const patients = await this.tenant.db.patient.findMany({ where: { phone: c.phone, archivedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, fullName: true } });
      const withAppointment = await Promise.all(patients.map(async (p) => ({ ...p, appointment: await this.upcoming(p.id) })));
      const doctors = await this.tenant.db.doctor.findMany({
        where: { isActive: true, workingPeriods: { some: {} } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, fullName: true, specialty: true },
      });
      return { clinic: { name: clinic.name, themeColor: clinic.themeColor, logoUrl: clinic.logoUrl }, phoneEnding: c.phone.slice(-4), patients: withAppointment, doctors, horizonDays: HORIZON_DAYS };
    });
  }

  async register(token: string, dto: z.infer<typeof registerSchema>) {
    return this.scoped(token, async (c) => {
      const already = await this.tenant.db.patient.count({ where: { phone: c.phone, selfRegistered: true } });
      if (already >= MAX_SELF_REGISTERED_PER_PHONE) throw new BadRequestException('بلغت الحد الأقصى للتسجيل، تواصل مع العيادة');
      try {
        const { patient } = await this.patients.create({ ...dto, phone: c.phone }, { selfRegistered: true });
        return { id: patient.id, fullName: patient.fullName };
      } catch (e) {
        // Do not reveal that an ID number belongs to somebody else: anyone could probe IDs this way.
        if (e instanceof ConflictException) throw new BadRequestException('تعذّر تسجيلك، تواصل مع العيادة');
        throw e;
      }
    });
  }

  private async doctorFor(c: Ctx, doctorId: string) {
    const d = await this.tenant.db.doctor.findFirst({ where: { id: doctorId, isActive: true }, select: { id: true, appointmentMinutes: true, workingPeriods: { select: { weekday: true, startMinute: true, endMinute: true } } } });
    if (!d || d.workingPeriods.length === 0) throw new NotFoundException('الدكتور غير موجود');
    return { ...d, duration: (d.appointmentMinutes === 60 ? 60 : 30) as 30 | 60 };
  }

  private async busyBetween(doctorId: string, from: Date, to: Date, ignoreId?: string) {
    return this.tenant.db.appointment.findMany({
      where: { doctorId, status: { in: [...LIVE] }, startsAt: { lt: to }, endsAt: { gt: from }, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
      select: { startsAt: true, endsAt: true }, // only times: never who the patient is
    });
  }

  async days(token: string, doctorId: string, ignoreId?: string) {
    return this.scoped(token, async (c) => {
      const d = await this.doctorFor(c, doctorId);
      const now = new Date();
      const to = new Date(now.getTime() + (HORIZON_DAYS + 1) * 24 * HOUR);
      const busy = await this.busyBetween(doctorId, now, to, ignoreId);
      return { days: daysWithFreeTime({ timeZone: c.timeZone, periods: d.workingPeriods, busy, duration: d.duration, now, days: HORIZON_DAYS }) };
    });
  }

  async slots(token: string, doctorId: string, date: string, ignoreId?: string) {
    return this.scoped(token, async (c) => {
      const d = await this.doctorFor(c, doctorId);
      const now = new Date();
      const today = localDate(now, c.timeZone);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new BadRequestException('تاريخ غير صالح');
      if (date < today || Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) > HORIZON_DAYS * 24 * HOUR) return { slots: [] };
      const busy = await this.busyBetween(doctorId, new Date(Date.parse(`${date}T00:00:00Z`) - 2 * 24 * HOUR), new Date(Date.parse(`${date}T00:00:00Z`) + 3 * 24 * HOUR), ignoreId);
      return { slots: freeSlots({ date, timeZone: c.timeZone, periods: d.workingPeriods, busy, duration: d.duration, now }).map((s) => s.toISOString()) };
    });
  }

  private checkHorizon(startsAt: Date) {
    const now = Date.now();
    if (startsAt.getTime() <= now) throw new BadRequestException('انتهى هذا الوقت');
    if (startsAt.getTime() > now + HORIZON_DAYS * 24 * HOUR) throw new BadRequestException('لا يمكن الحجز لموعد بعيد إلى هذا الحد');
  }

  /** One upcoming appointment per patient. */
  async book(token: string, dto: z.infer<typeof bookSchema>) {
    return this.scoped(token, async (c) => {
      await this.ownPatient(c, dto.patientId);
      this.checkHorizon(dto.startsAt);
      return this.exclusive(dto.patientId, async () => {
        if (await this.upcoming(dto.patientId)) throw new ConflictException('لديك موعد قادم. عدّله أو ألغِه أولاً، ثم يمكنك حجز موعد جديد.');
        const d = await this.doctorFor(c, dto.doctorId);
        const a = await this.appointments.create(c.user, { patientId: dto.patientId, doctorId: dto.doctorId, startsAt: dto.startsAt, durationMinutes: d.duration }, { bookedByPatient: true });
        await this.audit(c, 'PATIENT_SELF_BOOKED', a.id, { startsAt: dto.startsAt.toISOString(), doctorId: dto.doctorId });
        return { id: a.id, startsAt: a.startsAt, endsAt: a.endsAt, status: a.status };
      });
    });
  }

  async reschedule(token: string, id: string, dto: z.infer<typeof rescheduleSchema>) {
    return this.scoped(token, async (c) => {
      const cur = await this.ownAppointment(c, id);
      this.checkHorizon(dto.startsAt);
      if (dto.doctorId) await this.doctorFor(c, dto.doctorId);
      return this.exclusive(cur.patientId, async () => {
        const a = await this.appointments.update(c.user, id, { startsAt: dto.startsAt, ...(dto.doctorId ? { doctorId: dto.doctorId } : {}) });
        await this.audit(c, 'PATIENT_SELF_RESCHEDULED', id, { from: cur.startsAt.toISOString(), to: dto.startsAt.toISOString() });
        return { id: a.id, startsAt: a.startsAt, endsAt: a.endsAt, status: a.status };
      });
    });
  }

  async cancel(token: string, id: string) {
    return this.scoped(token, async (c) => {
      await this.ownAppointment(c, id);
      await this.appointments.cancel(c.user, id, 'ألغاه المريض من صفحة الحجز');
      await this.audit(c, 'PATIENT_SELF_CANCELLED', id, {});
      return { ok: true };
    });
  }
}
