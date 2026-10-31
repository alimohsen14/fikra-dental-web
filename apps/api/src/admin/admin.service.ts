import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TEMP_PASSWORD_TTL_DAYS } from '../auth/auth.constants.js';
import { checkClinicAccess } from '../auth/clinic-access.js';
import { PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Clinic } from '../generated/prisma/client.js';
import type {
  addPaymentSchema,
  auditQuerySchema,
  createClinicSchema,
  listClinicsSchema,
  renewSchema,
  statusChangeSchema,
  voidPaymentSchema,
} from './admin.dto.js';
import type { z } from 'zod';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ClinicState = 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'SUSPENDED';

/** What the admin sees for a clinic right now. Calculated, never stored. */
export function clinicState(c: Pick<Clinic, 'status' | 'subscriptionEndsAt'>, now = new Date()) {
  const access = checkClinicAccess(c, now);
  let state: ClinicState = 'ACTIVE';
  if (!access.allowed) state = access.reason === 'CLINIC_SUSPENDED' ? 'SUSPENDED' : 'EXPIRED';
  else if (access.warning) state = 'GRACE';
  return {
    state,
    graceDaysLeft: access.allowed && access.warning ? access.warning.graceDaysLeft : null,
    daysSinceEnd:
      c.subscriptionEndsAt && now > c.subscriptionEndsAt
        ? Math.floor((now.getTime() - c.subscriptionEndsAt.getTime()) / DAY_MS)
        : null,
  };
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export type BillingStatus = 'NONE' | 'UNPAID' | 'PARTIAL' | 'PAID';

interface PaymentLike {
  amount: number;
  voidedAt: Date | null;
}

const sumActive = (payments: PaymentLike[]) => payments.reduce((t, p) => (p.voidedAt ? t : t + p.amount), 0);

function statusOf(price: number, paid: number): BillingStatus {
  if (paid >= price) return 'PAID';
  return paid > 0 ? 'PARTIAL' : 'UNPAID';
}

/** Money summary over all of a clinic's terms. Voided payments never count. */
export function billingSummary(periods: { price: number; payments: PaymentLike[] }[]) {
  if (periods.length === 0) return { status: 'NONE' as BillingStatus, totalPrice: 0, totalPaid: 0, totalRemaining: 0 };
  const totalPrice = periods.reduce((t, p) => t + p.price, 0);
  const totalPaid = periods.reduce((t, p) => t + Math.min(sumActive(p.payments), p.price), 0);
  return {
    status: statusOf(totalPrice, totalPaid),
    totalPrice,
    totalPaid,
    totalRemaining: totalPrice - totalPaid,
  };
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === 'P2002';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  private tempPasswordExpiry() {
    return new Date(Date.now() + TEMP_PASSWORD_TTL_DAYS * DAY_MS);
  }

  /** Creates the clinic, its owner login and the owner's doctor record. The password is shown ONCE. */
  async createClinic(actorId: string, dto: z.infer<typeof createClinicSchema>) {
    const taken = await this.prisma.user.findUnique({ where: { username: dto.owner.username } });
    if (taken) throw new ConflictException('اسم المستخدم مستخدم من قبل');

    const temporaryPassword = this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const startsAt = new Date();
    const endsAt = dto.subscription
      ? addMonths(startsAt, dto.subscription.months)
      : (dto.subscriptionEndsAt ?? null);

    try {
      const { clinic, owner } = await this.prisma.$transaction(async (tx) => {
        const clinic = await tx.clinic.create({
          data: {
            name: dto.name,
            themeColor: dto.themeColor ?? null,
            subscriptionEndsAt: endsAt,
          },
        });
        if (dto.subscription) {
          await tx.subscriptionPeriod.create({
            data: {
              clinicId: clinic.id,
              months: dto.subscription.months,
              startsAt,
              endsAt: endsAt!,
              price: dto.subscription.price,
              createdByUserId: actorId,
            },
          });
        }
        const owner = await tx.user.create({
          data: {
            clinicId: clinic.id,
            username: dto.owner.username,
            passwordHash,
            fullName: dto.owner.fullName,
            phone: dto.owner.phone ?? null,
            role: 'OWNER',
            canManagePayments: true,
            mustChangePassword: true,
            temporaryPasswordExpiresAt: this.tempPasswordExpiry(),
          },
        });
        // The owner is also a doctor.
        await tx.doctor.create({
          data: {
            clinicId: clinic.id,
            userId: owner.id,
            fullName: dto.owner.fullName,
            specialty: dto.owner.specialty ?? null,
            phone: dto.owner.phone ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            clinicId: clinic.id,
            actorUserId: actorId,
            action: 'CLINIC_CREATED',
            entityType: 'Clinic',
            entityId: clinic.id,
            after: {
              name: clinic.name,
              subscriptionEndsAt: clinic.subscriptionEndsAt?.toISOString() ?? null,
              subscriptionPrice: dto.subscription?.price ?? null,
              ownerUsername: owner.username,
            },
          },
        });
        return { clinic, owner };
      });

      return {
        clinic: { id: clinic.id, name: clinic.name, subscriptionEndsAt: clinic.subscriptionEndsAt },
        owner: { id: owner.id, username: owner.username, fullName: owner.fullName },
        temporaryPassword, // shown once, never stored in plain text
        temporaryPasswordExpiresAt: owner.temporaryPasswordExpiresAt,
      };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('اسم المستخدم مستخدم من قبل');
      throw e;
    }
  }

  async listClinics(q: z.infer<typeof listClinicsSchema>) {
    const clinics = await this.prisma.clinic.findMany({
      where: q.q ? { name: { contains: q.q, mode: 'insensitive' } } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        users: { where: { role: 'OWNER' }, select: { id: true, username: true, fullName: true }, take: 1 },
        _count: { select: { users: true, patients: true } },
        subscriptionPeriods: {
          select: { price: true, payments: { select: { amount: true, voidedAt: true } } },
        },
      },
    });

    const now = new Date();
    const rows = clinics.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      subscriptionEndsAt: c.subscriptionEndsAt,
      ...clinicState(c, now),
      createdAt: c.createdAt,
      owner: c.users[0] ?? null,
      billing: billingSummary(c.subscriptionPeriods),
      usersCount: c._count.users,
      patientsCount: c._count.patients,
    }));

    const summary = {
      total: rows.length,
      active: rows.filter((r) => r.state === 'ACTIVE').length,
      grace: rows.filter((r) => r.state === 'GRACE').length,
      expired: rows.filter((r) => r.state === 'EXPIRED').length,
      suspended: rows.filter((r) => r.state === 'SUSPENDED').length,
      unpaid: rows.filter((r) => r.billing.totalRemaining > 0).length,
    };

    // "expired" = subscription ended (still in the 3 grace days, or already blocked). Longest-expired first.
    let items = rows;
    if (q.filter === 'active') items = rows.filter((r) => r.state === 'ACTIVE');
    if (q.filter === 'suspended') items = rows.filter((r) => r.state === 'SUSPENDED');
    if (q.filter === 'unpaid') items = rows.filter((r) => r.billing.totalRemaining > 0);
    if (q.filter === 'expired') {
      items = rows
        .filter((r) => r.state === 'GRACE' || r.state === 'EXPIRED')
        .sort((a, b) => a.subscriptionEndsAt!.getTime() - b.subscriptionEndsAt!.getTime());
    }
    return { summary, items };
  }

  async getClinic(id: string) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id },
      include: {
        users: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            username: true,
            fullName: true,
            role: true,
            isActive: true,
            mustChangePassword: true,
            lockedUntil: true,
            createdAt: true,
          },
        },
        _count: { select: { patients: true } },
        subscriptionPeriods: {
          select: { price: true, payments: { select: { amount: true, voidedAt: true } } },
        },
      },
    });
    if (!clinic) throw new NotFoundException('العيادة غير موجودة');
    const { _count, subscriptionPeriods, ...rest } = clinic;
    return {
      ...rest,
      ...clinicState(clinic),
      patientsCount: _count.patients,
      billing: billingSummary(subscriptionPeriods),
    };
  }

  async setStatus(
    actorId: string,
    id: string,
    status: 'ACTIVE' | 'SUSPENDED',
    dto: z.infer<typeof statusChangeSchema>,
  ) {
    const clinic = await this.mustFind(id);
    if (clinic.status === status) return this.getClinic(id); // already in that state: nothing to do
    await this.prisma.$transaction(async (tx) => {
      await tx.clinic.update({ where: { id }, data: { status } });
      await tx.auditLog.create({
        data: {
          clinicId: id,
          actorUserId: actorId,
          action: status === 'SUSPENDED' ? 'CLINIC_SUSPENDED' : 'CLINIC_ACTIVATED',
          entityType: 'Clinic',
          entityId: id,
          before: { status: clinic.status },
          after: { status, reason: dto.reason ?? null },
        },
      });
    });
    return this.getClinic(id);
  }

  async renew(actorId: string, id: string, dto: z.infer<typeof renewSchema>) {
    const clinic = await this.mustFind(id);
    const now = new Date();
    let endsAt: Date;
    if (dto.endsAt) {
      endsAt = dto.endsAt;
    } else {
      // Extend from the current end date, or from today if the subscription already ended.
      const base = clinic.subscriptionEndsAt && clinic.subscriptionEndsAt > now ? clinic.subscriptionEndsAt : now;
      endsAt = addMonths(base, dto.months!);
    }
    if (endsAt <= now) throw new BadRequestException('تاريخ الانتهاء لازم يكون بالمستقبل');

    // The new term starts where the old one ends (or today, if it already ended).
    const startsAt = clinic.subscriptionEndsAt && clinic.subscriptionEndsAt > now ? clinic.subscriptionEndsAt : now;

    await this.prisma.$transaction(async (tx) => {
      await tx.clinic.update({ where: { id }, data: { subscriptionEndsAt: endsAt } });
      if (dto.price !== undefined) {
        await tx.subscriptionPeriod.create({
          data: {
            clinicId: id,
            months: dto.months ?? null,
            startsAt,
            endsAt,
            price: dto.price,
            createdByUserId: actorId,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          clinicId: id,
          actorUserId: actorId,
          action: 'SUBSCRIPTION_RENEWED',
          entityType: 'Clinic',
          entityId: id,
          before: { subscriptionEndsAt: clinic.subscriptionEndsAt?.toISOString() ?? null },
          after: { subscriptionEndsAt: endsAt.toISOString(), price: dto.price ?? null },
        },
      });
    });
    return this.getClinic(id);
  }

  /** New temporary password for the clinic owner (forgot password). Shown ONCE. */
  async resetOwnerPassword(actorId: string, id: string) {
    await this.mustFind(id);
    const owner = await this.prisma.user.findFirst({
      where: { clinicId: id, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) throw new NotFoundException('ما في مالك لهذه العيادة');

    const temporaryPassword = this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const expires = this.tempPasswordExpiry();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: owner.id },
        data: {
          passwordHash,
          mustChangePassword: true,
          temporaryPasswordExpiresAt: expires,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      // Old sessions end: whoever had the old password (or a stolen session) is logged out.
      await tx.refreshToken.updateMany({
        where: { userId: owner.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Never store passwords or hashes in the audit log.
      await tx.auditLog.create({
        data: {
          clinicId: id,
          actorUserId: actorId,
          action: 'OWNER_PASSWORD_RESET',
          entityType: 'User',
          entityId: owner.id,
        },
      });
    });

    return {
      owner: { id: owner.id, username: owner.username, fullName: owner.fullName },
      temporaryPassword,
      temporaryPasswordExpiresAt: expires,
    };
  }

  /** Every term of the clinic with its price, what was paid, what is left, and each payment. */
  async getBilling(id: string) {
    await this.mustFind(id);
    const periods = await this.prisma.subscriptionPeriod.findMany({
      where: { clinicId: id },
      orderBy: { startsAt: 'desc' },
      include: { payments: { orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] } },
    });
    return {
      ...billingSummary(periods),
      periods: periods.map((p) => {
        const paid = Math.min(sumActive(p.payments), p.price);
        return {
          id: p.id,
          months: p.months,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          price: p.price,
          paid,
          remaining: p.price - paid,
          status: statusOf(p.price, paid),
          payments: p.payments.map((x) => ({
            id: x.id,
            amount: x.amount,
            paidAt: x.paidAt,
            note: x.note,
            voided: x.voidedAt !== null,
            voidedAt: x.voidedAt,
            voidReason: x.voidReason,
            createdAt: x.createdAt,
          })),
        };
      }),
    };
  }

  /** Records money received from a clinic (cash, transfer...). Cannot exceed what is still owed. */
  async addPayment(actorId: string, id: string, dto: z.infer<typeof addPaymentSchema>) {
    await this.mustFind(id);
    await this.prisma.$transaction(async (tx) => {
      const period = dto.periodId
        ? await tx.subscriptionPeriod.findFirst({ where: { id: dto.periodId, clinicId: id } })
        : await tx.subscriptionPeriod.findFirst({ where: { clinicId: id }, orderBy: { startsAt: 'desc' } });
      if (!period) {
        if (dto.periodId) throw new NotFoundException('فترة الاشتراك غير موجودة');
        throw new BadRequestException('ما في فترة اشتراك لهذه العيادة، جدد الاشتراك مع تحديد السعر أولاً');
      }

      // Two payments at the same moment must not both fit into the same remaining amount.
      await tx.$queryRaw`SELECT id FROM "SubscriptionPeriod" WHERE id = ${period.id}::uuid FOR UPDATE`;
      const agg = await tx.subscriptionPayment.aggregate({
        where: { periodId: period.id, voidedAt: null },
        _sum: { amount: true },
      });
      const remaining = period.price - (agg._sum.amount ?? 0);
      if (dto.amount > remaining) {
        throw new BadRequestException(`المبلغ أكبر من المتبقي على هذه الفترة (${remaining})`);
      }

      const payment = await tx.subscriptionPayment.create({
        data: {
          periodId: period.id,
          clinicId: id,
          amount: dto.amount,
          paidAt: dto.paidAt ?? new Date(),
          note: dto.note ?? null,
          createdByUserId: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          clinicId: id,
          actorUserId: actorId,
          action: 'SUBSCRIPTION_PAYMENT_ADDED',
          entityType: 'SubscriptionPayment',
          entityId: payment.id,
          after: { periodId: period.id, amount: payment.amount, paidAt: payment.paidAt.toISOString() },
        },
      });
    });
    return this.getBilling(id);
  }

  /** A payment is never deleted. A wrong one is cancelled with a reason and stops counting. */
  async voidPayment(actorId: string, id: string, paymentId: string, dto: z.infer<typeof voidPaymentSchema>) {
    const payment = await this.prisma.subscriptionPayment.findFirst({ where: { id: paymentId, clinicId: id } });
    if (!payment) throw new NotFoundException('الدفعة غير موجودة');

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id: paymentId, voidedAt: null },
        data: { voidedAt: new Date(), voidReason: dto.reason, voidedByUserId: actorId },
      });
      if (claimed.count === 0) throw new ConflictException('هذه الدفعة ملغاة من قبل');
      await tx.auditLog.create({
        data: {
          clinicId: id,
          actorUserId: actorId,
          action: 'SUBSCRIPTION_PAYMENT_VOIDED',
          entityType: 'SubscriptionPayment',
          entityId: paymentId,
          before: { amount: payment.amount },
          after: { reason: dto.reason },
        },
      });
    });
    return this.getBilling(id);
  }

  async listAudit(q: z.infer<typeof auditQuerySchema>) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.clinicId ? { clinicId: q.clinicId } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, username: true, fullName: true },
    });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return {
      items: rows.map((r) => ({ ...r, actor: r.actorUserId ? (byId.get(r.actorUserId) ?? null) : null })),
      nextBefore: rows.length === q.limit ? rows[rows.length - 1]!.createdAt.toISOString() : null,
    };
  }

  private async mustFind(id: string) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id } });
    if (!clinic) throw new NotFoundException('العيادة غير موجودة');
    return clinic;
  }
}
