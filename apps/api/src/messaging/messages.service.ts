import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { getConfirmWindowHours } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import { confirmationText } from './message-text.js';
import { WHATSAPP_PROVIDER } from './whatsapp.provider.js';
import type { WhatsAppProvider } from './whatsapp.provider.js';

const HOUR = 3_600_000;
const BATCH = 200;
const CANCELLED_BY_PATIENT = 'ألغى المريض الموعد بالرد عبر واتساب';

interface DueAppointment {
  id: string;
  clinicId: string;
  startsAt: Date;
  patient: { fullName: string; phone: string };
  doctor: { fullName: string };
  clinic: { name: string; timezone: string };
}

@Injectable()
export class MessagesService {
  private readonly log = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantPrismaService,
    @Inject(WHATSAPP_PROVIDER) readonly provider: WhatsAppProvider,
  ) {}

  /** Sends the confirmation of every still-waiting appointment that has entered the window. Safe to run any number of times. */
  async dispatchDue(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
    const hours = getConfirmWindowHours();
    if (hours <= 0) return { sent: 0, failed: 0 };
    const due = await this.prisma.appointment.findMany({
      where: {
        status: 'PENDING',
        startsAt: { gt: now, lte: new Date(now.getTime() + hours * HOUR) },
        OR: [{ messages: { none: { kind: 'CONFIRMATION' } } }, { messages: { some: { kind: 'CONFIRMATION', status: 'CANCELLED' } } }],
      },
      orderBy: { startsAt: 'asc' },
      take: BATCH,
      select: {
        id: true,
        clinicId: true,
        startsAt: true,
        patient: { select: { fullName: true, phone: true } },
        doctor: { select: { fullName: true } },
        clinic: { select: { name: true, timezone: true } },
      },
    });
    let sent = 0;
    let failed = 0;
    for (const a of due) {
      try {
        (await this.send(a, now)) === 'SENT' ? sent++ : failed++;
      } catch (e) {
        this.log.error(`message for appointment ${a.id}: ${String(e)}`);
      }
    }
    return { sent, failed };
  }

  /** Claims the message row (the unique key makes sure two runs never send twice), then sends it. */
  private async send(a: DueAppointment, now: Date): Promise<'SENT' | 'FAILED' | 'SKIPPED'> {
    const body = confirmationText({ clinicName: a.clinic.name, patientName: a.patient.fullName, doctorName: a.doctor.fullName, startsAt: a.startsAt, timeZone: a.clinic.timezone });
    const scheduledFor = new Date(Math.max(now.getTime(), a.startsAt.getTime() - getConfirmWindowHours() * HOUR));
    let id: string;
    try {
      id = (await this.prisma.messageLog.create({ data: { clinicId: a.clinicId, appointmentId: a.id, kind: 'CONFIRMATION', status: 'SCHEDULED', toPhone: a.patient.phone, scheduledFor, body } })).id;
    } catch {
      // A row exists already: only a cancelled one (the appointment moved) may be used again.
      const row = await this.prisma.messageLog.findUnique({ where: { appointmentId_kind: { appointmentId: a.id, kind: 'CONFIRMATION' } }, select: { id: true } });
      if (!row) return 'SKIPPED';
      const claimed = await this.prisma.messageLog.updateMany({
        where: { id: row.id, status: 'CANCELLED' },
        data: { status: 'SCHEDULED', toPhone: a.patient.phone, scheduledFor, body, sentAt: null, waMessageId: null, errorMessage: null, response: null, respondedAt: null },
      });
      if (claimed.count !== 1) return 'SKIPPED';
      id = row.id;
    }
    return this.deliver(id, { clinicId: a.clinicId, to: a.patient.phone, body, appointmentId: a.id });
  }

  private async deliver(id: string, msg: { clinicId: string; to: string; body: string; appointmentId: string }): Promise<'SENT' | 'FAILED'> {
    try {
      const { messageId } = await this.provider.sendConfirmation(msg);
      await this.prisma.messageLog.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), waMessageId: messageId, errorMessage: null } });
      return 'SENT';
    } catch (e) {
      await this.prisma.messageLog.update({ where: { id }, data: { status: 'FAILED', errorMessage: e instanceof Error ? e.message.slice(0, 300) : 'فشل الإرسال' } });
      return 'FAILED';
    }
  }

  // ---------------------------------------------------------------- test-mode buttons (dummy provider only)
  private mustBeTestMode() {
    if (this.provider.name !== 'dummy') throw new BadRequestException('هذا الزر للتجربة فقط');
  }

  /** "Send it now": the test-mode shortcut for waiting until the window opens. Also retries a failed message. */
  async sendNow(user: AuthUser, appointmentId: string) {
    this.mustBeTestMode();
    const apt = await this.tenant.db.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, status: true } });
    if (!apt) throw new NotFoundException('الموعد غير موجود');
    if (apt.status !== 'PENDING') throw new ConflictException('الموعد ليس بانتظار التأكيد');
    const full = await this.prisma.appointment.findFirstOrThrow({
      where: { id: appointmentId, clinicId: user.clinicId! },
      select: { id: true, clinicId: true, startsAt: true, patient: { select: { fullName: true, phone: true } }, doctor: { select: { fullName: true } }, clinic: { select: { name: true, timezone: true } } },
    });
    const existing = await this.prisma.messageLog.findUnique({ where: { appointmentId_kind: { appointmentId, kind: 'CONFIRMATION' } }, select: { id: true, status: true } });
    if (existing && existing.status !== 'FAILED' && existing.status !== 'CANCELLED') throw new ConflictException('أُرسلت الرسالة من قبل');
    if (existing?.status === 'FAILED') await this.prisma.messageLog.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } }); // free it, then the normal path claims it again
    const result = await this.send(full, new Date());
    if (result === 'SKIPPED') throw new ConflictException('أُرسلت الرسالة من قبل');
    return { status: result };
  }

  /**
   * The patient's answer. The same method serves the test button now and the WhatsApp webhook later.
   * YES confirms a waiting appointment; NO cancels a waiting or confirmed one. An answer counts once.
   */
  async handleReply(clinicId: string, appointmentId: string, answer: 'YES' | 'NO'): Promise<{ applied: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.messageLog.findUnique({ where: { appointmentId_kind: { appointmentId, kind: 'CONFIRMATION' } } });
      if (!row || row.clinicId !== clinicId) throw new NotFoundException('لا توجد رسالة تأكيد لهذا الموعد');
      if (row.status !== 'SENT' && row.status !== 'DELIVERED') throw new ConflictException('لم تُرسل الرسالة بعد');
      const claimed = await tx.messageLog.updateMany({ where: { id: row.id, response: null }, data: { response: answer, respondedAt: new Date() } });
      if (claimed.count !== 1) return { applied: false };
      if (answer === 'YES') {
        await tx.appointment.updateMany({ where: { id: appointmentId, clinicId, status: 'PENDING' }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
      } else {
        await tx.appointment.updateMany({ where: { id: appointmentId, clinicId, status: { in: ['PENDING', 'CONFIRMED'] } }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: CANCELLED_BY_PATIENT } });
      }
      await tx.auditLog.create({ data: { clinicId, action: 'PATIENT_REPLIED', entityType: 'Appointment', entityId: appointmentId, after: { answer } } });
      return { applied: true };
    });
  }

  async testReply(user: AuthUser, appointmentId: string, answer: 'YES' | 'NO') {
    this.mustBeTestMode();
    const apt = await this.tenant.db.appointment.findUnique({ where: { id: appointmentId }, select: { id: true } });
    if (!apt) throw new NotFoundException('الموعد غير موجود');
    const r = await this.handleReply(user.clinicId!, appointmentId, answer);
    if (!r.applied) throw new ConflictException('ردّ المريض من قبل');
    return { ok: true };
  }
}
