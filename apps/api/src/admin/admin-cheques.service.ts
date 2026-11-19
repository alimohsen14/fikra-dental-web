import { ConflictException, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { z } from 'zod';
import { detectImage } from '../clinic/logo.js';
import { ChequeStorage } from '../cheques/cheques.storage.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { addDaysTo, instantAt, localDate } from '../scheduling/clinic-time.js';
import type { cashQuerySchema, listSubscriptionChequesSchema, returnSubscriptionChequeSchema, updateSubscriptionChequeSchema } from './admin.dto.js';

/** The platform works on Palestine time. */
const TZ = 'Asia/Hebron';

const SELECT = {
  id: true,
  clinicId: true,
  paymentId: true,
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
  cashedAt: true,
  returnedAt: true,
  returnReason: true,
  createdAt: true,
  clinic: { select: { id: true, name: true } },
} satisfies Prisma.SubscriptionChequeSelect;

type Row = Prisma.SubscriptionChequeGetPayload<{ select: typeof SELECT }>;

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Cheques clinics paid their subscription with. They are incoming only. The payment behind a cheque lowers what the clinic owes at once;
 * it is the platform's cash only from the day the cheque is cashed. A returned cheque voids that payment (the clinic owes it again).
 */
@Injectable()
export class AdminChequesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ChequeStorage,
  ) {}

  private present(c: Row, today: string) {
    const due = day(c.dueDate);
    return {
      id: c.id,
      clinic: c.clinic,
      status: c.status,
      amount: c.amount,
      dueDate: due,
      due: c.status !== 'PENDING' ? 'done' : due < today ? 'overdue' : due === today ? 'today' : 'later',
      chequeNumber: c.chequeNumber,
      bankName: c.bankName,
      accountNumber: c.accountNumber,
      drawerName: c.drawerName,
      drawerPhone: c.drawerPhone,
      notes: c.notes,
      hasImage: c.image !== null,
      cashedAt: c.cashedAt,
      returnedAt: c.returnedAt,
      returnReason: c.returnReason,
      createdAt: c.createdAt,
    };
  }

  private async load(id: string) {
    const c = await this.prisma.subscriptionCheque.findUnique({ where: { id }, select: SELECT });
    if (!c) throw new NotFoundException('الشك غير موجود');
    return c;
  }

  async get(id: string) {
    return this.present(await this.load(id), localDate(new Date(), TZ));
  }

  async list(q: z.infer<typeof listSubscriptionChequesSchema>) {
    const today = localDate(new Date(), TZ);
    const todayDate = new Date(`${today}T00:00:00Z`);
    const text = q.q?.trim();
    const where: Prisma.SubscriptionChequeWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.clinicId ? { clinicId: q.clinicId } : {}),
      ...(text
        ? {
            OR: [
              { drawerName: { contains: text, mode: 'insensitive' } },
              { chequeNumber: { contains: text } },
              { bankName: { contains: text, mode: 'insensitive' } },
              { clinic: { is: { name: { contains: text, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const finished = q.status === 'CASHED' || q.status === 'RETURNED' || q.status === 'CANCELLED';
    const items = await this.prisma.subscriptionCheque.findMany({
      where,
      select: SELECT,
      orderBy: [{ dueDate: finished ? 'desc' : 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: 300,
    });
    const sum = async (w: Prisma.SubscriptionChequeWhereInput) => {
      const a = await this.prisma.subscriptionCheque.aggregate({ where: w, _sum: { amount: true }, _count: true });
      return { amount: a._sum.amount ?? 0, count: a._count };
    };
    return {
      items: items.map((c) => this.present(c, today)),
      totals: {
        pending: await sum({ status: 'PENDING' }),
        dueToday: await sum({ status: 'PENDING', dueDate: todayDate }),
        overdue: await sum({ status: 'PENDING', dueDate: { lt: todayDate } }),
        cashed: await sum({ status: 'CASHED' }),
        returned: await sum({ status: 'RETURNED' }),
      },
    };
  }

  async update(actorId: string, id: string, dto: z.infer<typeof updateSubscriptionChequeSchema>) {
    const before = await this.load(id);
    if (before.status !== 'PENDING') throw new ConflictException('لا يمكن تعديل الشك بعد صرفه أو ارتجاعه');
    const { dueDate, ...rest } = dto;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscriptionCheque.updateMany({
        where: { id, status: 'PENDING' },
        data: { ...rest, ...(dueDate ? { dueDate: new Date(`${dueDate}T00:00:00Z`) } : {}) },
      });
      if (claimed.count === 0) throw new ConflictException('تغيّرت حالة الشك، أعد تحميل الصفحة');
      await tx.auditLog.create({ data: { clinicId: before.clinicId, actorUserId: actorId, action: 'SUBSCRIPTION_CHEQUE_UPDATED', entityType: 'SubscriptionCheque', entityId: id, after: { ...dto } } });
    });
    return this.get(id);
  }

  /** The cheque was cashed: from this moment the money is the platform's cash. */
  async cash(actorId: string, id: string) {
    const c = await this.load(id);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscriptionCheque.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CASHED', cashedAt: new Date() } });
      if (claimed.count === 0) throw new ConflictException('الشك ليس بانتظار الصرف');
      await tx.auditLog.create({ data: { clinicId: c.clinicId, actorUserId: actorId, action: 'SUBSCRIPTION_CHEQUE_CASHED', entityType: 'SubscriptionCheque', entityId: id, after: { amount: c.amount } } });
    });
    return this.get(id);
  }

  /** Bounced: the payment is voided, so the clinic owes the money again. */
  async giveBack(actorId: string, id: string, dto: z.infer<typeof returnSubscriptionChequeSchema>) {
    const c = await this.load(id);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscriptionCheque.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'RETURNED', returnedAt: new Date(), returnReason: dto.reason } });
      if (claimed.count === 0) throw new ConflictException('لا يمكن إرجاع هذا الشك (ليس بانتظار الصرف)');
      await tx.subscriptionPayment.updateMany({
        where: { id: c.paymentId, voidedAt: null },
        data: { voidedAt: new Date(), voidReason: `شك مرتجع: ${dto.reason}`, voidedByUserId: actorId },
      });
      await tx.auditLog.create({ data: { clinicId: c.clinicId, actorUserId: actorId, action: 'SUBSCRIPTION_CHEQUE_RETURNED', entityType: 'SubscriptionCheque', entityId: id, after: { reason: dto.reason, amount: c.amount } } });
    });
    return this.get(id);
  }

  async setImage(actorId: string, id: string, data: Buffer) {
    const c = await this.load(id);
    if (c.status !== 'PENDING') throw new ConflictException('لا يمكن تغيير صورة الشك بعد صرفه أو ارتجاعه');
    const kind = detectImage(data);
    if (!kind) throw new UnsupportedMediaTypeException('يجب أن يكون الملف صورة (JPG أو PNG أو WEBP)');
    const file = await this.storage.save(c.clinicId, data, kind);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.subscriptionCheque.update({ where: { id }, data: { image: file, imageMime: kind.mime, imageSize: data.length } });
        await tx.auditLog.create({ data: { clinicId: c.clinicId, actorUserId: actorId, action: 'SUBSCRIPTION_CHEQUE_IMAGE_SET', entityType: 'SubscriptionCheque', entityId: id, after: { size: data.length } } });
      });
    } catch (e) {
      await this.storage.remove(file);
      throw e;
    }
    if (c.image) await this.storage.remove(c.image);
    return this.get(id);
  }

  async imageOf(id: string) {
    const c = await this.prisma.subscriptionCheque.findUnique({ where: { id }, select: { image: true, imageMime: true } });
    const path = c?.image ? this.storage.pathOf(c.image) : null;
    if (!c || !path || !c.imageMime) throw new NotFoundException('لا توجد صورة لهذا الشك');
    return { path, mime: c.imageMime };
  }

  /**
   * The platform's cash page: what was really received. Cash/transfer/card payments count on the day they were paid; a cheque payment counts
   * from the day its cheque was cashed. Pending and returned cheques are not here (see the cheques page).
   */
  async cashPage(q: z.infer<typeof cashQuerySchema>) {
    const today = localDate(new Date(), TZ);
    const from = q.from ?? `${today.slice(0, 8)}01`;
    const to = q.to ?? today;
    const range = { gte: instantAt(from, 0, TZ), lt: instantAt(addDaysTo(to, 1), 0, TZ) };
    const rows = await this.prisma.subscriptionPayment.findMany({
      where: {
        voidedAt: null,
        ...(q.clinicId ? { clinicId: q.clinicId } : {}),
        OR: [
          { method: { not: 'CHEQUE' }, paidAt: range },
          { method: 'CHEQUE', cheque: { is: { status: 'CASHED', cashedAt: range } } },
        ],
      },
      select: { id: true, amount: true, method: true, paidAt: true, note: true, clinic: { select: { id: true, name: true } }, cheque: { select: { id: true, cashedAt: true, chequeNumber: true } } },
    });
    const items = rows
      .map((p) => ({
        id: p.id,
        clinic: p.clinic,
        amount: p.amount,
        method: p.method,
        at: p.method === 'CHEQUE' ? p.cheque!.cashedAt! : p.paidAt,
        note: p.note,
        fromCheque: p.method === 'CHEQUE',
        chequeNumber: p.cheque?.chequeNumber ?? null,
      }))
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    return {
      from,
      to,
      total: items.reduce((t, x) => t + x.amount, 0),
      fromCheques: items.filter((x) => x.fromCheque).reduce((t, x) => t + x.amount, 0),
      items,
    };
  }
}
