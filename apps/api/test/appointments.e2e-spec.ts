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
import { localTime } from '../src/scheduling/clinic-time.js';

const TZ = 'Asia/Hebron';

/** The UTC instant at which the clinic's wall clock shows `minute` on the given calendar day (handles daylight saving). */
function at(day: Date, minute: number): Date {
  const guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, minute);
  for (const hours of [2, 3]) {
    const candidate = new Date(guess - hours * 3_600_000);
    const l = localTime(candidate, TZ);
    if (l.minute === minute % 1440) return candidate;
  }
  throw new Error('time zone helper failed');
}

/** The next calendar day (at least `ahead` days from now) that falls on the given local weekday. */
function nextWeekday(weekday: number, ahead = 2): Date {
  const d = new Date(Date.now() + ahead * 86_400_000);
  d.setUTCHours(12, 0, 0, 0);
  while (localTime(d, TZ).weekday !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

const H = (h: number, m = 0) => h * 60 + m;

// Real database. Creates its own clinics/users with random names and deletes them at the end.
describe('Doctors and appointments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const password = 'Test-Pass-12345';
  const clinicIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const monday = nextWeekday(1);

  interface Clinic {
    id: string;
    users: Record<Role, { id: string; token: string }>;
    docA: string; // the owner's doctor record
    docB: string; // a second doctor with a login
    docBToken: string;
    patient: string;
  }

  async function makeClinic(name: string, withHours = true): Promise<Clinic> {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}` } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash(password);
    const users = {} as Clinic['users'];
    for (const role of ['OWNER', 'DOCTOR', 'SECRETARY'] as Role[]) {
      const username = `${name}_${role}_${tag}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id } });
      users[role] = { id: u.id, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }) };
    }
    const docA = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.OWNER.id, fullName: 'Owner Doc' } });
    const docB = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOCTOR.id, fullName: 'Second Doc' } });
    if (withHours) {
      for (const d of [docA, docB]) {
        // Monday 09:00-13:00 and 16:00-19:00 (two periods in one day)
        await prisma.doctorWorkingPeriod.createMany({
          data: [
            { clinicId: clinic.id, doctorId: d.id, weekday: 1, startMinute: H(9), endMinute: H(13) },
            { clinicId: clinic.id, doctorId: d.id, weekday: 1, startMinute: H(16), endMinute: H(19) },
          ],
        });
      }
    }
    const patient = await prisma.patient.create({ data: { clinicId: clinic.id, fullName: `Patient ${name}`, phone: '+970599000111' } });
    return { id: clinic.id, users, docA: docA.id, docB: docB.id, docBToken: users.DOCTOR.token, patient: patient.id };
  }

  const book = (token: string, c: Clinic, body: Record<string, unknown> = {}) =>
    http()
      .post('/appointments')
      .set(bearer(token))
      .send({ patientId: c.patient, doctorId: c.docA, startsAt: at(monday, H(9)).toISOString(), durationMinutes: 30, ...body });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.doctorWorkingPeriod.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.patient.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.doctor.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.user.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  // ---------------------------------------------------------------- booking
  it('the secretary books 30 min at 09:00; the next free time for that doctor is 09:30', async () => {
    const c = await makeClinic('book');
    const res = await book(c.users.SECRETARY.token, c).expect(201);
    expect(res.body).toMatchObject({ status: 'PENDING', durationMinutes: 30, overdue: false, patient: { id: c.patient }, doctor: { id: c.docA } });
    expect(new Date(res.body.endsAt).toISOString()).toBe(at(monday, H(9, 30)).toISOString());

    await book(c.users.SECRETARY.token, c, { startsAt: at(monday, H(9)).toISOString() }).expect(409); // same time
    await book(c.users.SECRETARY.token, c, { startsAt: at(monday, H(9, 30)).toISOString() }).expect(201); // right after
  });

  it('a 60-minute booking blocks the whole hour, for both overlap directions', async () => {
    const c = await makeClinic('hour');
    await book(c.users.OWNER.token, c, { startsAt: at(monday, H(10)).toISOString(), durationMinutes: 60 }).expect(201);
    await book(c.users.OWNER.token, c, { startsAt: at(monday, H(10, 30)).toISOString() }).expect(409); // inside it
    await book(c.users.OWNER.token, c, { startsAt: at(monday, H(9, 30)).toISOString(), durationMinutes: 60 }).expect(409); // runs into it
    await book(c.users.OWNER.token, c, { startsAt: at(monday, H(9, 30)).toISOString() }).expect(201); // ends exactly when it starts
    await book(c.users.OWNER.token, c, { startsAt: at(monday, H(11)).toISOString() }).expect(201); // starts exactly when it ends
  });

  it('the same time with a DIFFERENT doctor is fine', async () => {
    const c = await makeClinic('twodocs');
    await book(c.users.SECRETARY.token, c).expect(201);
    await book(c.users.SECRETARY.token, c, { doctorId: c.docB }).expect(201);
  });

  it('a cancelled appointment frees the slot', async () => {
    const c = await makeClinic('free');
    const a = (await book(c.users.SECRETARY.token, c).expect(201)).body;
    await http().post(`/appointments/${a.id}/cancel`).set(bearer(c.users.SECRETARY.token)).send({ reason: 'المريض اعتذر' }).expect(200);
    await book(c.users.SECRETARY.token, c).expect(201);
  });

  it('two people booking the same slot at the same moment: exactly one wins (the database decides)', async () => {
    const c = await makeClinic('race');
    const slot = at(monday, H(11)).toISOString();
    const results = await Promise.all(Array.from({ length: 6 }, () => book(c.users.SECRETARY.token, c, { startsAt: slot })));
    const codes = results.map((r) => r.status).sort((a, b) => a - b);
    expect(codes).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await prisma.appointment.count({ where: { clinicId: c.id } })).toBe(1);
  });

  it('PostgreSQL itself refuses overlapping rows, even if the API code were bypassed', async () => {
    const c = await makeClinic('dbrule');
    const start = at(monday, H(12));
    const row = (s: Date, e: Date) => ({ clinicId: c.id, patientId: c.patient, doctorId: c.docA, startsAt: s, endsAt: e });
    await prisma.appointment.create({ data: row(start, new Date(start.getTime() + 30 * 60_000)) });
    await expect(prisma.appointment.create({ data: row(new Date(start.getTime() + 10 * 60_000), new Date(start.getTime() + 40 * 60_000)) })).rejects.toThrow();
    await expect(prisma.appointment.create({ data: row(start, start) })).rejects.toThrow(); // zero length
  });

  it('refuses bad times: not on the half hour, wrong length, past, outside working hours, wrong day', async () => {
    const c = await makeClinic('rules');
    const t = c.users.SECRETARY.token;
    await book(t, c, { startsAt: at(monday, H(9, 15)).toISOString() }).expect(400);
    await book(t, c, { startsAt: new Date(at(monday, H(9)).getTime() + 1000).toISOString() }).expect(400);
    await book(t, c, { durationMinutes: 45 }).expect(400);
    await book(t, c, { durationMinutes: 90 }).expect(400);
    await book(t, c, { startsAt: at(monday, H(8, 30)).toISOString() }).expect(400); // before opening
    await book(t, c, { startsAt: at(monday, H(12, 30)).toISOString(), durationMinutes: 60 }).expect(400); // runs past 13:00
    await book(t, c, { startsAt: at(monday, H(13)).toISOString() }).expect(400); // lunch break
    await book(t, c, { startsAt: at(monday, H(18, 30)).toISOString() }).expect(201); // last slot of the evening period
    await book(t, c, { startsAt: at(nextWeekday(2), H(9)).toISOString() }).expect(400); // Tuesday: no hours
    const lastMonday = new Date(monday.getTime() - 21 * 86_400_000);
    await book(t, c, { startsAt: at(lastMonday, H(9)).toISOString() }).expect(400); // the past
  });

  it('a doctor with no working hours cannot be booked, and a bad doctor/patient is refused', async () => {
    const c = await makeClinic('nohours', false);
    await book(c.users.SECRETARY.token, c).expect(400);
    const d = await makeClinic('okhours');
    await book(d.users.SECRETARY.token, d, { patientId: randomUUID() }).expect(404);
    await book(d.users.SECRETARY.token, d, { doctorId: randomUUID() }).expect(404);
    await prisma.patient.update({ where: { id: d.patient }, data: { archivedAt: new Date() } });
    await book(d.users.SECRETARY.token, d).expect(400); // archived patient
    await http().post('/appointments').set(bearer(d.users.SECRETARY.token)).send({ patientId: d.patient }).expect(400);
    await http().post('/appointments').set(bearer(d.users.SECRETARY.token)).send({ patientId: d.patient, doctorId: d.docA, startsAt: at(monday, H(9)).toISOString(), durationMinutes: 30, clinicId: randomUUID() }).expect(400);
  });

  // ---------------------------------------------------------------- doctor role
  it('a doctor books only on their own schedule; the owner and secretary book with anyone', async () => {
    const c = await makeClinic('docrole');
    await book(c.docBToken, c, { doctorId: c.docA }).expect(403); // another doctor's time
    await book(c.docBToken, c, { doctorId: c.docB }).expect(201); // own time
    await book(c.users.OWNER.token, c, { doctorId: c.docB, startsAt: at(monday, H(10)).toISOString() }).expect(201);
    await book(c.users.SECRETARY.token, c, { doctorId: c.docB, startsAt: at(monday, H(10, 30)).toISOString() }).expect(201);
  });

  it('a doctor sees and touches only their own appointments', async () => {
    const c = await makeClinic('docsee');
    const mine = (await book(c.docBToken, c, { doctorId: c.docB }).expect(201)).body;
    const other = (await book(c.users.SECRETARY.token, c, { doctorId: c.docA }).expect(201)).body;
    const range = `from=${encodeURIComponent(at(monday, 0).toISOString())}&to=${encodeURIComponent(at(monday, 1439).toISOString())}`;

    const docList = await http().get(`/appointments?${range}`).set(bearer(c.docBToken)).expect(200);
    expect(docList.body.map((a: { id: string }) => a.id)).toEqual([mine.id]);
    const ownerList = await http().get(`/appointments?${range}`).set(bearer(c.users.OWNER.token)).expect(200);
    expect(ownerList.body).toHaveLength(2);
    await http().get(`/appointments?${range}&doctorId=${c.docA}`).set(bearer(c.docBToken)).expect(403);
    const filtered = await http().get(`/appointments?${range}&doctorId=${c.docA}`).set(bearer(c.users.SECRETARY.token)).expect(200);
    expect(filtered.body.map((a: { id: string }) => a.id)).toEqual([other.id]);

    await http().get(`/appointments/${other.id}`).set(bearer(c.docBToken)).expect(404);
    await http().patch(`/appointments/${other.id}`).set(bearer(c.docBToken)).send({ notes: 'x' }).expect(404);
    await http().post(`/appointments/${other.id}/cancel`).set(bearer(c.docBToken)).send({}).expect(404);
    await http().patch(`/appointments/${mine.id}`).set(bearer(c.docBToken)).send({ doctorId: c.docA }).expect(403); // cannot hand it to someone else's calendar
  });

  it('doctors list: owner/secretary see everyone, a doctor sees only themselves', async () => {
    const c = await makeClinic('doclist');
    const all = await http().get('/doctors').set(bearer(c.users.SECRETARY.token)).expect(200);
    expect(all.body).toHaveLength(2);
    expect(all.body[0].workingPeriods.length).toBe(2);
    const self = await http().get('/doctors').set(bearer(c.docBToken)).expect(200);
    expect(self.body.map((d: { id: string }) => d.id)).toEqual([c.docB]);
  });

  // ---------------------------------------------------------------- changing and finishing
  it('reschedule keeps every rule: conflicts, hours, and the appointment never overlaps itself', async () => {
    const c = await makeClinic('move');
    const t = c.users.SECRETARY.token;
    const a = (await book(t, c, { durationMinutes: 60 }).expect(201)).body;
    await book(t, c, { startsAt: at(monday, H(11)).toISOString() }).expect(201);

    const same = await http().patch(`/appointments/${a.id}`).set(bearer(t)).send({ startsAt: at(monday, H(9, 30)).toISOString() }).expect(200); // overlaps its own old time: fine
    expect(same.body.durationMinutes).toBe(60);
    await http().patch(`/appointments/${a.id}`).set(bearer(t)).send({ startsAt: at(monday, H(10, 30)).toISOString() }).expect(409); // 10:30-11:30 hits the 11:00 one
    await http().patch(`/appointments/${a.id}`).set(bearer(t)).send({ startsAt: at(monday, H(14)).toISOString() }).expect(400); // lunch
    const shorter = await http().patch(`/appointments/${a.id}`).set(bearer(t)).send({ durationMinutes: 30 }).expect(200);
    expect(shorter.body.durationMinutes).toBe(30);
    const notes = await http().patch(`/appointments/${a.id}`).set(bearer(t)).send({ notes: 'يفضل الصباح' }).expect(200);
    expect(notes.body.notes).toBe('يفضل الصباح');
    await http().patch(`/appointments/${a.id}`).set(bearer(t)).send({}).expect(400);
    await http().patch(`/appointments/${a.id}`).set(bearer(t)).send({ status: 'COMPLETED' }).expect(400); // status only changes through its own routes
  });

  it('status flow: pending -> confirmed -> (cannot confirm twice) ; cancel is final; completed/cancelled cannot change', async () => {
    const c = await makeClinic('flow');
    const t = c.users.SECRETARY.token;
    const a = (await book(t, c).expect(201)).body;
    const confirmed = await http().post(`/appointments/${a.id}/confirm`).set(bearer(t)).expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.confirmedAt).toBeTruthy();
    await http().post(`/appointments/${a.id}/confirm`).set(bearer(t)).expect(409);
    await http().post(`/appointments/${a.id}/complete`).set(bearer(t)).expect(409); // it is in the future: cannot be finished yet
    const cancelled = await http().post(`/appointments/${a.id}/cancel`).set(bearer(t)).send({ reason: 'سافر' }).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'سافر' });
    await http().post(`/appointments/${a.id}/cancel`).set(bearer(t)).send({}).expect(409);
    await http().post(`/appointments/${a.id}/confirm`).set(bearer(t)).expect(409);
    await http().patch(`/appointments/${a.id}`).set(bearer(t)).send({ notes: 'x' }).expect(409);
    await http().post(`/appointments/${randomUUID()}/confirm`).set(bearer(t)).expect(404);
  });

  it('a past appointment can be completed, and shows as overdue while it is still pending', async () => {
    const c = await makeClinic('past');
    const start = new Date(Math.floor((Date.now() - 3 * 3_600_000) / 1_800_000) * 1_800_000);
    const row = await prisma.appointment.create({ data: { clinicId: c.id, patientId: c.patient, doctorId: c.docA, startsAt: start, endsAt: new Date(start.getTime() + 30 * 60_000) } });
    const range = `from=${encodeURIComponent(new Date(start.getTime() - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date(start.getTime() + 3_600_000).toISOString())}`;
    const list = await http().get(`/appointments?${range}`).set(bearer(c.users.OWNER.token)).expect(200);
    expect(list.body[0]).toMatchObject({ id: row.id, status: 'PENDING', overdue: true });
    const done = await http().post(`/appointments/${row.id}/complete`).set(bearer(c.users.OWNER.token)).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', overdue: false });
    expect(done.body.completedAt).toBeTruthy();
  });

  it('listing needs a sane range', async () => {
    const c = await makeClinic('range');
    const t = c.users.OWNER.token;
    const from = new Date().toISOString();
    await http().get('/appointments').set(bearer(t)).expect(400);
    await http().get(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(from)}`).set(bearer(t)).expect(400);
    const far = new Date(Date.now() + 40 * 86_400_000).toISOString();
    await http().get(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(far)}`).set(bearer(t)).expect(400);
    await http().get(`/appointments?from=nonsense&to=${encodeURIComponent(far)}`).set(bearer(t)).expect(400);
  });

  // ---------------------------------------------------------------- working hours
  it('only the owner sets working hours; the new set replaces the old one', async () => {
    const c = await makeClinic('hours');
    const body = { periods: [{ weekday: 0, startMinute: H(8), endMinute: H(14) }, { weekday: 3, startMinute: H(10), endMinute: H(12) }, { weekday: 3, startMinute: H(15), endMinute: H(18) }] };
    for (const t of [c.users.SECRETARY.token, c.docBToken]) await http().put(`/doctors/${c.docA}/working-periods`).set(bearer(t)).send(body).expect(403);
    const res = await http().put(`/doctors/${c.docA}/working-periods`).set(bearer(c.users.OWNER.token)).send(body).expect(200);
    expect(res.body.map((p: { weekday: number; startMinute: number }) => [p.weekday, p.startMinute])).toEqual([[0, H(8)], [3, H(10)], [3, H(15)]]);
    expect(await prisma.doctorWorkingPeriod.count({ where: { doctorId: c.docA } })).toBe(3); // the old Monday rows are gone
    await book(c.users.SECRETARY.token, c).expect(400); // Monday is no longer a working day
    const cleared = await http().put(`/doctors/${c.docA}/working-periods`).set(bearer(c.users.OWNER.token)).send({ periods: [] }).expect(200);
    expect(cleared.body).toEqual([]);
  });

  it('working hours are validated', async () => {
    const c = await makeClinic('hoursbad');
    const put = (periods: unknown) => http().put(`/doctors/${c.docA}/working-periods`).set(bearer(c.users.OWNER.token)).send({ periods });
    await put([{ weekday: 7, startMinute: 540, endMinute: 600 }]).expect(400);
    await put([{ weekday: 1, startMinute: 600, endMinute: 540 }]).expect(400); // ends before it starts
    await put([{ weekday: 1, startMinute: 545, endMinute: 600 }]).expect(400); // not on the half hour
    await put([{ weekday: 1, startMinute: 540, endMinute: 1500 }]).expect(400);
    await put([{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 700, endMinute: 800 }]).expect(400); // overlap
    await put([{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 720, endMinute: 810 }]).expect(200); // touching is fine
    await put('nope').expect(400);
    await http().put(`/doctors/${randomUUID()}/working-periods`).set(bearer(c.users.OWNER.token)).send({ periods: [] }).expect(404);
    expect(await prisma.doctorWorkingPeriod.count({ where: { doctorId: c.docA } })).toBe(2); // bad requests changed nothing
  });

  // ---------------------------------------------------------------- isolation and access
  it("clinic B cannot see, change or book into clinic A's calendar", async () => {
    const a = await makeClinic('iso_a');
    const b = await makeClinic('iso_b');
    const apt = (await book(a.users.SECRETARY.token, a).expect(201)).body;
    const range = `from=${encodeURIComponent(at(monday, 0).toISOString())}&to=${encodeURIComponent(at(monday, 1439).toISOString())}`;

    expect((await http().get(`/appointments?${range}`).set(bearer(b.users.OWNER.token)).expect(200)).body).toEqual([]);
    await http().get(`/appointments/${apt.id}`).set(bearer(b.users.OWNER.token)).expect(404);
    await http().patch(`/appointments/${apt.id}`).set(bearer(b.users.OWNER.token)).send({ notes: 'hacked' }).expect(404);
    await http().post(`/appointments/${apt.id}/cancel`).set(bearer(b.users.OWNER.token)).send({}).expect(404);
    await book(b.users.OWNER.token, b, { doctorId: a.docA }).expect(404); // A's doctor
    await book(b.users.OWNER.token, b, { patientId: a.patient }).expect(404); // A's patient
    await http().put(`/doctors/${a.docA}/working-periods`).set(bearer(b.users.OWNER.token)).send({ periods: [] }).expect(404);
    expect((await http().get('/doctors').set(bearer(b.users.OWNER.token)).expect(200)).body.map((d: { id: string }) => d.id)).not.toContain(a.docA);
    expect((await prisma.appointment.findUnique({ where: { id: apt.id } }))!.status).toBe('PENDING');
    expect(await prisma.doctorWorkingPeriod.count({ where: { doctorId: a.docA } })).toBe(2);
  });

  it('anonymous and platform-admin requests are refused', async () => {
    const c = await makeClinic('anon');
    const admin = await prisma.user.create({ data: { username: `padmin_${tag}`, passwordHash: 'x', fullName: 'A', role: 'PLATFORM_ADMIN' } });
    const adminToken = await app.get(TokenService).signAccess({ sub: admin.id, role: 'PLATFORM_ADMIN', clinicId: null, mcp: false });
    await http().get('/doctors').expect(401);
    await http().post('/appointments').send({}).expect(401);
    for (const path of ['/doctors', '/appointments']) await http().get(path).set(bearer(adminToken)).expect(403);
    await http().post('/appointments').set(bearer(adminToken)).send({ patientId: c.patient, doctorId: c.docA, startsAt: at(monday, H(9)).toISOString(), durationMinutes: 30 }).expect(403);
    await prisma.user.delete({ where: { id: admin.id } });
  });
});
