import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { TokenService } from '../src/auth/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { Role } from '../src/generated/prisma/client.js';
import { MessagesService } from '../src/messaging/messages.service.js';
import { DummyWhatsAppProvider } from '../src/messaging/whatsapp.provider.js';
import { localTime } from '../src/scheduling/clinic-time.js';

const TZ = 'Asia/Hebron';
const HOUR = 3_600_000;

function at(day: Date, minute: number): Date {
  const guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, minute);
  for (const hours of [2, 3]) {
    const candidate = new Date(guess - hours * HOUR);
    if (localTime(candidate, TZ).minute === minute % 1440) return candidate;
  }
  throw new Error('time zone helper failed');
}

/** 10:00 clinic time, `days` calendar days from now. */
function dayAt10(days: number): Date {
  const d = new Date(Date.now() + days * 24 * HOUR);
  d.setUTCHours(12, 0, 0, 0);
  return at(d, 600);
}

describe('WhatsApp confirmation (e2e, dummy provider)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let messages: MessagesService;
  let dummy: DummyWhatsAppProvider;
  const tag = randomUUID().slice(0, 8);
  const clinicIds: string[] = [];
  const oldWindow = process.env.AUTO_CONFIRM_WINDOW_HOURS;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Clinic {
    id: string;
    token: string;
    doctor: string;
    patient: string;
  }

  async function makeClinic(name: string): Promise<Clinic> {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}`, timezone: TZ } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash('Test-Pass-12345');
    const role: Role = 'OWNER';
    const u = await prisma.user.create({ data: { username: `${name}_${tag}`.toLowerCase(), passwordHash: hash, fullName: 'مالك', role, clinicId: clinic.id } });
    const doc = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: u.id, fullName: 'د. سامي' } });
    await prisma.doctorWorkingPeriod.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ clinicId: clinic.id, doctorId: doc.id, weekday, startMinute: 8 * 60, endMinute: 20 * 60 })) });
    const patient = await prisma.patient.create({ data: { clinicId: clinic.id, fullName: 'ليلى أحمد', phone: '+970599000222' } });
    return { id: clinic.id, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }), doctor: doc.id, patient: patient.id };
  }

  const book = (c: Clinic, startsAt: Date) =>
    http().post('/appointments').set(bearer(c.token)).send({ patientId: c.patient, doctorId: c.doctor, startsAt: startsAt.toISOString(), durationMinutes: 30 });
  const get = async (c: Clinic, id: string) => (await http().get(`/appointments/${id}`).set(bearer(c.token)).expect(200)).body;
  const sentFor = (id: string) => dummy.sent.filter((m) => m.appointmentId === id);

  beforeAll(async () => {
    process.env.AUTO_CONFIRM_WINDOW_HOURS = '48';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    messages = app.get(MessagesService);
    dummy = app.get(DummyWhatsAppProvider);
  }, 60_000);

  afterAll(async () => {
    if (oldWindow === undefined) delete process.env.AUTO_CONFIRM_WINDOW_HOURS;
    else process.env.AUTO_CONFIRM_WINDOW_HOURS = oldWindow;
    await prisma.messageLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.appointment.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.doctorWorkingPeriod.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.patient.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.doctor.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.user.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  it('status endpoint tells the screens it is test mode', async () => {
    const c = await makeClinic('st');
    const res = await http().get('/whatsapp/status').set(bearer(c.token)).expect(200);
    expect(res.body).toEqual({ provider: 'dummy', testMode: true, windowHours: 48 });
    await http().get('/whatsapp/status').expect(401);
  });

  it('less than 48h away: confirmed at once, no message is ever sent', async () => {
    const c = await makeClinic('near');
    const a = (await book(c, dayAt10(1)).expect(201)).body;
    expect(a).toMatchObject({ status: 'CONFIRMED', confirmationMessage: null, messageDueAt: null });
    expect(a.confirmedAt).toBeTruthy();
    await messages.dispatchDue(new Date(Date.now() + 40 * HOUR));
    expect(sentFor(a.id)).toHaveLength(0);
  });

  it('more than 48h away: stays waiting and says when the message will go out', async () => {
    const c = await makeClinic('far');
    const start = dayAt10(4);
    const a = (await book(c, start).expect(201)).body;
    expect(a).toMatchObject({ status: 'PENDING', confirmationMessage: null });
    expect(new Date(a.messageDueAt).getTime()).toBe(start.getTime() - 48 * HOUR);
  });

  it('the message goes out when 48h remain, exactly once, and the card shows it', async () => {
    const c = await makeClinic('send');
    const start = dayAt10(5);
    const a = (await book(c, start).expect(201)).body;

    await messages.dispatchDue(new Date(start.getTime() - 49 * HOUR)); // too early
    expect(sentFor(a.id)).toHaveLength(0);

    await messages.dispatchDue(new Date(start.getTime() - 47 * HOUR));
    await messages.dispatchDue(new Date(start.getTime() - 46 * HOUR)); // a second run must not send again
    expect(sentFor(a.id)).toHaveLength(1);
    expect(sentFor(a.id)[0]).toMatchObject({ clinicId: c.id, to: '+970599000222' });
    expect(sentFor(a.id)[0]!.body).toContain('ليلى أحمد');
    expect(sentFor(a.id)[0]!.body).toContain(`عيادة send-${tag}`);

    const after = await get(c, a.id);
    expect(after.status).toBe('PENDING'); // still waiting for the patient
    expect(after.messageDueAt).toBeNull();
    expect(after.confirmationMessage).toMatchObject({ status: 'SENT', response: null });
    expect(after.confirmationMessage.sentAt).toBeTruthy();
    expect(after.confirmationMessage.body).toContain('للتأكيد ردّ بكلمة: نعم');
  });

  it('two runs at the same moment still send one message', async () => {
    const c = await makeClinic('race');
    const start = dayAt10(6);
    const a = (await book(c, start).expect(201)).body;
    const now = new Date(start.getTime() - 40 * HOUR);
    await Promise.all([messages.dispatchDue(now), messages.dispatchDue(now), messages.dispatchDue(now)]);
    expect(sentFor(a.id)).toHaveLength(1);
    expect(await prisma.messageLog.count({ where: { appointmentId: a.id } })).toBe(1);
  });

  it('patient answers YES: confirmed; the answer counts once', async () => {
    const c = await makeClinic('yes');
    const start = dayAt10(5);
    const a = (await book(c, start).expect(201)).body;
    await http().post(`/appointments/${a.id}/message/reply`).set(bearer(c.token)).send({ answer: 'YES' }).expect(404); // nothing was sent yet
    await messages.dispatchDue(new Date(start.getTime() - 47 * HOUR));
    await http().post(`/appointments/${a.id}/message/reply`).set(bearer(c.token)).send({ answer: 'YES' }).expect(200);
    const after = await get(c, a.id);
    expect(after.status).toBe('CONFIRMED');
    expect(after.confirmationMessage).toMatchObject({ response: 'YES' });
    expect(after.confirmationMessage.respondedAt).toBeTruthy();
    await http().post(`/appointments/${a.id}/message/reply`).set(bearer(c.token)).send({ answer: 'NO' }).expect(409); // too late to change
    expect((await get(c, a.id)).status).toBe('CONFIRMED');
  });

  it('patient answers NO: the appointment is cancelled and the doctor time is free again', async () => {
    const c = await makeClinic('no');
    const start = dayAt10(5);
    const a = (await book(c, start).expect(201)).body;
    await messages.dispatchDue(new Date(start.getTime() - 47 * HOUR));
    await http().post(`/appointments/${a.id}/message/reply`).set(bearer(c.token)).send({ answer: 'NO' }).expect(200);
    const after = await get(c, a.id);
    expect(after).toMatchObject({ status: 'CANCELLED', cancelReason: 'ألغى المريض الموعد بالرد عبر واتساب' });
    expect(after.confirmationMessage).toMatchObject({ response: 'NO' });
    await book(c, start).expect(201); // the slot is free
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: 'PATIENT_REPLIED' } })).toBe(1);
  });

  it('moving the appointment cancels the old message; the next one carries the new time', async () => {
    const c = await makeClinic('move');
    const start = dayAt10(5);
    const a = (await book(c, start).expect(201)).body;
    await messages.dispatchDue(new Date(start.getTime() - 47 * HOUR));
    expect(sentFor(a.id)).toHaveLength(1);

    const newStart = dayAt10(7);
    await http().patch(`/appointments/${a.id}`).set(bearer(c.token)).send({ startsAt: newStart.toISOString() }).expect(200);
    const moved = await get(c, a.id);
    expect(moved.status).toBe('PENDING');
    expect(moved.confirmationMessage).toBeNull();
    expect(new Date(moved.messageDueAt).getTime()).toBe(newStart.getTime() - 48 * HOUR);

    await messages.dispatchDue(new Date(newStart.getTime() - 47 * HOUR));
    expect(sentFor(a.id)).toHaveLength(2);
    expect((await get(c, a.id)).confirmationMessage).toMatchObject({ status: 'SENT', response: null });
    expect(await prisma.messageLog.count({ where: { appointmentId: a.id } })).toBe(1);
  });

  it('moving a waiting appointment to less than 48h confirms it and sends nothing', async () => {
    const c = await makeClinic('closer');
    const a = (await book(c, dayAt10(6)).expect(201)).body;
    expect(a.status).toBe('PENDING');
    const moved = (await http().patch(`/appointments/${a.id}`).set(bearer(c.token)).send({ startsAt: dayAt10(1).toISOString() }).expect(200)).body;
    expect(moved.status).toBe('CONFIRMED');
  });

  it('a failed send is recorded, shows on the card, and can be retried', async () => {
    const c = await makeClinic('fail');
    const start = dayAt10(5);
    const a = (await book(c, start).expect(201)).body;
    dummy.failNext = true;
    await messages.dispatchDue(new Date(start.getTime() - 47 * HOUR));
    const failed = await get(c, a.id);
    expect(failed.status).toBe('PENDING');
    expect(failed.confirmationMessage).toMatchObject({ status: 'FAILED' });
    expect(failed.confirmationMessage.errorMessage).toBeTruthy();
    await http().post(`/appointments/${a.id}/message/send-now`).set(bearer(c.token)).expect(200);
    expect((await get(c, a.id)).confirmationMessage).toMatchObject({ status: 'SENT' });
    await http().post(`/appointments/${a.id}/message/send-now`).set(bearer(c.token)).expect(409); // already sent
  });

  it('"send now" works before the window opens; confirmed or finished appointments are refused', async () => {
    const c = await makeClinic('now');
    const a = (await book(c, dayAt10(6)).expect(201)).body;
    await http().post(`/appointments/${a.id}/message/send-now`).set(bearer(c.token)).expect(200);
    expect(sentFor(a.id)).toHaveLength(1);
    const near = (await book(c, dayAt10(1)).expect(201)).body; // confirmed already
    await http().post(`/appointments/${near.id}/message/send-now`).set(bearer(c.token)).expect(409);
  });

  it('with the window switched off (0) nothing is sent and everything stays waiting', async () => {
    process.env.AUTO_CONFIRM_WINDOW_HOURS = '0';
    try {
      const c = await makeClinic('off');
      const a = (await book(c, dayAt10(1)).expect(201)).body;
      expect(a.status).toBe('PENDING');
      expect(await messages.dispatchDue(new Date(Date.now() + 20 * HOUR))).toEqual({ sent: 0, failed: 0 });
      expect(sentFor(a.id)).toHaveLength(0);
    } finally {
      process.env.AUTO_CONFIRM_WINDOW_HOURS = '48';
    }
  });

  it("clinic B cannot message, answer for or even see clinic A's appointment", async () => {
    const a = await makeClinic('isoa');
    const b = await makeClinic('isob');
    const start = dayAt10(5);
    const apt = (await book(a, start).expect(201)).body;
    await messages.dispatchDue(new Date(start.getTime() - 47 * HOUR));
    await http().post(`/appointments/${apt.id}/message/send-now`).set(bearer(b.token)).expect(404);
    await http().post(`/appointments/${apt.id}/message/reply`).set(bearer(b.token)).send({ answer: 'NO' }).expect(404);
    expect((await get(a, apt.id)).status).toBe('PENDING');
  });

  it('bad input is refused', async () => {
    const c = await makeClinic('bad');
    await http().post('/appointments/not-a-uuid/message/reply').set(bearer(c.token)).send({ answer: 'YES' }).expect(400);
    await http().post(`/appointments/${randomUUID()}/message/reply`).set(bearer(c.token)).send({ answer: 'MAYBE' }).expect(400);
    await http().post(`/appointments/${randomUUID()}/message/reply`).set(bearer(c.token)).send({ answer: 'YES' }).expect(404);
    await http().post(`/appointments/${randomUUID()}/message/reply`).send({ answer: 'YES' }).expect(401);
  });
});
