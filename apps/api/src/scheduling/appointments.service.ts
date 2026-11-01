import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import { localTime } from './clinic-time.js';
import { SLOT_MINUTES } from './scheduling.dto.js';
import type { CreateAppointmentDto, ListAppointmentsQuery, UpdateAppointmentDto } from './scheduling.dto.js';

const MINUTE = 60_000;
const PAST_GRACE_MINUTES = 30; // the slot that is running right now can still be booked (walk-ins)

const SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  notes: true,
  cancelReason: true,
  confirmedAt: true,
  completedAt: true,
  cancelledAt: true,
  patient: { select: { id: true, fullName: true, phone: true, medicalAlerts: true } },
  doctor: { select: { id: true, fullName: true } },
} as const;

interface Row {
  startsAt: Date;
  endsAt: Date;
  status: string;
}

/** What the API returns. `overdue` is derived (never stored): still unconfirmed or pending after its time passed. */
function present<T extends Row>(row: T) {
  return {
    ...row,
    durationMinutes: Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / MINUTE),
    overdue: (row.status === 'PENDING' || row.status === 'CONFIRMED') && row.endsAt.getTime() < Date.now(),
  };
}

// PostgreSQL refuses overlapping rows with its exclusion constraint (error 23P01). Prisma wraps that
// error, so we look for the constraint name too.
function isOverlapError(e: unknown): boolean {
  const text = JSON.stringify(e, Object.getOwnPropertyNames(e as object));
  return text.includes('appointment_no_overlap') || text.includes('23P01');
}

