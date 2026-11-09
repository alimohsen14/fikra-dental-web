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
import { localDate } from '../src/scheduling/clinic-time.js';

// Real database. Creates its own clinics/users with random names and deletes them at the end.
describe('Doctor income (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const clinicIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const now = () => new Date().toISOString();
  const today = () => localDate(new Date(), 'Asia/Hebron');

  async function makeClinic(name: string) {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}` } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash('Test-Pass-12345');
    const users = {} as Record<'OWNER' | 'DOCTOR' | 'DOCTOR2' | 'SECRETARY', { id: string; token: string }>;
    const defs: [keyof typeof users, Role][] = [['OWNER', 'OWNER'], ['DOCTOR', 'DOCTOR'], ['DOCTOR2', 'DOCTOR'], ['SECRETARY', 'SECRETARY']];
    for (const [key, role] of defs) {
      const username = `${name}_${key}_${tag}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id, canManagePayments: true } });
      users[key] = { id: u.id, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }) };
    }
    const doc = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOCTOR.id, fullName: 'Doc' } });
    await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOCTOR2.id, fullName: 'Doc2' } });
    await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.OWNER.id, fullName: 'Owner Doc' } });
    const patient = await prisma.patient.create({ data: { clinicId: clinic.id, fullName: 'P', phone: '+970599000111' } });
    const type = await prisma.treatmentType.create({ data: { clinicId: clinic.id, name: 'حشوة' } });
    return { id: clinic.id, users, doc: doc.id, patient: patient.id, type: type.id };
  }
  type Clinic = Awaited<ReturnType<typeof makeClinic>>;

  const treat = async (c: Clinic, who: 'OWNER' | 'DOCTOR' | 'DOCTOR2') =>
    (await http().post('/treatments').set(bearer(c.users[who].token)).send({ patientId: c.patient, teeth: [{ toothCode: 16, treatmentTypeId: c.type }], totalCost: 900_000, plannedSessions: 1 }).expect(201)).body.id as string;
  const pay = (c: Clinic, treatmentId: string, amount: number, paidAt = now()) => http().post(`/treatments/${treatmentId}/payments`).set(bearer(c.users.OWNER.token)).send({ amount, method: 'CASH', paidAt }).expect(201);
  const mine = (token: string, period = 'day', date = today()) => http().get(`/my-income?period=${period}&date=${date}`).set(bearer(token));

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

  it('each doctor sees only what was paid on their own treatments', async () => {
    const c = await makeClinic('own');
    const t1 = await treat(c, 'DOCTOR');
    const t2 = await treat(c, 'DOCTOR2');
    await pay(c, t1, 30_000);
    await pay(c, t1, 20_000);
    await pay(c, t2, 70_000);
    const a = (await mine(c.users.DOCTOR.token).expect(200)).body;
    expect(a).toMatchObject({ income: 50_000, count: 2 });
    expect(a.payments.every((p: { treatmentId: string }) => p.treatmentId === t1)).toBe(true);
    expect((await mine(c.users.DOCTOR2.token).expect(200)).body).toMatchObject({ income: 70_000, count: 1 });
  });

  it('the owner never sees a doctor’s income: only their own, as a doctor', async () => {
    const c = await makeClinic('owner');
    await pay(c, await treat(c, 'DOCTOR'), 40_000);
    const own = await treat(c, 'OWNER');
    await pay(c, own, 15_000);
    const r = (await mine(c.users.OWNER.token).expect(200)).body;
    expect(r).toMatchObject({ income: 15_000, count: 1 });
    expect(r.payments[0].treatmentId).toBe(own);
    // there is no way to ask for another doctor
    const doc = await prisma.doctor.findFirstOrThrow({ where: { userId: c.users.DOCTOR.id } });
    await http().get(`/my-income?period=day&date=${today()}&doctorId=${doc.id}`).set(bearer(c.users.OWNER.token)).expect(400);
    await http().get(`/my-income/months?year=${today().slice(0, 4)}&doctorId=${doc.id}`).set(bearer(c.users.OWNER.token)).expect(400);
    // the clinic total (owner only) still adds everything up
    const total = (await http().get(`/expenses/summary?period=day&date=${today()}`).set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(total.income).toBe(55_000);
  });

  it('secretaries and doctor-less owners get nothing; anonymous refused', async () => {
    const c = await makeClinic('none');
    await mine(c.users.SECRETARY.token).expect(403);
    await http().get('/my-income?period=day&date=2026-01-01').expect(401);
    await prisma.doctor.deleteMany({ where: { userId: c.users.OWNER.id } });
    await mine(c.users.OWNER.token).expect(404);
  });

  it('voided payments do not count; periods and months follow the day the money was paid', async () => {
    const c = await makeClinic('periods');
    const t = await treat(c, 'DOCTOR');
    await pay(c, t, 10_000);
    await pay(c, t, 5_000, '2026-02-10T10:00:00+02:00');
    const wrong = (await pay(c, t, 7_000)).body;
    const id = wrong.payments.find((p: { amount: number }) => p.amount === 7_000).id;
    await http().post(`/payments/${id}/void`).set(bearer(c.users.OWNER.token)).send({ reason: 'غلط' }).expect(200);
    expect((await mine(c.users.DOCTOR.token, 'day').expect(200)).body.income).toBe(10_000);
    expect((await mine(c.users.DOCTOR.token, 'day', '2026-02-10').expect(200)).body).toMatchObject({ income: 5_000, from: '2026-02-10', to: '2026-02-10' });
    expect((await mine(c.users.DOCTOR.token, 'week', '2026-02-11').expect(200)).body).toMatchObject({ income: 5_000, from: '2026-02-07', to: '2026-02-13' });
    expect((await mine(c.users.DOCTOR.token, 'month', today()).expect(200)).body.income).toBe(10_000);
    const months = (await http().get('/my-income/months?year=2026').set(bearer(c.users.DOCTOR.token)).expect(200)).body;
    expect(months).toHaveLength(12);
    expect(months[1]).toEqual({ month: '2026-02', income: 5_000 });
    expect(months.find((m: { month: string }) => m.month === today().slice(0, 7)).income).toBe(10_000);
    await http().get('/my-income/months?year=1999').set(bearer(c.users.DOCTOR.token)).expect(400);
    await mine(c.users.DOCTOR.token, 'decade').expect(400);
    await mine(c.users.DOCTOR.token, 'day', 'nope').expect(400);
  });

  it('clinics never mix: another clinic’s doctor sees nothing of it', async () => {
    const a = await makeClinic('isoa');
    const b = await makeClinic('isob');
    await pay(a, await treat(a, 'DOCTOR'), 99_000);
    expect((await mine(b.users.DOCTOR.token).expect(200)).body).toMatchObject({ income: 0, count: 0 });
  });
});
