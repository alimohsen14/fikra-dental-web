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
describe('Salaries (e2e)', () => {
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
    const users = {} as Record<'OWNER' | 'DOCTOR' | 'SECRETARY', { id: string; token: string }>;
    const defs: [keyof typeof users, Role][] = [['OWNER', 'OWNER'], ['DOCTOR', 'DOCTOR'], ['SECRETARY', 'SECRETARY']];
    for (const [key, role] of defs) {
      const username = `${name}_${key}_${tag}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id, canManagePayments: true } });
      users[key] = { id: u.id, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }) };
    }
    const doc = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOCTOR.id, fullName: 'Doc' } });
    const patient = await prisma.patient.create({ data: { clinicId: clinic.id, fullName: 'P', phone: '+970599000111' } });
    const type = await prisma.treatmentType.create({ data: { clinicId: clinic.id, name: 'حشوة' } });
    return { id: clinic.id, users, doc: doc.id, patient: patient.id, type: type.id };
  }
  type Clinic = Awaited<ReturnType<typeof makeClinic>>;

  const month = () => today().slice(0, 7);
  const getMonth = async (c: Clinic, m = month()) => (await http().get(`/salaries?month=${m}`).set(bearer(c.users.OWNER.token)).expect(200)).body;
  const setSalary = (c: Clinic, userId: string, monthlySalary: number) => http().patch(`/salaries/staff/${userId}`).set(bearer(c.users.OWNER.token)).send({ monthlySalary });
  const entryOf = (m: { entries: { userId: string; id: string; baseAmount: number }[] }, userId: string) => m.entries.find((e) => e.userId === userId)!;
  const give = (c: Clinic, id: string, over: Record<string, unknown> = {}) => http().post(`/salaries/${id}/payments`).set(bearer(c.users.OWNER.token)).send({ kind: 'SALARY', amount: 10_000, method: 'CASH', paidAt: now(), ...over });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    const w = { clinicId: { in: clinicIds } };
    await prisma.salaryPayment.deleteMany({ where: w });
    await prisma.salaryEntry.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: w });
    await prisma.patient.deleteMany({ where: w });
    await prisma.doctor.deleteMany({ where: w });
    await prisma.treatmentType.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  it('only the owner can reach salaries', async () => {
    const c = await makeClinic('sacl');
    for (const role of ['DOCTOR', 'SECRETARY'] as const) {
      const t = bearer(c.users[role].token);
      await http().get(`/salaries?month=${month()}`).set(t).expect(403);
      await http().patch(`/salaries/staff/${c.users.DOCTOR.id}`).set(t).send({ monthlySalary: 1 }).expect(403);
      await http().post(`/salaries/${randomUUID()}/payments`).set(t).send({}).expect(403);
    }
    await http().get(`/salaries?month=${month()}`).expect(401);
  });

  it('a month lists every active employee with a salary; the owner and people without a salary are not in it', async () => {
    const c = await makeClinic('slist');
    expect((await getMonth(c)).entries).toEqual([]);
    await setSalary(c, c.users.DOCTOR.id, 300_000).expect(200);
    await setSalary(c, c.users.SECRETARY.id, 200_000).expect(200);
    const m = await getMonth(c);
    expect(m.entries).toHaveLength(2);
    expect(entryOf(m, c.users.DOCTOR.id)).toMatchObject({ baseAmount: 300_000, net: 300_000, remaining: 300_000, paid: 0, advances: 0 });
    expect(m.totals).toMatchObject({ net: 500_000, remaining: 500_000, paid: 0 });
    expect(m.staff.map((s: { id: string }) => s.id)).not.toContain(c.users.OWNER.id);
    await setSalary(c, c.users.OWNER.id, 100).expect(404);
    await setSalary(c, randomUUID(), 100).expect(404);
    expect((await getMonth(c)).entries).toHaveLength(2); // opening again does not duplicate
  });

  it('months that have not started, and months before the employee joined, are not generated', async () => {
    const c = await makeClinic('smonths');
    await setSalary(c, c.users.DOCTOR.id, 300_000).expect(200);
    await http().get('/salaries?month=2999-01').set(bearer(c.users.OWNER.token)).expect(400);
    await http().get('/salaries?month=2026-13').set(bearer(c.users.OWNER.token)).expect(400);
    expect((await getMonth(c, '2020-01')).entries).toEqual([]);
  });

  it('changing the salary affects only months opened later', async () => {
    const c = await makeClinic('sraise');
    await setSalary(c, c.users.DOCTOR.id, 300_000).expect(200);
    await getMonth(c);
    await setSalary(c, c.users.DOCTOR.id, 400_000).expect(200);
    expect(entryOf(await getMonth(c), c.users.DOCTOR.id).baseAmount).toBe(300_000);
    expect((await getMonth(c)).staff.find((s: { id: string }) => s.id === c.users.DOCTOR.id).monthlySalary).toBe(400_000);
    await setSalary(c, c.users.DOCTOR.id, -1).expect(400);
  });

  it('advances count against the same month: salary - advance = what is left; cannot give more than that', async () => {
    const c = await makeClinic('sadv');
    await setSalary(c, c.users.DOCTOR.id, 300_000).expect(200);
    const e = entryOf(await getMonth(c), c.users.DOCTOR.id);
    const adv = (await give(c, e.id, { kind: 'ADVANCE', amount: 50_000 }).expect(201)).body;
    expect(adv).toMatchObject({ advances: 50_000, paid: 50_000, remaining: 250_000 });
    await give(c, e.id, { amount: 250_001 }).expect(400);
    const done = (await give(c, e.id, { amount: 250_000 }).expect(201)).body;
    expect(done).toMatchObject({ paid: 300_000, remaining: 0, salaryPaid: 250_000, advances: 50_000 });
    await give(c, e.id, { kind: 'ADVANCE', amount: 1 }).expect(400);
    await give(c, e.id, { amount: 0 }).expect(400);
    await give(c, e.id, { paidAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(400);
    await give(c, randomUUID()).expect(404);
  });

  it('bonus or deduction for one month; cannot go below what was already given', async () => {
    const c = await makeClinic('sadj');
    await setSalary(c, c.users.DOCTOR.id, 300_000).expect(200);
    const e = entryOf(await getMonth(c), c.users.DOCTOR.id);
    const o = bearer(c.users.OWNER.token);
    const up = (await http().patch(`/salaries/${e.id}`).set(o).send({ adjustment: 20_000, adjustNote: 'مكافأة' }).expect(200)).body;
    expect(up).toMatchObject({ net: 320_000, remaining: 320_000, adjustNote: 'مكافأة' });
    await give(c, e.id, { amount: 200_000 }).expect(201);
    await http().patch(`/salaries/${e.id}`).set(o).send({ adjustment: -150_000 }).expect(400); // net 150k < 200k given
    await http().patch(`/salaries/${e.id}`).set(o).send({ adjustment: -300_001 }).expect(400); // negative net
    const down = (await http().patch(`/salaries/${e.id}`).set(o).send({ adjustment: -50_000 }).expect(200)).body;
    expect(down).toMatchObject({ net: 250_000, remaining: 50_000 });
    await http().patch(`/salaries/${e.id}`).set(o).send({}).expect(400);
  });

  it('voiding a payment needs a reason and gives the money back to the balance', async () => {
    const c = await makeClinic('svoid');
    await setSalary(c, c.users.DOCTOR.id, 300_000).expect(200);
    const e = entryOf(await getMonth(c), c.users.DOCTOR.id);
    const o = bearer(c.users.OWNER.token);
    const paid = (await give(c, e.id, { kind: 'ADVANCE', amount: 40_000 }).expect(201)).body;
    const pid = paid.payments[0].id;
    await http().post(`/salary-payments/${pid}/void`).set(o).send({}).expect(400);
    const v = (await http().post(`/salary-payments/${pid}/void`).set(o).send({ reason: 'غلط' }).expect(200)).body;
    expect(v).toMatchObject({ advances: 0, paid: 0, remaining: 300_000 });
    expect(v.payments[0]).toMatchObject({ status: 'VOIDED', voidReason: 'غلط' });
    await http().post(`/salary-payments/${pid}/void`).set(o).send({ reason: 'مرة ثانية' }).expect(409);
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: { startsWith: 'SALARY' } } })).toBe(3); // salary set, payment, void
  });

  it('a stopped employee leaves new months but keeps what was paid', async () => {
    const c = await makeClinic('sstop');
    await setSalary(c, c.users.DOCTOR.id, 300_000).expect(200);
    await setSalary(c, c.users.SECRETARY.id, 200_000).expect(200);
    const m = await getMonth(c);
    await give(c, entryOf(m, c.users.DOCTOR.id).id, { kind: 'ADVANCE', amount: 10_000 }).expect(201);
    await prisma.user.update({ where: { id: c.users.DOCTOR.id }, data: { isActive: false } });
    await prisma.user.update({ where: { id: c.users.SECRETARY.id }, data: { isActive: false } });
    const after = await getMonth(c);
    expect(after.entries.map((e: { userId: string }) => e.userId)).toEqual([c.users.DOCTOR.id]); // the one with payments stays
    expect(after.staff).toEqual([]);
  });

  it('salaries and advances are paid expenses: they lower the profit and appear in the summary', async () => {
    const c = await makeClinic('ssum');
    const o = bearer(c.users.OWNER.token);
    await setSalary(c, c.users.DOCTOR.id, 300_000).expect(200);
    const e = entryOf(await getMonth(c), c.users.DOCTOR.id);
    await give(c, e.id, { kind: 'ADVANCE', amount: 50_000 }).expect(201);
    const second = (await give(c, e.id, { amount: 100_000 }).expect(201)).body;
    const s = (await http().get(`/expenses/summary?period=day&date=${today()}`).set(o).expect(200)).body;
    expect(s).toMatchObject({ expensesPaid: 150_000, profit: -150_000 });
    expect(s.byCategory.find((x: { categoryId: string }) => x.categoryId === 'salaries')).toMatchObject({ name: 'رواتب وسلف', paid: 150_000 });
    await http().post(`/salary-payments/${second.payments[1].id}/void`).set(o).send({ reason: 'غلط' }).expect(200);
    expect((await http().get(`/expenses/summary?period=day&date=${today()}`).set(o).expect(200)).body.expensesPaid).toBe(50_000);
  });

  it('clinics never see each other’s salaries', async () => {
    const a = await makeClinic('siso1');
    const b = await makeClinic('siso2');
    await setSalary(a, a.users.DOCTOR.id, 300_000).expect(200);
    const e = entryOf(await getMonth(a), a.users.DOCTOR.id);
    const ob = bearer(b.users.OWNER.token);
    expect((await getMonth(b)).entries).toEqual([]);
    await http().patch(`/salaries/staff/${a.users.DOCTOR.id}`).set(ob).send({ monthlySalary: 1 }).expect(404);
    await http().patch(`/salaries/${e.id}`).set(ob).send({ adjustment: 5 }).expect(404);
    await http().post(`/salaries/${e.id}/payments`).set(ob).send({ kind: 'SALARY', amount: 1, method: 'CASH', paidAt: now() }).expect(404);
    expect((await getMonth(a)).entries[0].paid).toBe(0);
  });
});