const BUSY = 'الدكتور عنده موعد بنفس الوقت';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly prisma: PrismaService,
  ) {}

  private async clinicTimeZone(clinicId: string): Promise<string> {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
    return clinic?.timezone ?? 'Asia/Hebron';
  }

  /** The doctor record of the logged-in doctor (null for owner / secretary). */
  private async ownDoctorId(user: AuthUser): Promise<string | null> {
    if (user.role !== 'DOCTOR') return null;
    const own = await this.tenant.db.doctor.findFirst({ where: { userId: user.id }, select: { id: true } });
    if (!own) throw new ForbiddenException();
    return own.id;
  }

  private async mustUseDoctor(user: AuthUser, doctorId: string) {
    const doctor = await this.tenant.db.doctor.findUnique({ where: { id: doctorId }, select: { id: true, userId: true, isActive: true } });
    if (!doctor) throw new NotFoundException('الدكتور غير موجود');
    // A doctor books only on their own schedule. Owner and secretary can book with any doctor.
    if (user.role === 'DOCTOR' && doctor.userId !== user.id) throw new ForbiddenException('بتقدر تحجز على وقتك أنت بس');
    if (!doctor.isActive) throw new BadRequestException('الدكتور غير فعّال');
    return doctor;
  }

  /** The time must be on the half-hour grid, in the future, inside the doctor's working hours and free. */
  private async checkSlot(clinicId: string, doctorId: string, startsAt: Date, durationMinutes: number, excludeId?: string) {
    const endsAt = new Date(startsAt.getTime() + durationMinutes * MINUTE);
    const tz = await this.clinicTimeZone(clinicId);
    const local = localTime(startsAt, tz);
    if (startsAt.getUTCSeconds() !== 0 || startsAt.getUTCMilliseconds() !== 0 || local.minute % SLOT_MINUTES !== 0) {
      throw new BadRequestException('الموعد لازم يبدأ على الساعة أو على نصها');
    }
    if (startsAt.getTime() < Date.now() - PAST_GRACE_MINUTES * MINUTE) throw new BadRequestException('ما بتقدر تحجز بوقت فات');

    const periods = await this.tenant.db.doctorWorkingPeriod.findMany({ where: { doctorId }, select: { weekday: true, startMinute: true, endMinute: true } });
    if (periods.length === 0) throw new BadRequestException('حدد أوقات دوام الدكتور أولاً');
    const fits = periods.some((p) => p.weekday === local.weekday && p.startMinute <= local.minute && local.minute + durationMinutes <= p.endMinute);
    if (!fits) throw new BadRequestException('الوقت خارج دوام الدكتور');

    const clash = await this.tenant.db.appointment.findFirst({
      where: { doctorId, status: { not: 'CANCELLED' }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException(BUSY);
    return endsAt;
  }

  async create(user: AuthUser, dto: CreateAppointmentDto) {
    await this.mustUseDoctor(user, dto.doctorId);
    const patient = await this.tenant.db.patient.findUnique({ where: { id: dto.patientId }, select: { id: true, archivedAt: true } });
    if (!patient) throw new NotFoundException('المريض غير موجود');
    if (patient.archivedAt) throw new BadRequestException('المريض بالأرشيف، أرجعه أولاً');

    const endsAt = await this.checkSlot(user.clinicId!, dto.doctorId, dto.startsAt, dto.durationMinutes);
    try {
      const row = await this.tenant.db.appointment.create({
        data: { patientId: dto.patientId, doctorId: dto.doctorId, startsAt: dto.startsAt, endsAt, notes: dto.notes ?? null } as never,
        select: SELECT,
      });
      return present(row);
    } catch (e) {
      // Two people booking the same slot at the same moment: the database lets only one through.
      if (isOverlapError(e)) throw new ConflictException(BUSY);
      throw e;
    }
  }

  async list(user: AuthUser, q: ListAppointmentsQuery) {
    const own = await this.ownDoctorId(user);
    if (own && q.doctorId && q.doctorId !== own) throw new ForbiddenException();
    const rows = await this.tenant.db.appointment.findMany({
      where: {
        startsAt: { gte: q.from, lt: q.to },
        ...(own ? { doctorId: own } : q.doctorId ? { doctorId: q.doctorId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: SELECT,
      take: 2000,
    });
    return rows.map(present);
  }

  /** Loads one appointment. A doctor asking for someone else's gets "not found". */
  private async mustFind(user: AuthUser, id: string) {
    const own = await this.ownDoctorId(user);
    const row = await this.tenant.db.appointment.findFirst({ where: { id, ...(own ? { doctorId: own } : {}) }, select: { ...SELECT, doctor: { select: { id: true, fullName: true } } } });
    if (!row) throw new NotFoundException('الموعد غير موجود');
    return row;
  }

  async get(user: AuthUser, id: string) {
    return present(await this.mustFind(user, id));
  }

  async update(user: AuthUser, id: string, dto: UpdateAppointmentDto) {
    const current = await this.mustFind(user, id);
    if (current.status !== 'PENDING' && current.status !== 'CONFIRMED') throw new ConflictException('ما بتقدر تعدّل موعد منتهي أو ملغى');

    const doctorId = dto.doctorId ?? current.doctor.id;
    if (dto.doctorId) await this.mustUseDoctor(user, dto.doctorId);
    const startsAt = dto.startsAt ?? current.startsAt;
    const duration = dto.durationMinutes ?? Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / MINUTE);

    const timeChanged = dto.doctorId !== undefined || dto.startsAt !== undefined || dto.durationMinutes !== undefined;
    let endsAt = current.endsAt;
    if (timeChanged) endsAt = await this.checkSlot(user.clinicId!, doctorId, startsAt, duration, id);

    try {
      const row = await this.tenant.db.appointment.update({
        where: { id },
        data: {
          ...(timeChanged ? { doctorId, startsAt, endsAt } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        } as never,
        select: SELECT,
      });
      return present(row);
    } catch (e) {
      if (isOverlapError(e)) throw new ConflictException(BUSY);
      throw e;
    }
  }

  /** Moves an appointment to a new status only from the allowed old statuses (one atomic UPDATE: no double clicks, no races). */
  private async transition(user: AuthUser, id: string, from: ('PENDING' | 'CONFIRMED')[], data: Record<string, unknown>, refusal: string, extraWhere: Record<string, unknown> = {}) {
    await this.mustFind(user, id); // 404 for foreign / missing ids first
    const res = await this.tenant.db.appointment.updateMany({ where: { id, status: { in: from }, ...extraWhere }, data: data as never });
    if (res.count === 0) throw new ConflictException(refusal);
    return this.get(user, id);
  }

  confirm(user: AuthUser, id: string) {
    return this.transition(user, id, ['PENDING'], { status: 'CONFIRMED', confirmedAt: new Date() }, 'الموعد مؤكد من قبل، أو منتهي أو ملغى');
  }

  complete(user: AuthUser, id: string) {
    return this.transition(user, id, ['PENDING', 'CONFIRMED'], { status: 'COMPLETED', completedAt: new Date() }, 'ما بتقدر تنهي هالموعد (لسا ما بلّش، أو منتهي أو ملغى)', { startsAt: { lte: new Date() } });
  }

  cancel(user: AuthUser, id: string, reason?: string) {
    return this.transition(user, id, ['PENDING', 'CONFIRMED'], { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null }, 'الموعد منتهي أو ملغى من قبل');
  }
}
