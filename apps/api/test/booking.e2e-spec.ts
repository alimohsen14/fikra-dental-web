import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { TokenService } from '../src/auth/token.service.js';
import { BookingService } from '../src/booking/booking.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DummyWhatsAppProvider } from '../src/messaging/whatsapp.provider.js';
import { instantAt } from '../src/scheduling/clinic-time.js';

const TZ = 'Asia/Hebron';
const HOUR = 3_600_000;
const PHONE = '+970599000222';

/** Clinic-time `minute` on the calendar day `days` from now. */
function dayAt(days: number, minute: number): Date {
  const date = new Date(Date.now() + days * 24 * HOUR).toLocaleDateString('en-CA', { timeZone: TZ });
  return instantAt(date, minute, TZ);
}
const dateOf = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });

describe('Patient self-booking through the WhatsApp link (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let booking: BookingService;
  let dummy: DummyWhatsAppProvider;
  const tag = randomUUID().slice(0, 8);
  const clinicIds: string[] = [];
  const oldWindow = process.env.AUTO_CONFIRM_WINDOW_HOURS;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Clinic {
    id: string;
    staff: string; // a secretary token
    doctor: string;
    doctor2: string;
    patient: string; // registered on PHONE
  }

  async function makeClinic(name: string): Promise<Clinic> {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}`, timezone: TZ } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash('Test-Pass-12345');
    const u = await prisma.user.create({ data: { username: `${name}_${tag}`.toLowerCase(), passwordHash: hash, fullName: 'سكرتيرة', role: 'SECRETARY', clinicId: clinic.id } });
    const doctors = [];
    for (const n of ['د. سامي', 'د. رنا']) {
      const d = await prisma.doctor.create({ data: { clinicId: clinic.id, fullName: n } });
      await prisma.doctorWorkingPeriod.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ clinicId: clinic.id, doctorId: d.id, weekday, startMinute: 8 * 60, endMinute: 20 * 60 })) });
      doctors.push(d.id);
    }
    const patient = await prisma.patient.create({ data: { clinicId: clinic.id, fullName: 'ليلى أحمد', phone: PHONE } });
    return { id: clinic.id, staff: await app.get(TokenService).signAccess({ sub: u.id, role: 'SECRETARY', clinicId: clinic.id, mcp: false }), doctor: doctors[0]!, doctor2: doctors[1]!, patient: patient.id };
  }

  /** The patient writes to the clinic's number: returns the token from the link he receives. */
  async function link(c: Clinic, from = PHONE): Promise<string> {
    const res = await http().post('/whatsapp/simulate-incoming').set(bearer(c.staff)).send({ phone: from }).expect(200);
    return String(res.body.url).split('/book/')[1]!;
  }
  const page = (t: string, path = '') => http().get(`/public/book/${t}${path}`);

  beforeAll(async () => {
    process.env.AUTO_CONFIRM_WINDOW_HOURS = '48';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    booking = app.get(BookingService);
    dummy = app.get(DummyWhatsAppProvider);
  }, 60_000);

  afterAll(async () => {
    if (oldWindow === undefined) delete process.env.AUTO_CONFIRM_WINDOW_HOURS;
    else process.env.AUTO_CONFIRM_WINDOW_HOURS = oldWindow;
    const where = { clinicId: { in: clinicIds } };
    await prisma.bookingLink.deleteMany({ where });
    await prisma.messageLog.deleteMany({ where });
    await prisma.auditLog.deleteMany({ where });
    await prisma.session.deleteMany({ where });
    await prisma.treatmentTooth.deleteMany({ where });
    await prisma.treatment.deleteMany({ where });
    await prisma.treatmentType.deleteMany({ where });
    await prisma.appointment.deleteMany({ where });
    await prisma.doctorWorkingPeriod.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await prisma.doctor.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  // ---------------------------------------------------------------- the message and the link
  it('a patient writes to the number: he gets the welcome text with a private link; only a hash of the token is stored', async () => {
    const c = await makeClinic('welcome');
    const res = await http().post('/whatsapp/simulate-incoming').set(bearer(c.staff)).send({ phone: '0599000222' }).expect(200); // local format is normalised
    const sent = dummy.texts.filter((t) => t.clinicId === c.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: PHONE });
    expect(sent[0]!.body).toContain(`عيادة welcome-${tag}`);
    expect(sent[0]!.body).toContain(res.body.url);
    const token = String(res.body.url).split('/book/')[1]!;
    const rows = await prisma.bookingLink.findMany({ where: { clinicId: c.id } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.phone).toBe(PHONE);
    await http().post('/whatsapp/simulate-incoming').send({ phone: PHONE }).expect(401);
    await http().post('/whatsapp/simulate-incoming').set(bearer(c.staff)).send({ phone: 'abc' }).expect(400);
  });

  it('somebody who keeps writing gets at most 5 links an hour; then silence', async () => {
    const c = await makeClinic('spam');
    for (let i = 0; i < 5; i++) await link(c, '+970599000777');
    await http().post('/whatsapp/simulate-incoming').set(bearer(c.staff)).send({ phone: '+970599000777' }).expect(400);
    expect(dummy.texts.filter((t) => t.clinicId === c.id)).toHaveLength(5);
    await link(c, '+970599000778'); // another number is not affected
  });

  it('a suspended clinic does not answer', async () => {
    const c = await makeClinic('susp');
    await prisma.clinic.update({ where: { id: c.id }, data: { status: 'SUSPENDED' } });
    expect(await booking.handleIncoming(c.id, PHONE)).toEqual({ sent: false });
    expect(dummy.texts.filter((t) => t.clinicId === c.id)).toHaveLength(0);
  });

  it('wrong, malformed and expired links open nothing', async () => {
    const c = await makeClinic('badlink');
    await page('x'.repeat(43)).expect(404);
    await page('short').expect(400);
    const t = await link(c);
    await prisma.bookingLink.updateMany({ where: { clinicId: c.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await page(t).expect(404);
    await http().post(`/public/book/${t}/appointments`).send({ patientId: c.patient, doctorId: c.doctor, startsAt: dayAt(5, 600).toISOString() }).expect(404);
  });

  // ---------------------------------------------------------------- what the page shows
  it('shows only the records of the phone that wrote, never another phone, another clinic or an archived record', async () => {
    const a = await makeClinic('showa');
    const b = await makeClinic('showb');
    await prisma.patient.create({ data: { clinicId: a.id, fullName: 'سامر (رقم ثاني)', phone: '+970599000333' } });
    await prisma.patient.create({ data: { clinicId: a.id, fullName: 'مؤرشف', phone: PHONE, archivedAt: new Date() } });
    const sibling = await prisma.patient.create({ data: { clinicId: a.id, fullName: 'ياسمين أحمد', phone: PHONE } });
    const o = (await page(await link(a)).expect(200)).body;
    expect(o.clinic.name).toBe(`showa-${tag}`);
    expect(o.phoneEnding).toBe('0222');
    expect(o.patients.map((p: { fullName: string }) => p.fullName).sort()).toEqual(['ليلى أحمد', 'ياسمين أحمد']);
    expect(o.doctors.map((d: { fullName: string }) => d.fullName).sort()).toEqual(['د. رنا', 'د. سامي']);
    expect(JSON.stringify(o)).not.toContain('000333');
    // the same link never reaches clinic B's records, even by guessing ids
    const t = await link(a);
    await http().post(`/public/book/${t}/appointments`).send({ patientId: b.patient, doctorId: b.doctor, startsAt: dayAt(5, 600).toISOString() }).expect(404);
    expect(sibling.id).toBeTruthy();
  });

  // ---------------------------------------------------------------- new patient
  it('a new patient registers with the same form; his phone comes from the link and he is flagged until a treatment is opened', async () => {
    const c = await makeClinic('reg');
    const t = await link(c, '+970599000444');
    expect((await page(t).expect(200)).body.patients).toEqual([]);
    // the phone cannot be typed: it is not a field
    await http().post(`/public/book/${t}/register`).send({ fullName: 'كريم', phone: PHONE, gender: 'MALE' }).expect(400);
    await http().post(`/public/book/${t}/register`).send({ gender: 'MALE' }).expect(400);
    const r = (await http().post(`/public/book/${t}/register`).send({ fullName: 'كريم خالد', gender: 'MALE', birthDate: '2000-05-01' }).expect(201)).body;
    const row = await prisma.patient.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ clinicId: c.id, phone: '+970599000444', selfRegistered: true, fullName: 'كريم خالد' });
    expect((await page(t).expect(200)).body.patients.map((p: { id: string }) => p.id)).toEqual([r.id]);

    // opening a treatment makes him an ordinary patient
    const type = await prisma.treatmentType.create({ data: { clinicId: c.id, name: 'حشوة' } });
    const doctorUser = await prisma.user.create({ data: { username: `o_${tag}_reg`, passwordHash: 'x', fullName: 'م', role: 'OWNER', clinicId: c.id } });
    const owner = await app.get(TokenService).signAccess({ sub: doctorUser.id, role: 'OWNER', clinicId: c.id, mcp: false });
    await http().post('/treatments').set(bearer(owner)).send({ patientId: r.id, doctorId: c.doctor, teeth: [{ toothCode: 16, treatmentTypeId: type.id }], totalCost: 10000, plannedSessions: 1 }).expect(201);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: r.id } })).selfRegistered).toBe(false);
  });

  it('registering never reveals that an ID number is taken, and one phone cannot flood the clinic with records', async () => {
    const c = await makeClinic('regid');
    await prisma.patient.create({ data: { clinicId: c.id, fullName: 'قديم', phone: '+970599000555', nationalId: '123456789' } });
    const t = await link(c, '+970599000666');
    const res = await http().post(`/public/book/${t}/register`).send({ fullName: 'منتحل', gender: 'MALE', nationalId: '123456789' }).expect(400);
    expect(JSON.stringify(res.body)).not.toContain('رقم الهوية');
    expect(await prisma.patient.count({ where: { clinicId: c.id, phone: '+970599000666' } })).toBe(0);
    for (let i = 0; i < 5; i++) await http().post(`/public/book/${t}/register`).send({ fullName: `فرد ${i}`, gender: 'FEMALE' }).expect(201);
    await http().post(`/public/book/${t}/register`).send({ fullName: 'السادس', gender: 'FEMALE' }).expect(400);
  });

  // ---------------------------------------------------------------- times
  it('days and times: only free times, never the patient behind a busy slot; the past is empty', async () => {
    const c = await makeClinic('slots');
    const other = await prisma.patient.create({ data: { clinicId: c.id, fullName: 'سر المريض', phone: '+970599000999' } });
    const start = dayAt(5, 600);
    await prisma.appointment.create({ data: { clinicId: c.id, patientId: other.id, doctorId: c.doctor, startsAt: start, endsAt: new Date(start.getTime() + 30 * 60_000), status: 'CONFIRMED' } });
    const t = await link(c);
    const slots = (await page(t, `/slots?doctorId=${c.doctor}&date=${dateOf(start)}`).expect(200)).body.slots as string[];
    expect(slots).not.toContain(start.toISOString());
    expect(slots).toContain(new Date(start.getTime() + 30 * 60_000).toISOString());
    expect(slots).toContain(dayAt(5, 8 * 60).toISOString());
    expect(JSON.stringify(slots)).not.toContain('سر المريض');
    // the other doctor is free at that time
    expect((await page(t, `/slots?doctorId=${c.doctor2}&date=${dateOf(start)}`).expect(200)).body.slots).toContain(start.toISOString());
    expect((await page(t, `/slots?doctorId=${c.doctor}&date=${dateOf(dayAt(-2, 600))}`).expect(200)).body.slots).toEqual([]);
    expect((await page(t, `/slots?doctorId=${c.doctor}&date=${dateOf(dayAt(90, 600))}`).expect(200)).body.slots).toEqual([]);
    const days = (await page(t, `/days?doctorId=${c.doctor}`).expect(200)).body.days as { date: string; count: number }[];
    expect(days.length).toBeGreaterThan(50);
    expect(days.find((d) => d.date === dateOf(start))!.count).toBe(23);
    await page(t, `/slots?doctorId=${randomUUID()}&date=${dateOf(start)}`).expect(404);
    await page(t, '/slots?doctorId=x&date=2026-01-01').expect(400);
  });

  // ---------------------------------------------------------------- booking
  it('books once: more than 48h ahead waits for the message, less than 48h is confirmed; a second booking is refused', async () => {
    const c = await makeClinic('book');
    const t = await link(c);
    const far = dayAt(5, 600);
    const res = (await http().post(`/public/book/${t}/appointments`).send({ patientId: c.patient, doctorId: c.doctor, startsAt: far.toISOString() }).expect(201)).body;
    expect(res.status).toBe('PENDING'); // same rule as a booking made by the secretary
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: res.id } });
    expect(row).toMatchObject({ bookedByPatient: true, patientId: c.patient, doctorId: c.doctor, clinicId: c.id });
    expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(30 * 60_000);

    // one upcoming appointment only
    await http().post(`/public/book/${t}/appointments`).send({ patientId: c.patient, doctorId: c.doctor2, startsAt: dayAt(6, 600).toISOString() }).expect(409);
    expect(await prisma.appointment.count({ where: { patientId: c.patient } })).toBe(1);

    // the staff sees where it came from, and the card data for the message
    const staffView = (await http().get(`/appointments/${res.id}`).set(bearer(c.staff)).expect(200)).body;
    expect(staffView).toMatchObject({ bookedByPatient: true, status: 'PENDING' });
    expect(staffView.messageDueAt).toBeTruthy();

    // after cancelling he may book again, and a near time is confirmed at once
    await http().post(`/public/book/${t}/appointments/${res.id}/cancel`).expect(200);
    const near = (await http().post(`/public/book/${t}/appointments`).send({ patientId: c.patient, doctorId: c.doctor, startsAt: dayAt(1, 600).toISOString() }).expect(201)).body;
    expect(near.status).toBe('CONFIRMED');
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: { in: ['PATIENT_SELF_BOOKED', 'PATIENT_SELF_CANCELLED'] } } })).toBe(3);
  });

  it('two taps at the same moment book only one appointment', async () => {
    const c = await makeClinic('twice');
    const t = await link(c);
    const go = (startsAt: Date, doctorId: string) => http().post(`/public/book/${t}/appointments`).send({ patientId: c.patient, doctorId, startsAt: startsAt.toISOString() });
    const [a, b] = await Promise.all([go(dayAt(5, 600), c.doctor), go(dayAt(5, 660), c.doctor2)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.appointment.count({ where: { patientId: c.patient } })).toBe(1);
  });

  it('the usual booking rules still apply: taken time, past, too far, not the half hour, outside hours', async () => {
    const c = await makeClinic('rules');
    const t = await link(c);
    const post = (startsAt: Date, patientId = c.patient) => http().post(`/public/book/${t}/appointments`).send({ patientId, doctorId: c.doctor, startsAt: startsAt.toISOString() });
    const taken = dayAt(5, 600);
    const staff = await http().post('/appointments').set(bearer(c.staff)).send({ patientId: (await prisma.patient.create({ data: { clinicId: c.id, fullName: 'آخر', phone: '+970599000123' } })).id, doctorId: c.doctor, startsAt: taken.toISOString(), durationMinutes: 30 });
    expect(staff.status).toBe(201);
    await post(taken).expect(409);
    await post(new Date(Date.now() - HOUR)).expect(400);
    await post(dayAt(70, 600)).expect(400);
    await post(new Date(dayAt(5, 600).getTime() + 10 * 60_000)).expect(400);
    await post(dayAt(5, 6 * 60)).expect(400); // before the doctor starts
    await post(dayAt(5, 660), randomUUID()).expect(404);
    await http().post(`/public/book/${t}/appointments`).send({ patientId: c.patient, doctorId: c.doctor, startsAt: dayAt(5, 660).toISOString(), status: 'CONFIRMED' }).expect(400);
  });

  it('only a record on the phone that wrote can be booked, changed or cancelled', async () => {
    const c = await makeClinic('own');
    const stranger = await prisma.patient.create({ data: { clinicId: c.id, fullName: 'غريب', phone: '+970599000888' } });
    const theirs = await prisma.appointment.create({ data: { clinicId: c.id, patientId: stranger.id, doctorId: c.doctor, startsAt: dayAt(5, 600), endsAt: dayAt(5, 630), status: 'PENDING' } });
    const t = await link(c);
    await http().post(`/public/book/${t}/appointments`).send({ patientId: stranger.id, doctorId: c.doctor, startsAt: dayAt(6, 600).toISOString() }).expect(404);
    await http().patch(`/public/book/${t}/appointments/${theirs.id}`).send({ startsAt: dayAt(7, 600).toISOString() }).expect(404);
    await http().post(`/public/book/${t}/appointments/${theirs.id}/cancel`).expect(404);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('PENDING');
    // and the overview does not show it
    expect(JSON.stringify((await page(t).expect(200)).body)).not.toContain('غريب');
  });

  it('he sees his appointment, moves it (the message follows the new time) and cancels it', async () => {
    const c = await makeClinic('edit');
    const t = await link(c);
    const first = dayAt(5, 600);
    const apt = (await http().post(`/public/book/${t}/appointments`).send({ patientId: c.patient, doctorId: c.doctor, startsAt: first.toISOString() }).expect(201)).body;
    const shown = (await page(t).expect(200)).body.patients.find((p: { id: string }) => p.id === c.patient).appointment;
    expect(shown).toMatchObject({ id: apt.id, status: 'PENDING', doctor: { id: c.doctor } });

    // his own time shows as free again while he is moving it, so he can keep the same hour with another doctor
    expect((await page(t, `/slots?doctorId=${c.doctor}&date=${dateOf(first)}&appointmentId=${apt.id}`).expect(200)).body.slots).toContain(first.toISOString());
    expect((await page(t, `/slots?doctorId=${c.doctor}&date=${dateOf(first)}`).expect(200)).body.slots).not.toContain(first.toISOString());

    const second = dayAt(8, 690);
    await http().patch(`/public/book/${t}/appointments/${apt.id}`).send({ startsAt: second.toISOString(), doctorId: c.doctor2 }).expect(200);
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: apt.id } })).toMatchObject({ startsAt: second, doctorId: c.doctor2, status: 'PENDING' });
    await http().patch(`/public/book/${t}/appointments/${apt.id}`).send({ startsAt: new Date(Date.now() - HOUR).toISOString() }).expect(400);
    await http().patch(`/public/book/${t}/appointments/${apt.id}`).send({}).expect(400);

    await http().post(`/public/book/${t}/appointments/${apt.id}/cancel`).expect(200);
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: apt.id } })).toMatchObject({ status: 'CANCELLED' });
    await http().post(`/public/book/${t}/appointments/${apt.id}/cancel`).expect(404); // already gone
    const after = (await page(t).expect(200)).body.patients.find((p: { id: string }) => p.id === c.patient);
    expect(after.appointment).toBeNull();
  });

  it("clinic B's link cannot touch clinic A's appointment", async () => {
    const a = await makeClinic('isoa');
    const b = await makeClinic('isob');
    const ta = await link(a);
    const apt = (await http().post(`/public/book/${ta}/appointments`).send({ patientId: a.patient, doctorId: a.doctor, startsAt: dayAt(5, 600).toISOString() }).expect(201)).body;
    const tb = await link(b); // the same phone number is also a patient of clinic B
    await http().patch(`/public/book/${tb}/appointments/${apt.id}`).send({ startsAt: dayAt(7, 600).toISOString() }).expect(404);
    await http().post(`/public/book/${tb}/appointments/${apt.id}/cancel`).expect(404);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: apt.id } })).status).toBe('PENDING');
  });
});
