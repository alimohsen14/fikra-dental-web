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

// Real database. Creates its own clinics/users with random names and deletes them at the end.
describe('Treatments, sessions and payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const clinicIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const now = () => new Date().toISOString();

  // The UTC instant at which the clinic's wall clock (Asia/Hebron) shows `minute` on the given day.
  const at = (day: Date, minute: number): Date => {
    const guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, minute);
    for (const hours of [2, 3]) {
      const candidate = new Date(guess - hours * 3_600_000);
      if (localTime(candidate, 'Asia/Hebron').minute === minute) return candidate;
    }
    throw new Error('time helper failed');
  };
  const monday = (() => {
    const d = new Date(Date.now() + 2 * 86_400_000);
    d.setUTCHours(12, 0, 0, 0);
    while (localTime(d, 'Asia/Hebron').weekday !== 1) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  })();

  async function makeClinic(name: string) {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}` } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash('Test-Pass-12345');
    const users = {} as Record<'OWNER' | 'DOCTOR' | 'DOCTOR2' | 'SECRETARY' | 'KEYHOLDER', { id: string; token: string }>;
    const defs: [keyof typeof users, Role, boolean][] = [['OWNER', 'OWNER', true], ['DOCTOR', 'DOCTOR', false], ['DOCTOR2', 'DOCTOR', false], ['SECRETARY', 'SECRETARY', false], ['KEYHOLDER', 'SECRETARY', true]];
    for (const [key, role, canManagePayments] of defs) {
      const username = `${name}_${key}_${tag}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id, canManagePayments } });
      users[key] = { id: u.id, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }) };
    }
    const docOwner = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.OWNER.id, fullName: 'Owner Doc' } });
    const doc1 = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOCTOR.id, fullName: 'Doc One' } });
    const doc2 = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOCTOR2.id, fullName: 'Doc Two' } });
    const patient = await prisma.patient.create({ data: { clinicId: clinic.id, fullName: `Patient ${name}`, phone: '+970599000111' } });
    const type = await prisma.treatmentType.create({ data: { clinicId: clinic.id, name: 'حشوة' } });
    return { id: clinic.id, users, docOwner: docOwner.id, doc1: doc1.id, doc2: doc2.id, patient: patient.id, type: type.id };
  }
  type Clinic = Awaited<ReturnType<typeof makeClinic>>;

  /** Shortcut: `toothCodes` (+ optional `treatmentTypeId`) become teeth that all share one type; pass `teeth` for per-tooth types. */
  const body = (c: Clinic, over: Record<string, unknown> = {}) => {
    const { toothCodes = [16], treatmentTypeId = c.type, ...rest } = over as { toothCodes?: unknown[]; treatmentTypeId?: unknown } & Record<string, unknown>;
    return { patientId: c.patient, teeth: toothCodes.map((toothCode) => ({ toothCode, treatmentTypeId })), totalCost: 100_000, plannedSessions: 2, ...rest };
  };
  const create = (token: string, c: Clinic, over: Record<string, unknown> = {}) => http().post('/treatments').set(bearer(token)).send(body(c, over));
  const pay = (token: string, id: string, over: Record<string, unknown> = {}) => http().post(`/treatments/${id}/payments`).set(bearer(token)).send({ amount: 10_000, method: 'CASH', paidAt: now(), ...over });
  const close = (token: string, id: string) => http().post(`/treatments/${id}/close`).set(bearer(token)).send({});
  const complete = (token: string, id: string, n: number) => http().post(`/treatments/${id}/sessions/${n}/complete`).set(bearer(token)).send({});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    const w = { clinicId: { in: clinicIds } };
    await prisma.payment.deleteMany({ where: w });
    await prisma.session.deleteMany({ where: w });
    await prisma.treatmentTooth.deleteMany({ where: w });
    await prisma.treatment.deleteMany({ where: w });
    await prisma.treatmentType.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: w });
    await prisma.appointment.deleteMany({ where: w });
    await prisma.patient.deleteMany({ where: w });
    await prisma.doctorWorkingPeriod.deleteMany({ where: w });
    await prisma.doctor.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  // ---------------------------------------------------------------- treatment types
  it('treatment types: owner and doctor add, only the owner renames or stops; duplicates refused; isolated per clinic', async () => {
    const c = await makeClinic('types');
    const other = await makeClinic('types2');
    const t = (await http().post('/treatment-types').set(bearer(c.users.DOCTOR.token)).send({ name: 'تقويم' }).expect(201)).body;
    expect(t).toMatchObject({ name: 'تقويم', isActive: true });
    await http().post('/treatment-types').set(bearer(c.users.OWNER.token)).send({ name: 'تقويم' }).expect(409);
    await http().post('/treatment-types').set(bearer(c.users.OWNER.token)).send({ name: 'x' }).expect(400);
    await http().post('/treatment-types').set(bearer(c.users.OWNER.token)).send({ name: 'خلع', clinicId: other.id }).expect(400);
    await http().post('/treatment-types').set(bearer(other.users.OWNER.token)).send({ name: 'تقويم' }).expect(201); // same name in another clinic is fine
    await http().patch(`/treatment-types/${t.id}`).set(bearer(c.users.DOCTOR.token)).send({ isActive: false }).expect(403);
    await http().patch(`/treatment-types/${t.id}`).set(bearer(other.users.OWNER.token)).send({ isActive: false }).expect(404);
    const stopped = await http().patch(`/treatment-types/${t.id}`).set(bearer(c.users.OWNER.token)).send({ isActive: false }).expect(200);
    expect(stopped.body.isActive).toBe(false);
    await create(c.users.OWNER.token, c, { treatmentTypeId: t.id, doctorId: c.docOwner }).expect(400); // a stopped type cannot be used
    const list = await http().get('/treatment-types').set(bearer(c.users.OWNER.token)).expect(200);
    expect(list.body.map((x: { name: string }) => x.name).sort()).toEqual(['تقويم', 'حشوة']);
    await http().get('/treatment-types').set(bearer(c.users.SECRETARY.token)).expect(403);
  });

  // ---------------------------------------------------------------- create
  it('creates a treatment: sessions 1..n are planned automatically, teeth saved, audited, owner defaults to own doctor record', async () => {
    const c = await makeClinic('create');
    const res = await create(c.users.OWNER.token, c, { toothCodes: [16, 17, 54], plannedSessions: 3, description: 'حشوة عميقة' }).expect(201);
    expect(res.body).toMatchObject({
      status: 'OPEN',
      totalCost: 100_000,
      plannedSessions: 3,
      toothCodes: [16, 17, 54],
      doctor: { id: c.docOwner },
      paid: 0,
      remaining: 100_000,
      payments: [],
    });
    expect(res.body.teeth.map((x: { toothCode: number; treatmentType: { name: string } }) => [x.toothCode, x.treatmentType.name])).toEqual([[16, 'حشوة'], [17, 'حشوة'], [54, 'حشوة']]);
    expect(res.body.treatmentType).toBeUndefined();
    expect(res.body.sessions.map((s: { number: number; status: string }) => [s.number, s.status])).toEqual([[1, 'PLANNED'], [2, 'PLANNED'], [3, 'PLANNED']]);
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: 'TREATMENT_CREATED', entityId: res.body.id } })).toBe(1);
    const got = await http().get(`/treatments/${res.body.id}`).set(bearer(c.users.OWNER.token)).expect(200);
    expect(got.body.id).toBe(res.body.id);
    const list = await http().get(`/treatments?patientId=${c.patient}`).set(bearer(c.users.OWNER.token)).expect(200);
    expect(list.body.map((x: { id: string }) => x.id)).toEqual([res.body.id]);
  });

  it('refuses bad input: teeth, money, sessions, unknown fields', async () => {
    const c = await makeClinic('bad');
    const t = c.users.OWNER.token;
    for (const over of [
      { toothCodes: [] }, { toothCodes: [19] }, { toothCodes: [49] }, { toothCodes: [56] }, { toothCodes: [16, 16] }, { toothCodes: ['16'] }, { toothCodes: [16.5] },
      { totalCost: 150.5 }, { totalCost: -1 }, { totalCost: 100_000_001 }, { totalCost: '1000' },
      { plannedSessions: 0 }, { plannedSessions: 51 }, { plannedSessions: 1.5 },
      { clinicId: randomUUID() }, { status: 'CLOSED' }, { patientId: 'nope' },
    ]) await create(t, c, over).expect(400);
    await create(t, c, { totalCost: 0 }).expect(201); // a free treatment is allowed
    expect(await prisma.treatment.count({ where: { clinicId: c.id } })).toBe(1);
  });

  it('refuses unknown or foreign things, archived patients, stopped doctors, future start dates', async () => {
    const c = await makeClinic('refs');
    const other = await makeClinic('refs2');
    const t = c.users.OWNER.token;
    await create(t, c, { patientId: randomUUID() }).expect(404);
    await create(t, c, { patientId: other.patient }).expect(404);
    await create(t, c, { treatmentTypeId: other.type }).expect(404);
    await create(t, c, { doctorId: other.docOwner }).expect(404);
    await create(t, c, { startedAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(400);
    await prisma.doctor.update({ where: { id: c.doc2 }, data: { isActive: false } });
    await create(t, c, { doctorId: c.doc2 }).expect(400);
    await prisma.patient.update({ where: { id: c.patient }, data: { archivedAt: new Date() } });
    await create(t, c).expect(400);
    expect(await prisma.treatment.count({ where: { clinicId: c.id } })).toBe(0);
  });

  it('links to a booked appointment only when it matches patient and doctor, and only once', async () => {
    const c = await makeClinic('apt');
    const start = new Date(Date.now() + 86_400_000);
    const mk = (doctorId: string, status: 'PENDING' | 'CANCELLED' = 'PENDING') => prisma.appointment.create({ data: { clinicId: c.id, patientId: c.patient, doctorId, status, startsAt: start, endsAt: new Date(start.getTime() + 1_800_000) } });
    const apt = await mk(c.doc1);
    const t = c.users.DOCTOR.token;
    await create(t, c, { appointmentId: (await mk(c.doc2)).id }).expect(400); // someone else's appointment
    const later = new Date(start.getTime() + 7_200_000);
    const cancelled = await prisma.appointment.create({ data: { clinicId: c.id, patientId: c.patient, doctorId: c.doc1, status: 'CANCELLED', startsAt: later, endsAt: new Date(later.getTime() + 1_800_000) } });
    await create(t, c, { appointmentId: cancelled.id }).expect(400);
    const ok = await create(t, c, { appointmentId: apt.id }).expect(201);
    expect(ok.body.appointmentId).toBe(apt.id);
    await create(t, c, { appointmentId: apt.id }).expect(409);
    await create(t, c, { appointmentId: randomUUID() }).expect(404);
  });

  // ---------------------------------------------------------------- who can do what
  it('a doctor writes only their own treatments and never sees another doctor\'s', async () => {
    const c = await makeClinic('docscope');
    const mine = (await create(c.users.DOCTOR.token, c).expect(201)).body;
    expect(mine.doctor.id).toBe(c.doc1); // forced to the doctor himself
    await create(c.users.DOCTOR.token, c, { doctorId: c.doc2 }).expect(403);
    const theirs = (await create(c.users.OWNER.token, c, { doctorId: c.doc2 }).expect(201)).body;

    const list = await http().get('/treatments').set(bearer(c.users.DOCTOR.token)).expect(200);
    expect(list.body.map((x: { id: string }) => x.id)).toEqual([mine.id]);
    expect((await http().get('/treatments').set(bearer(c.users.OWNER.token)).expect(200)).body).toHaveLength(2);
    const d = c.users.DOCTOR.token;
    await http().get(`/treatments/${theirs.id}`).set(bearer(d)).expect(404);
    await http().patch(`/treatments/${theirs.id}`).set(bearer(d)).send({ description: 'x' }).expect(404);
    await complete(d, theirs.id, 1).expect(404);
    await http().post(`/treatments/${theirs.id}/cancel`).set(bearer(d)).send({}).expect(404);
  });

  it('money: a doctor without the payments key sees the agreed cost but no paid/remaining/payments, and cannot record payments', async () => {
    const c = await makeClinic('nomoney');
    const t = (await create(c.users.DOCTOR.token, c).expect(201)).body;
    expect(t).toMatchObject({ totalCost: 100_000 });
    for (const k of ['paid', 'remaining', 'payments']) expect(t).not.toHaveProperty(k);
    await pay(c.users.DOCTOR.token, t.id).expect(403);
    await http().get(`/patients/${c.patient}/finance`).set(bearer(c.users.DOCTOR.token)).expect(403);
    const list = await http().get('/treatments').set(bearer(c.users.DOCTOR.token)).expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/"paid"|"remaining"|"payments"/);
    await prisma.user.update({ where: { id: c.users.DOCTOR.id }, data: { canManagePayments: true } }); // the owner gives the key
    await pay(c.users.DOCTOR.token, t.id).expect(201);
    const after = await http().get(`/treatments/${t.id}`).set(bearer(c.users.DOCTOR.token)).expect(200);
    expect(after.body).toMatchObject({ paid: 10_000, remaining: 90_000 });
  });

  it('a secretary: nothing without the key; with the key she sees treatments and records payments, but cannot create or change treatments', async () => {
    const c = await makeClinic('secretary');
    const t = (await create(c.users.OWNER.token, c).expect(201)).body;
    const s = c.users.SECRETARY.token;
    await http().get('/treatments').set(bearer(s)).expect(403);
    await http().get(`/treatments/${t.id}`).set(bearer(s)).expect(403);
    await pay(s, t.id).expect(403);
    await create(s, c).expect(403);

    const k = c.users.KEYHOLDER.token;
    const seen = await http().get(`/treatments/${t.id}`).set(bearer(k)).expect(200);
    expect(seen.body).toMatchObject({ paid: 0, remaining: 100_000 });
    await pay(k, t.id).expect(201);
    await create(k, c).expect(403);
    await http().patch(`/treatments/${t.id}`).set(bearer(k)).send({ totalCost: 5 }).expect(403);
    await complete(k, t.id, 1).expect(403);
    await http().post(`/treatments/${t.id}/cancel`).set(bearer(k)).send({}).expect(403);
    await http().post('/treatment-types').set(bearer(k)).send({ name: 'جديد' }).expect(403);
  });

  it('platform admin and anonymous are refused everywhere', async () => {
    const c = await makeClinic('anon');
    const t = (await create(c.users.OWNER.token, c).expect(201)).body;
    const admin = await prisma.user.create({ data: { username: `padmin_${tag}`, passwordHash: 'x', fullName: 'A', role: 'PLATFORM_ADMIN' } });
    const adminToken = await app.get(TokenService).signAccess({ sub: admin.id, role: 'PLATFORM_ADMIN', clinicId: null, mcp: false });
    for (const path of ['/treatments', `/treatments/${t.id}`, '/treatment-types', `/patients/${c.patient}/finance`]) {
      await http().get(path).expect(401);
      await http().get(path).set(bearer(adminToken)).expect(403);
    }
    await http().post(`/treatments/${t.id}/payments`).set(bearer(adminToken)).send({ amount: 1, method: 'CASH', paidAt: now() }).expect(403);
    await http().post(`/payments/${randomUUID()}/void`).set(bearer(adminToken)).send({ reason: 'xx' }).expect(403);
    await prisma.user.delete({ where: { id: admin.id } });
  });

  // ---------------------------------------------------------------- payments
  it('payments: partial, then full; never above the remaining; whole numbers only; no future dates', async () => {
    const c = await makeClinic('pay');
    const o = c.users.OWNER.token;
    const t = (await create(o, c, { totalCost: 50_000, plannedSessions: 1 }).expect(201)).body;
    const first = await pay(o, t.id, { amount: 20_000, method: 'CARD', note: 'دفعة أولى' }).expect(201);
    expect(first.body).toMatchObject({ paid: 20_000, remaining: 30_000, status: 'OPEN' });
    expect(first.body.payments[0]).toMatchObject({ amount: 20_000, method: 'CARD', status: 'ACTIVE', note: 'دفعة أولى' });
    await pay(o, t.id, { amount: 30_001 }).expect(400);
    for (const bad of [{ amount: 0 }, { amount: -5 }, { amount: 10.5 }, { amount: '100' }, { method: 'BITCOIN' }, { paidAt: 'yesterday' }, { paidAt: new Date(Date.now() + 86_400_000).toISOString() }, { treatmentId: randomUUID() }]) {
      await pay(o, t.id, bad).expect(400);
    }
    await pay(o, t.id, { amount: 30_000, paidAt: new Date(Date.now() - 5 * 86_400_000).toISOString() }).expect(201); // back-dated is fine
    expect((await prisma.payment.count({ where: { treatmentId: t.id } }))).toBe(2);
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: 'PAYMENT_CREATED' } })).toBe(2);
    await pay(o, t.id, { amount: 1 }).expect(400); // nothing left to pay
  });

  it('several payments at the same moment can never add up to more than the cost', async () => {
    const c = await makeClinic('race');
    const t = (await create(c.users.OWNER.token, c, { totalCost: 10_000 }).expect(201)).body;
    const results = await Promise.all(Array.from({ length: 8 }, () => pay(c.users.OWNER.token, t.id, { amount: 5_000 })));
    const codes = results.map((r) => r.status).sort((a, b) => a - b);
    expect(codes.filter((x) => x === 201)).toHaveLength(2);
    expect(codes.filter((x) => x !== 201).every((x) => x === 400 || x === 409)).toBe(true);
    const sum = await prisma.payment.aggregate({ where: { treatmentId: t.id, status: 'ACTIVE' }, _sum: { amount: true } });
    expect(sum._sum.amount).toBe(10_000);
  });

  it('a cancelled treatment takes no payments', async () => {
    const c = await makeClinic('paycancel');
    const t = (await create(c.users.OWNER.token, c).expect(201)).body;
    await http().post(`/treatments/${t.id}/cancel`).set(bearer(c.users.OWNER.token)).send({ reason: 'غيّر رأيه' }).expect(200);
    await pay(c.users.OWNER.token, t.id).expect(409);
  });

  // ---------------------------------------------------------------- sessions and closing
  it('nothing closes by itself: the close button works only when every session is done AND everything is paid', async () => {
    const c = await makeClinic('close');
    const d = c.users.DOCTOR.token;
    await prisma.user.update({ where: { id: c.users.DOCTOR.id }, data: { canManagePayments: true } });

    const a = (await create(d, c, { totalCost: 20_000, plannedSessions: 2 }).expect(201)).body;
    await close(d, a.id).expect(409); // nothing done, nothing paid
    expect((await pay(d, a.id, { amount: 20_000 }).expect(201)).body.status).toBe('OPEN'); // paid, still open
    await close(d, a.id).expect(409); // paid but sessions missing
    const half = await complete(d, a.id, 1).expect(200);
    expect(half.body.status).toBe('OPEN');
    expect(half.body.sessions[0]).toMatchObject({ status: 'COMPLETED' });
    expect(half.body.sessions[0].completedAt).toBeTruthy();
    await close(d, a.id).expect(409); // one session left
    const done = await complete(d, a.id, 2).expect(200);
    expect(done.body.status).toBe('OPEN'); // everything is ready, but it waits for the button
    const closed = await close(d, a.id).expect(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.closedAt).toBeTruthy();
    await close(d, a.id).expect(409); // already closed
    await pay(d, a.id, { amount: 1 }).expect(409);
    await complete(d, a.id, 1).expect(409);
    await http().patch(`/treatments/${a.id}`).set(bearer(d)).send({ description: 'x' }).expect(409);

    // sessions first, then money: still owed means no close
    const b = (await create(d, c, { totalCost: 20_000, plannedSessions: 1 }).expect(201)).body;
    expect((await complete(d, b.id, 1).expect(200)).body.status).toBe('OPEN');
    await close(d, b.id).expect(409);
    expect((await pay(d, b.id, { amount: 19_999 }).expect(201)).body.status).toBe('OPEN');
    await close(d, b.id).expect(409); // one agora short
    expect((await pay(d, b.id, { amount: 1 }).expect(201)).body.status).toBe('OPEN');
    expect((await close(d, b.id).expect(200)).body.status).toBe('CLOSED');
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: 'TREATMENT_CLOSED' } })).toBe(2);

    // a voided payment does not count as paid
    const o = c.users.OWNER.token;
    const v = (await create(o, c, { totalCost: 5_000, plannedSessions: 1, doctorId: c.docOwner }).expect(201)).body;
    const paid = (await pay(o, v.id, { amount: 5_000 }).expect(201)).body;
    await complete(o, v.id, 1).expect(200);
    await http().post(`/payments/${paid.payments[0].id}/void`).set(bearer(o)).send({ reason: 'غلط' }).expect(200);
    await close(o, v.id).expect(409);
  });

  it('who can press close: owner and the treating doctor; not a secretary, not another doctor, not another clinic, not a cancelled treatment', async () => {
    const c = await makeClinic('closewho');
    const other = await makeClinic('closewho2');
    const mk = async (doctorId: string) => {
      const t = (await create(c.users.OWNER.token, c, { totalCost: 0, plannedSessions: 1, doctorId }).expect(201)).body;
      await complete(c.users.OWNER.token, t.id, 1).expect(200);
      return t;
    };
    const mine = await mk(c.doc1);
    await close(c.users.SECRETARY.token, mine.id).expect(403);
    await close(c.users.KEYHOLDER.token, mine.id).expect(403); // the payments key does not give this
    await close(other.users.OWNER.token, mine.id).expect(404);
    const theirs = await mk(c.doc2);
    await close(c.users.DOCTOR.token, theirs.id).expect(404); // not his treatment
    expect((await close(c.users.DOCTOR.token, mine.id).expect(200)).body.status).toBe('CLOSED');
    expect((await close(c.users.OWNER.token, theirs.id).expect(200)).body.status).toBe('CLOSED'); // free treatment, all done
    const cancelled = (await create(c.users.OWNER.token, c, { totalCost: 0, plannedSessions: 1, doctorId: c.docOwner }).expect(201)).body;
    await http().post(`/treatments/${cancelled.id}/cancel`).set(bearer(c.users.OWNER.token)).send({}).expect(200);
    await close(c.users.OWNER.token, cancelled.id).expect(409);
    await close(c.users.OWNER.token, randomUUID()).expect(404);
    await close('bad', mine.id).expect(401);
  });

  it('sessions: notes are kept, a session finishes once, unknown numbers are 404', async () => {
    const c = await makeClinic('sessions');
    const t = (await create(c.users.OWNER.token, c, { plannedSessions: 3 }).expect(201)).body;
    const o = c.users.OWNER.token;
    const res = await http().post(`/treatments/${t.id}/sessions/2/complete`).set(bearer(o)).send({ notes: 'تم الحشو' }).expect(200);
    expect(res.body.sessions[1]).toMatchObject({ number: 2, status: 'COMPLETED', notes: 'تم الحشو' });
    await complete(o, t.id, 2).expect(409);
    await complete(o, t.id, 9).expect(404);
    await http().post(`/treatments/${t.id}/sessions/abc/complete`).set(bearer(o)).send({}).expect(400);
    await http().post(`/treatments/${t.id}/sessions/1/complete`).set(bearer(o)).send({ status: 'x' }).expect(400);
  });

  // ---------------------------------------------------------------- editing
  it('editing: cost can never go below what was paid; sessions can grow, and shrink only while still planned; teeth replaced', async () => {
    const c = await makeClinic('edit');
    const o = c.users.OWNER.token;
    const t = (await create(o, c, { totalCost: 50_000, plannedSessions: 3 }).expect(201)).body;
    await pay(o, t.id, { amount: 30_000 }).expect(201);
    const patch = (b: Record<string, unknown>) => http().patch(`/treatments/${t.id}`).set(bearer(o)).send(b);

    await patch({ totalCost: 29_999 }).expect(400);
    const cheaper = await patch({ totalCost: 30_000 }).expect(200);
    expect(cheaper.body).toMatchObject({ totalCost: 30_000, remaining: 0 });

    await patch({ plannedSessions: 5 }).expect(200);
    expect((await prisma.session.count({ where: { treatmentId: t.id } }))).toBe(5);
    await complete(o, t.id, 4).expect(200);
    await patch({ plannedSessions: 3 }).expect(400); // session 4 is already done
    await patch({ plannedSessions: 4 }).expect(200); // session 5 was still planned: it goes
    expect(await prisma.session.count({ where: { treatmentId: t.id } })).toBe(4);

    const swapped = await patch({ teeth: [26, 27].map((toothCode) => ({ toothCode, treatmentTypeId: c.type })), description: 'عصب' }).expect(200);
    expect(swapped.body).toMatchObject({ toothCodes: [26, 27], description: 'عصب' });
    expect(await prisma.treatmentTooth.count({ where: { treatmentId: t.id } })).toBe(2);
    expect((await patch({ description: '' }).expect(200)).body.description).toBeNull();
    const type2 = await prisma.treatmentType.create({ data: { clinicId: c.id, name: 'تنظيف' } });
    const retyped = await patch({ teeth: [{ toothCode: 26, treatmentTypeId: type2.id }, { toothCode: 27, treatmentTypeId: c.type }] }).expect(200);
    expect(retyped.body.teeth.map((x: { toothCode: number; treatmentType: { name: string } }) => [x.toothCode, x.treatmentType.name])).toEqual([[26, 'تنظيف'], [27, 'حشوة']]);

    for (const bad of [{}, { status: 'CLOSED' }, { patientId: randomUUID() }, { doctorId: c.doc1 }, { toothCodes: [26] }, { treatmentTypeId: c.type }, { teeth: [] }, { totalCost: 1.5 }, { plannedSessions: 0 }]) await patch(bad).expect(400);
    await patch({ teeth: [{ toothCode: 26, treatmentTypeId: randomUUID() }] }).expect(404);
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: 'TREATMENT_UPDATED', entityId: t.id } })).toBeGreaterThanOrEqual(4);
  });

  it('lowering the cost to what is already paid, with every session done, makes it ready to close but does not close it', async () => {
    const c = await makeClinic('editclose');
    const o = c.users.OWNER.token;
    const t = (await create(o, c, { totalCost: 50_000, plannedSessions: 1 }).expect(201)).body;
    await pay(o, t.id, { amount: 20_000 }).expect(201);
    await complete(o, t.id, 1).expect(200);
    const res = await http().patch(`/treatments/${t.id}`).set(bearer(o)).send({ totalCost: 20_000 }).expect(200);
    expect(res.body).toMatchObject({ status: 'OPEN', remaining: 0 });
    expect((await close(o, t.id).expect(200)).body.status).toBe('CLOSED');
  });

  // ---------------------------------------------------------------- voiding payments
  it('voiding: owner only, with a reason; the payment stays visible; the money is owed again and a closed treatment reopens', async () => {
    const c = await makeClinic('void');
    const o = c.users.OWNER.token;
    await prisma.user.update({ where: { id: c.users.DOCTOR.id }, data: { canManagePayments: true } });
    const t = (await create(o, c, { totalCost: 10_000, plannedSessions: 1 }).expect(201)).body;
    const paid = (await pay(o, t.id, { amount: 10_000 }).expect(201)).body;
    await complete(o, t.id, 1).expect(200);
    expect((await close(o, t.id).expect(200)).body.status).toBe('CLOSED');
    const paymentId = paid.payments[0].id;

    await http().post(`/payments/${paymentId}/void`).set(bearer(c.users.DOCTOR.token)).send({ reason: 'غلط بالمبلغ' }).expect(403); // even with the key
    await http().post(`/payments/${paymentId}/void`).set(bearer(c.users.KEYHOLDER.token)).send({ reason: 'غلط بالمبلغ' }).expect(403);
    await http().post(`/payments/${paymentId}/void`).set(bearer(o)).send({}).expect(400);
    await http().post(`/payments/${paymentId}/void`).set(bearer(o)).send({ reason: 'x' }).expect(400);
    await http().post(`/payments/${randomUUID()}/void`).set(bearer(o)).send({ reason: 'غلط بالمبلغ' }).expect(404);

    const res = await http().post(`/payments/${paymentId}/void`).set(bearer(o)).send({ reason: 'غلط بالمبلغ' }).expect(200);
    expect(res.body).toMatchObject({ status: 'OPEN', closedAt: null, paid: 0, remaining: 10_000 });
    expect(res.body.payments).toHaveLength(1); // never deleted
    expect(res.body.payments[0]).toMatchObject({ status: 'VOIDED', voidReason: 'غلط بالمبلغ' });
    expect(res.body.payments[0].voidedAt).toBeTruthy();
    const row = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(row).toMatchObject({ status: 'VOIDED', voidedByUserId: c.users.OWNER.id });
    await http().post(`/payments/${paymentId}/void`).set(bearer(o)).send({ reason: 'مرة ثانية' }).expect(409);
    const audit = await prisma.auditLog.findFirst({ where: { clinicId: c.id, action: 'PAYMENT_VOIDED', entityId: paymentId } });
    expect(audit).toBeTruthy();

    // the same money can be paid again, and a voided payment does not count
    expect((await pay(o, t.id, { amount: 10_000 }).expect(201)).body).toMatchObject({ status: 'OPEN', paid: 10_000 });
    expect((await close(o, t.id).expect(200)).body.status).toBe('CLOSED');
    expect(await prisma.payment.count({ where: { treatmentId: t.id } })).toBe(2);
  });

  it('even the database refuses to delete a payment', async () => {
    const c = await makeClinic('nodelete');
    const t = (await create(c.users.OWNER.token, c).expect(201)).body;
    const p = (await pay(c.users.OWNER.token, t.id).expect(201)).body.payments[0];
    expect(await prisma.payment.count({ where: { id: p.id } })).toBe(1);
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.TENANT_DATABASE_URL });
    const client = await pool.connect();
    let refused = false;
    try {
      await client.query(`SELECT set_config('app.clinic_id', $1, false)`, [c.id]);
      await client.query('DELETE FROM "Payment" WHERE id = $1', [p.id]);
    } catch {
      refused = true;
    } finally {
      client.release(true); // throw the connection away: it carried a clinic setting
      await pool.end();
    }
    expect(refused).toBe(true);
    expect(await prisma.payment.count({ where: { id: p.id } })).toBe(1);
  });

  // ---------------------------------------------------------------- cancel
  it('cancelling: only an open treatment with no active payments; voided payments do not block it', async () => {
    const c = await makeClinic('cancel');
    const o = c.users.OWNER.token;
    const t = (await create(o, c).expect(201)).body;
    const p = (await pay(o, t.id).expect(201)).body.payments[0];
    await http().post(`/treatments/${t.id}/cancel`).set(bearer(o)).send({}).expect(409);
    await http().post(`/payments/${p.id}/void`).set(bearer(o)).send({ reason: 'ما دفع' }).expect(200);
    const res = await http().post(`/treatments/${t.id}/cancel`).set(bearer(o)).send({ reason: 'غيّر رأيه' }).expect(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.closedAt).toBeTruthy();
    await http().post(`/treatments/${t.id}/cancel`).set(bearer(o)).send({}).expect(409);
    await http().patch(`/treatments/${t.id}`).set(bearer(o)).send({ description: 'x' }).expect(409);
    await complete(o, t.id, 1).expect(409);
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: 'TREATMENT_CANCELLED', entityId: t.id } })).toBe(1);
  });

  // ---------------------------------------------------------------- patient money summary
  it('patient summary: total, paid, remaining over live treatments; cancelled ones and voided payments do not count', async () => {
    const c = await makeClinic('finance');
    const o = c.users.OWNER.token;
    const a = (await create(o, c, { totalCost: 30_000 }).expect(201)).body;
    const b = (await create(o, c, { totalCost: 20_000 }).expect(201)).body;
    const gone = (await create(o, c, { totalCost: 99_000 }).expect(201)).body;
    await http().post(`/treatments/${gone.id}/cancel`).set(bearer(o)).send({}).expect(200);
    await pay(o, a.id, { amount: 10_000 }).expect(201);
    const wrong = (await pay(o, b.id, { amount: 5_000 }).expect(201)).body.payments[0];
    await http().post(`/payments/${wrong.id}/void`).set(bearer(o)).send({ reason: 'غلط' }).expect(200);
    const res = await http().get(`/patients/${c.patient}/finance`).set(bearer(o)).expect(200);
    expect(res.body).toEqual({ treatments: 2, openTreatments: 2, total: 50_000, paid: 10_000, remaining: 40_000 });
    await http().get(`/patients/${randomUUID()}/finance`).set(bearer(o)).expect(404);
    await http().get('/patients/nope/finance').set(bearer(o)).expect(400);
  });

  // ---------------------------------------------------------------- isolation
  it("clinic B can neither see nor touch clinic A's treatments, payments or sessions", async () => {
    const a = await makeClinic('isoa');
    const b = await makeClinic('isob');
    const t = (await create(a.users.OWNER.token, a).expect(201)).body;
    const p = (await pay(a.users.OWNER.token, t.id).expect(201)).body.payments[0];
    const o = b.users.OWNER.token;

    expect((await http().get('/treatments').set(bearer(o)).expect(200)).body).toEqual([]);
    expect((await http().get(`/treatments?patientId=${a.patient}`).set(bearer(o)).expect(200)).body).toEqual([]);
    await http().get(`/treatments/${t.id}`).set(bearer(o)).expect(404);
    await http().patch(`/treatments/${t.id}`).set(bearer(o)).send({ totalCost: 1 }).expect(404);
    await complete(o, t.id, 1).expect(404);
    await pay(o, t.id).expect(404);
    await http().post(`/treatments/${t.id}/cancel`).set(bearer(o)).send({}).expect(404);
    await http().post(`/payments/${p.id}/void`).set(bearer(o)).send({ reason: 'اختراق' }).expect(404);
    await http().get(`/patients/${a.patient}/finance`).set(bearer(o)).expect(404);
    await create(o, b, { patientId: a.patient }).expect(404);
    await create(o, b, { treatmentTypeId: a.type }).expect(404);

    const row = await prisma.treatment.findUnique({ where: { id: t.id }, include: { payments: true, sessions: true } });
    expect(row).toMatchObject({ totalCost: 100_000, status: 'OPEN' });
    expect(row!.payments.every((x) => x.status === 'ACTIVE')).toBe(true);
    expect(row!.sessions.every((x) => x.status === 'PLANNED')).toBe(true);
  });

  // ---------------------------------------------------------------- sub-types
  it('sub-types: two levels, unique per parent; a type with sub-types cannot be used itself', async () => {
    const c = await makeClinic('subtypes');
    const o = c.users.OWNER.token;
    const mk = (body: Record<string, unknown>) => http().post('/treatment-types').set(bearer(o)).send(body);
    const crown = (await mk({ name: 'تلبيسة' }).expect(201)).body;
    const root = (await mk({ name: 'عصب' }).expect(201)).body;
    await mk({ name: 'تلبيسة' }).expect(409); // same top-level name
    const zirconia = (await mk({ name: 'زركون', parentId: crown.id }).expect(201)).body;
    expect(zirconia).toMatchObject({ parentId: crown.id, isActive: true });
    await mk({ name: 'زركون', parentId: crown.id }).expect(409); // same name under the same parent
    await mk({ name: 'زركون', parentId: root.id }).expect(201); // same name under another parent is fine
    await mk({ name: 'بورسلان', parentId: zirconia.id }).expect(400); // no third level
    await mk({ name: 'بورسلان', parentId: randomUUID() }).expect(404);
    const porcelain = (await mk({ name: 'بورسلان', parentId: crown.id }).expect(201)).body;
    await http().patch(`/treatment-types/${porcelain.id}`).set(bearer(o)).send({ name: 'زركون' }).expect(409);

    await create(o, c, { treatmentTypeId: crown.id, doctorId: c.docOwner }).expect(400); // must pick a sub-type
    const ok = await create(o, c, { treatmentTypeId: zirconia.id, doctorId: c.docOwner }).expect(201);
    expect(ok.body.teeth[0].treatmentType).toMatchObject({ name: 'زركون', parent: { id: crown.id, name: 'تلبيسة' } });
    // the sub-type rules are checked for each tooth separately
    await create(o, c, { teeth: [{ toothCode: 16, treatmentTypeId: zirconia.id }, { toothCode: 17, treatmentTypeId: crown.id }], doctorId: c.docOwner }).expect(400);

    await http().patch(`/treatment-types/${crown.id}`).set(bearer(o)).send({ isActive: false }).expect(200);
    await create(o, c, { treatmentTypeId: zirconia.id, doctorId: c.docOwner }).expect(400); // its parent is stopped
    await http().patch(`/treatment-types/${crown.id}`).set(bearer(o)).send({ isActive: true }).expect(200);
    for (const id of [zirconia.id, porcelain.id]) await http().patch(`/treatment-types/${id}`).set(bearer(o)).send({ isActive: false }).expect(200);
    await create(o, c, { treatmentTypeId: crown.id, doctorId: c.docOwner }).expect(201); // no active sub-types left: the type itself works
    const u = (await create(o, c, { treatmentTypeId: root.id, doctorId: c.docOwner }).expect(400)); // 'عصب' has an active sub-type
    expect(u.body).toBeTruthy();
    const other = await makeClinic('subtypes2');
    await http().post('/treatment-types').set(bearer(other.users.OWNER.token)).send({ name: 'x1', parentId: crown.id }).expect(404); // another clinic's type
  });


  // ---------------------------------------------------------------- one type per tooth
  it('each tooth has its own type while cost and sessions are shared by the whole treatment', async () => {
    const c = await makeClinic('perTooth');
    const o = c.users.OWNER.token;
    const extract = await prisma.treatmentType.create({ data: { clinicId: c.id, name: 'قلع' } });
    const root = await prisma.treatmentType.create({ data: { clinicId: c.id, name: 'عصب' } });
    const res = await create(o, c, {
      doctorId: c.docOwner,
      teeth: [{ toothCode: 36, treatmentTypeId: extract.id }, { toothCode: 16, treatmentTypeId: c.type }, { toothCode: 17, treatmentTypeId: root.id }],
      totalCost: 90_000,
      plannedSessions: 4,
    }).expect(201);
    expect(res.body.teeth.map((x: { toothCode: number; treatmentType: { name: string } }) => [x.toothCode, x.treatmentType.name])).toEqual([[16, 'حشوة'], [17, 'عصب'], [36, 'قلع']]);
    expect(res.body.toothCodes).toEqual([16, 17, 36]);
    expect(res.body).toMatchObject({ totalCost: 90_000, plannedSessions: 4, remaining: 90_000 });
    expect(res.body.sessions).toHaveLength(4); // one session plan for all the teeth, not one per tooth
    expect(await prisma.treatment.count({ where: { clinicId: c.id } })).toBe(1);

    // a stopped type refuses only when it is actually used, and nothing is half-saved
    await prisma.treatmentType.update({ where: { id: extract.id }, data: { isActive: false } });
    await create(o, c, { doctorId: c.docOwner, teeth: [{ toothCode: 16, treatmentTypeId: c.type }, { toothCode: 17, treatmentTypeId: extract.id }] }).expect(400);
    expect(await prisma.treatment.count({ where: { clinicId: c.id } })).toBe(1);
    // another clinic's type is refused for a single tooth too
    const other = await makeClinic('perTooth2');
    await create(o, c, { doctorId: c.docOwner, teeth: [{ toothCode: 16, treatmentTypeId: c.type }, { toothCode: 17, treatmentTypeId: other.type }] }).expect(404);
    // the same tooth twice, or a tooth without a type
    await create(o, c, { doctorId: c.docOwner, teeth: [{ toothCode: 16, treatmentTypeId: c.type }, { toothCode: 16, treatmentTypeId: root.id }] }).expect(400);
    await create(o, c, { doctorId: c.docOwner, teeth: [{ toothCode: 16 }] }).expect(400);
    expect(await prisma.treatmentTooth.count({ where: { clinicId: c.id } })).toBe(3);

    // editing replaces the teeth with their types and leaves money and sessions alone
    const patch = (b: Record<string, unknown>) => http().patch(`/treatments/${res.body.id}`).set(bearer(o)).send(b);
    const edited = await patch({ teeth: [{ toothCode: 16, treatmentTypeId: root.id }, { toothCode: 46, treatmentTypeId: c.type }] }).expect(200);
    expect(edited.body.teeth.map((x: { toothCode: number; treatmentType: { name: string } }) => [x.toothCode, x.treatmentType.name])).toEqual([[16, 'عصب'], [46, 'حشوة']]);
    expect(edited.body).toMatchObject({ totalCost: 90_000, plannedSessions: 4 });
    await patch({ teeth: [{ toothCode: 16, treatmentTypeId: extract.id }] }).expect(400); // stopped type
    expect((await prisma.treatmentTooth.findMany({ where: { treatmentId: res.body.id } })).map((x) => x.toothCode).sort()).toEqual([16, 46]);
  });

  // ---------------------------------------------------------------- booking the next session
  async function withHours(c: Clinic) {
    for (const d of [c.docOwner, c.doc1, c.doc2]) {
      await prisma.doctorWorkingPeriod.create({ data: { clinicId: c.id, doctorId: d, weekday: 1, startMinute: 540, endMinute: 780 } });
    }
  }
  const bookNext = (token: string, id: string, n: number, over: Record<string, unknown> = {}) =>
    http().post(`/treatments/${id}/sessions/${n}/appointment`).set(bearer(token)).send({ startsAt: at(monday, 540).toISOString(), durationMinutes: 30, ...over });

  it('the next session gets a real appointment tied to it; it cannot be booked twice; cancelling that appointment frees it', async () => {
    const c = await makeClinic('book');
    await withHours(c);
    const o = c.users.OWNER.token;
    const t = (await create(o, c, { plannedSessions: 2, doctorId: c.docOwner }).expect(201)).body;
    expect(t.sessions[0].appointment).toBeNull();

    const res = await bookNext(o, t.id, 1).expect(201);
    expect(res.body.sessions[0].appointment).toMatchObject({ status: 'PENDING' });
    expect(res.body.sessions[1].appointment).toBeNull();
    const apt = await prisma.appointment.findUnique({ where: { id: res.body.sessions[0].appointmentId } });
    expect(apt).toMatchObject({ patientId: c.patient, doctorId: c.docOwner, status: 'PENDING' });
    expect(apt!.startsAt.toISOString()).toBe(at(monday, 540).toISOString());
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: 'SESSION_BOOKED' } })).toBe(1);

    await bookNext(o, t.id, 1, { startsAt: at(monday, 600).toISOString() }).expect(409); // already has a live appointment
    expect(await prisma.appointment.count({ where: { clinicId: c.id } })).toBe(1); // and no stray appointment was left behind

    await http().post(`/appointments/${apt!.id}/cancel`).set(bearer(o)).send({ reason: 'المريض اعتذر' }).expect(200);
    const again = await bookNext(o, t.id, 1, { startsAt: at(monday, 600).toISOString() }).expect(201);
    expect(again.body.sessions[0].appointment.status).toBe('PENDING');
    expect(new Date(again.body.sessions[0].appointment.startsAt).toISOString()).toBe(at(monday, 600).toISOString());
  });

  it('booking a session follows every appointment rule, and the session is not linked when booking fails', async () => {
    const c = await makeClinic('bookrules');
    await withHours(c);
    const o = c.users.OWNER.token;
    const t = (await create(o, c, { plannedSessions: 3, doctorId: c.docOwner }).expect(201)).body;
    await bookNext(o, t.id, 1, { startsAt: at(monday, 900).toISOString() }).expect(400); // outside working hours
    await bookNext(o, t.id, 1, { startsAt: at(monday, 555).toISOString() }).expect(400); // not on the half hour
    await bookNext(o, t.id, 1, { durationMinutes: 45 }).expect(400);
    await bookNext(o, t.id, 1, { status: 'CONFIRMED' }).expect(400);
    await bookNext(o, t.id, 9).expect(404);
    expect((await prisma.session.findFirst({ where: { treatmentId: t.id, number: 1 } }))!.appointmentId).toBeNull();

    await bookNext(o, t.id, 1).expect(201);
    await http().post('/appointments').set(bearer(o)).send({ patientId: c.patient, doctorId: c.docOwner, startsAt: at(monday, 570).toISOString(), durationMinutes: 30 }).expect(201);
    await bookNext(o, t.id, 2, { startsAt: at(monday, 570).toISOString() }).expect(409); // the doctor is busy then
    expect((await prisma.session.findFirst({ where: { treatmentId: t.id, number: 2 } }))!.appointmentId).toBeNull();
    await complete(o, t.id, 3).expect(200);
    await bookNext(o, t.id, 3, { startsAt: at(monday, 630).toISOString() }).expect(409); // a finished session is not booked again
  });

  it('who can book a session: the doctor on their own time, a secretary only with the key, never on a closed or foreign treatment', async () => {
    const c = await makeClinic('bookwho');
    await withHours(c);
    const mine = (await create(c.users.DOCTOR.token, c, { plannedSessions: 3 }).expect(201)).body;
    await bookNext(c.users.DOCTOR.token, mine.id, 1).expect(201);
    await bookNext(c.users.DOCTOR.token, mine.id, 2, { doctorId: c.doc2, startsAt: at(monday, 600).toISOString() }).expect(403); // another doctor's time
    await bookNext(c.users.SECRETARY.token, mine.id, 2, { startsAt: at(monday, 600).toISOString() }).expect(403); // no key
    await bookNext(c.users.KEYHOLDER.token, mine.id, 2, { startsAt: at(monday, 600).toISOString() }).expect(201);
    const theirs = (await create(c.users.OWNER.token, c, { doctorId: c.doc2 }).expect(201)).body;
    await bookNext(c.users.DOCTOR.token, theirs.id, 1, { startsAt: at(monday, 660).toISOString() }).expect(404); // not his treatment

    const done = (await create(c.users.OWNER.token, c, { totalCost: 0, plannedSessions: 1, doctorId: c.docOwner }).expect(201)).body;
    await complete(c.users.OWNER.token, done.id, 1).expect(200);
    await close(c.users.OWNER.token, done.id).expect(200); // free + done + button = closed
    await bookNext(c.users.OWNER.token, done.id, 1, { startsAt: at(monday, 720).toISOString() }).expect(409);
    const admin = await prisma.user.create({ data: { username: `padmin2_${tag}`, passwordHash: 'x', fullName: 'A', role: 'PLATFORM_ADMIN' } });
    const adminToken = await app.get(TokenService).signAccess({ sub: admin.id, role: 'PLATFORM_ADMIN', clinicId: null, mcp: false });
    await bookNext(adminToken, mine.id, 1).expect(403);
    await bookNext('bad', mine.id, 1).expect(401);
    await prisma.user.delete({ where: { id: admin.id } });
  });

  it("clinic B cannot book into clinic A's treatment", async () => {
    const a = await makeClinic('bookisoa');
    const b = await makeClinic('bookisob');
    await withHours(a);
    const t = (await create(a.users.OWNER.token, a, { doctorId: a.docOwner }).expect(201)).body;
    await bookNext(b.users.OWNER.token, t.id, 1).expect(404);
    expect(await prisma.appointment.count({ where: { clinicId: { in: [a.id, b.id] } } })).toBe(0);
  });

  it('two people booking the same session at once: exactly one wins and no extra live appointment is left', async () => {
    const c = await makeClinic('bookrace');
    await withHours(c);
    const o = c.users.OWNER.token;
    const t = (await create(o, c, { plannedSessions: 1, doctorId: c.docOwner }).expect(201)).body;
    const res = await Promise.all([
      bookNext(o, t.id, 1, { startsAt: at(monday, 540).toISOString() }),
      bookNext(c.users.KEYHOLDER.token, t.id, 1, { startsAt: at(monday, 600).toISOString() }),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.appointment.count({ where: { clinicId: c.id, status: { not: 'CANCELLED' } } })).toBe(1);
    const s1 = await prisma.session.findFirst({ where: { treatmentId: t.id, number: 1 }, include: { appointment: true } });
    expect(s1!.appointment!.status).not.toBe('CANCELLED');
  });

  it('login tells the app whether the account holds the payments key', async () => {
    const c = await makeClinic('keyflag');
    for (const [key, expected] of [['KEYHOLDER', true], ['SECRETARY', false], ['OWNER', true]] as const) {
      const row = await prisma.user.findUniqueOrThrow({ where: { id: c.users[key].id } });
      const login = await http().post('/auth/login').send({ username: row.username, password: 'Test-Pass-12345' }).expect(200);
      expect(login.body.user.canManagePayments).toBe(expected);
    }
  });
});
