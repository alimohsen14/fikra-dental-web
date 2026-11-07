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
describe('Expenses (e2e)', () => {
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

  const cat = async (c: Clinic, name = 'كهرباء') => (await http().post('/expense-categories').set(bearer(c.users.OWNER.token)).send({ name }).expect(201)).body.id as string;
  const sup = async (c: Clinic, name = 'مختبر الأمل') => (await http().post('/suppliers').set(bearer(c.users.OWNER.token)).send({ name }).expect(201)).body.id as string;
  const spend = (c: Clinic, over: Record<string, unknown>) => http().post('/expenses').set(bearer(c.users.OWNER.token)).send({ incurredAt: now(), amount: 10_000, ...over });
  const summary = async (c: Clinic, period: string, date: string) => (await http().get(`/expenses/summary?period=${period}&date=${date}`).set(bearer(c.users.OWNER.token)).expect(200)).body;

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
    await prisma.expensePayment.deleteMany({ where: w });
    await prisma.expense.deleteMany({ where: w });
    await prisma.supplier.deleteMany({ where: w });
    await prisma.expenseCategory.deleteMany({ where: w });
    await prisma.payment.deleteMany({ where: w });
    await prisma.session.deleteMany({ where: w });
    await prisma.treatmentTooth.deleteMany({ where: w });
    await prisma.treatment.deleteMany({ where: w });
    await prisma.treatmentType.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: w });
    await prisma.patient.deleteMany({ where: w });
    await prisma.doctor.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  it('only the owner can reach any expense route', async () => {
    const c = await makeClinic('acl');
    for (const role of ['DOCTOR', 'SECRETARY'] as const) {
      const t = c.users[role].token;
      await http().get('/expenses').set(bearer(t)).expect(403);
      await http().get('/suppliers').set(bearer(t)).expect(403);
      await http().get('/expense-categories').set(bearer(t)).expect(403);
      await http().get(`/expenses/summary?period=day&date=${today()}`).set(bearer(t)).expect(403);
      await http().post('/expenses').set(bearer(t)).send({}).expect(403);
    }
    await http().get('/expenses').expect(401);
  });

  it('categories and suppliers: default list is idempotent, duplicate names refused', async () => {
    const c = await makeClinic('cats');
    const o = bearer(c.users.OWNER.token);
    const first = (await http().post('/expense-categories/defaults').set(o).expect(200)).body;
    const again = (await http().post('/expense-categories/defaults').set(o).expect(200)).body;
    expect(first.length).toBeGreaterThanOrEqual(9);
    expect(again).toHaveLength(first.length);
    await http().post('/expense-categories').set(o).send({ name: 'رواتب' }).expect(409);
    await cat(c, 'تنظيف');
    await http().post('/expense-categories').set(o).send({ name: 'تنظيف' }).expect(409);
    await sup(c, 'شركة س');
    await http().post('/suppliers').set(o).send({ name: 'شركة س' }).expect(409);
    await http().post('/suppliers').set(o).send({ name: 'x' }).expect(400);
  });

  it('a bill paid in full, on credit, or partly; debts per supplier', async () => {
    const c = await makeClinic('debt');
    const k = await cat(c);
    const s = await sup(c);
    const s2 = await sup(c, 'محل الجملة');
    const full = (await spend(c, { categoryId: k, supplierId: s, amount: 50_000 }).expect(201)).body;
    expect(full).toMatchObject({ paid: 50_000, remaining: 0 });
    const credit = (await spend(c, { categoryId: k, supplierId: s, amount: 30_000, paidAmount: 0 }).expect(201)).body;
    expect(credit).toMatchObject({ paid: 0, remaining: 30_000, payments: [] });
    await spend(c, { categoryId: k, supplierId: s2, amount: 20_000, paidAmount: 5_000 }).expect(201);
    await spend(c, { categoryId: k, amount: 4_000, paidAmount: 0 }).expect(201);
    const list = (await http().get('/suppliers').set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(list.suppliers.find((x: { id: string }) => x.id === s).owed).toBe(30_000);
    expect(list.suppliers.find((x: { id: string }) => x.id === s2).owed).toBe(15_000);
    expect(list.owedUnassigned).toBe(4_000);
    expect(list.owedTotal).toBe(49_000);
    expect(list.suppliers[0].id).toBe(s); // most owed first
    const unpaid = (await http().get('/expenses?unpaid=1').set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(unpaid).toHaveLength(3);
    const bySupplier = (await http().get(`/expenses?supplierId=${s2}`).set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(bySupplier).toHaveLength(1);
  });

  it('paying later: cannot pay more than remains; voiding a payment needs a reason and brings the debt back', async () => {
    const c = await makeClinic('pay');
    const o = bearer(c.users.OWNER.token);
    const e = (await spend(c, { categoryId: await cat(c), amount: 30_000, paidAmount: 0 }).expect(201)).body;
    const pay = (amount: number) => http().post(`/expenses/${e.id}/payments`).set(o).send({ amount, method: 'CASH', paidAt: now() });
    await pay(30_001).expect(400);
    const after = (await pay(10_000).expect(201)).body;
    expect(after).toMatchObject({ paid: 10_000, remaining: 20_000 });
    await pay(0).expect(400);
    await http().post(`/expenses/${e.id}/payments`).set(o).send({ amount: 1, method: 'CASH', paidAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(400);
    await http().post(`/expense-payments/${after.payments[0].id}/void`).set(o).send({}).expect(400);
    const voided = (await http().post(`/expense-payments/${after.payments[0].id}/void`).set(o).send({ reason: 'غلط' }).expect(200)).body;
    expect(voided).toMatchObject({ paid: 0, remaining: 30_000 });
    expect(voided.payments[0]).toMatchObject({ status: 'VOIDED', voidReason: 'غلط' });
    await http().post(`/expense-payments/${after.payments[0].id}/void`).set(o).send({ reason: 'مرة ثانية' }).expect(409);
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: { startsWith: 'EXPENSE' } } })).toBe(3);
  });

  it('voiding a bill voids its payments, removes the debt, and stops further payments or edits', async () => {
    const c = await makeClinic('void');
    const o = bearer(c.users.OWNER.token);
    const s = await sup(c);
    const e = (await spend(c, { categoryId: await cat(c), supplierId: s, amount: 20_000, paidAmount: 8_000 }).expect(201)).body;
    await http().post(`/expenses/${e.id}/void`).set(o).send({}).expect(400);
    const v = (await http().post(`/expenses/${e.id}/void`).set(o).send({ reason: 'مكرر' }).expect(200)).body;
    expect(v).toMatchObject({ status: 'VOIDED', paid: 0, remaining: 0, voidReason: 'مكرر' });
    expect(v.payments[0].status).toBe('VOIDED');
    await http().post(`/expenses/${e.id}/void`).set(o).send({ reason: 'مرة ثانية' }).expect(409);
    await http().post(`/expenses/${e.id}/payments`).set(o).send({ amount: 1, method: 'CASH', paidAt: now() }).expect(409);
    await http().patch(`/expenses/${e.id}`).set(o).send({ description: 'x' }).expect(409);
    expect((await http().get('/suppliers').set(o).expect(200)).body.owedTotal).toBe(0);
    expect((await summary(c, 'day', today())).expensesPaid).toBe(0);
  });

  it('editing: amount cannot go below what was paid; bad input refused', async () => {
    const c = await makeClinic('edit');
    const o = bearer(c.users.OWNER.token);
    const k = await cat(c);
    const e = (await spend(c, { categoryId: k, amount: 20_000, paidAmount: 12_000 }).expect(201)).body;
    await http().patch(`/expenses/${e.id}`).set(o).send({ amount: 11_000 }).expect(400);
    const ok = (await http().patch(`/expenses/${e.id}`).set(o).send({ amount: 15_000, description: 'فاتورة' }).expect(200)).body;
    expect(ok).toMatchObject({ amount: 15_000, remaining: 3_000, description: 'فاتورة' });
    await spend(c, { categoryId: k, amount: 0 }).expect(400);
    await spend(c, { categoryId: k, amount: 100, paidAmount: 101 }).expect(400);
    await spend(c, { categoryId: k, amount: 100, incurredAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(400);
    await spend(c, { categoryId: randomUUID(), amount: 100 }).expect(404);
    await spend(c, { categoryId: k, amount: 100, extra: 1 }).expect(400);
    await http().patch(`/expense-categories/${k}`).set(o).send({ isActive: false }).expect(200);
    await spend(c, { categoryId: k, amount: 100 }).expect(400);
  });

  it('summary: income from patients minus what was paid out, per day/week/month/year, with categories', async () => {
    const c = await makeClinic('sum');
    const o = bearer(c.users.OWNER.token);
    const tr = (
      await http().post('/treatments').set(bearer(c.users.DOCTOR.token)).send({ patientId: c.patient, teeth: [{ toothCode: 16, treatmentTypeId: c.type }], totalCost: 100_000, plannedSessions: 1 }).expect(201)
    ).body;
    await http().post(`/treatments/${tr.id}/payments`).set(bearer(c.users.DOCTOR.token)).send({ amount: 40_000, method: 'CASH', paidAt: now() }).expect(201);
    const k1 = await cat(c, 'كهرباء');
    const k2 = await cat(c, 'مختبر');
    await spend(c, { categoryId: k1, amount: 10_000 }).expect(201);
    await spend(c, { categoryId: k2, amount: 6_000, paidAmount: 2_000 }).expect(201);
    for (const p of ['day', 'week', 'month', 'year']) {
      const s = await summary(c, p, today());
      expect(s).toMatchObject({ income: 40_000, incomeCount: 1, expensesPaid: 12_000, expensesIncurred: 16_000, profit: 28_000, owedNow: 4_000 });
      expect(s.from <= today() && today() <= s.to).toBe(true);
    }
    const day = await summary(c, 'day', today());
    expect(day.from).toBe(day.to);
    expect(day.byCategory.find((x: { name: string }) => x.name === 'مختبر')).toMatchObject({ incurred: 6_000, paid: 2_000 });
    // a day without anything
    const empty = await summary(c, 'day', '2020-01-15');
    expect(empty).toMatchObject({ income: 0, expensesPaid: 0, profit: 0, byCategory: [] });
    // a later payment counts on the day it is paid, not the day of the bill
    const old = (await spend(c, { categoryId: k1, amount: 7_000, paidAmount: 0, incurredAt: '2020-01-15T09:00:00+02:00' }).expect(201)).body;
    await http().post(`/expenses/${old.id}/payments`).set(o).send({ amount: 7_000, method: 'CARD', paidAt: now() }).expect(201);
    expect((await summary(c, 'day', '2020-01-15')).expensesPaid).toBe(0);
    expect((await summary(c, 'day', '2020-01-15')).expensesIncurred).toBe(7_000);
    expect((await summary(c, 'day', today())).expensesPaid).toBe(19_000);
    // week starts on Saturday: 2026-11-07 is a Saturday
    const w = await summary(c, 'week', '2026-11-11');
    expect([w.from, w.to]).toEqual(['2026-11-07', '2026-11-13']);
    await http().get('/expenses/summary?period=decade&date=2026-11-07').set(o).expect(400);
    await http().get('/expenses/summary?period=day&date=nope').set(o).expect(400);
  });

  it('clinics never see each other’s expenses, suppliers or categories', async () => {
    const a = await makeClinic('isoa');
    const b = await makeClinic('isob');
    const ka = await cat(a);
    const sa = await sup(a);
    const e = (await spend(a, { categoryId: ka, supplierId: sa, amount: 9_000, paidAmount: 0 }).expect(201)).body;
    const ob = bearer(b.users.OWNER.token);
    expect((await http().get('/expenses').set(ob).expect(200)).body).toEqual([]);
    expect((await http().get('/suppliers').set(ob).expect(200)).body.suppliers).toEqual([]);
    expect((await http().get('/expense-categories').set(ob).expect(200)).body).toEqual([]);
    await http().get(`/expenses/${e.id}`).set(ob).expect(404);
    await http().post(`/expenses/${e.id}/void`).set(ob).send({ reason: 'اختبار' }).expect(404);
    await http().post(`/expenses/${e.id}/payments`).set(ob).send({ amount: 1, method: 'CASH', paidAt: now() }).expect(404);
    await spend(b, { categoryId: ka, amount: 100 }).expect(404);
    await spend(b, { categoryId: await cat(b), supplierId: sa, amount: 100 }).expect(404);
    expect((await summary(b, 'day', today())).owedNow).toBe(0);
  });
  it('months side by side: income, expenses paid, salaries paid and profit; owner only', async () => {
    const c = await makeClinic('months');
    const o = bearer(c.users.OWNER.token);
    const k = await cat(c);
    const tr = (await http().post('/treatments').set(bearer(c.users.DOCTOR.token)).send({ patientId: c.patient, teeth: [{ toothCode: 16, treatmentTypeId: c.type }], totalCost: 100_000, plannedSessions: 1 }).expect(201)).body;
    await http().post(`/treatments/${tr.id}/payments`).set(bearer(c.users.DOCTOR.token)).send({ amount: 40_000, method: 'CASH', paidAt: now() }).expect(201);
    await spend(c, { categoryId: k, amount: 10_000 }).expect(201);
    await spend(c, { categoryId: k, amount: 7_000, incurredAt: '2026-08-10T10:00:00+03:00' }).expect(201);
    await http().patch(`/salaries/staff/${c.users.DOCTOR.id}`).set(o).send({ monthlySalary: 300_000 }).expect(200);
    const entry = (await http().get(`/salaries?month=${today().slice(0, 7)}`).set(o).expect(200)).body.entries[0];
    await http().post(`/salaries/${entry.id}/payments`).set(o).send({ kind: 'ADVANCE', amount: 5_000, method: 'CASH', paidAt: now() }).expect(201);
    const list = (await http().get('/expenses/months').set(o).expect(200)).body;
    expect(list).toHaveLength(12);
    expect(list[11].month).toBe(today().slice(0, 7));
    expect(list[11]).toMatchObject({ income: 40_000, expensesPaid: 10_000, salariesPaid: 5_000, profit: 25_000 });
    expect(list.slice(0, 11).every((r: { income: number; profit: number }) => r.income === 0)).toBe(true);
    const three = (await http().get('/expenses/months?count=3').set(o).expect(200)).body;
    expect(three.map((r: { month: string }) => r.month)).toEqual([list[9].month, list[10].month, list[11].month]);
    const year = Number(today().slice(0, 4));
    const whole = (await http().get(`/expenses/months?year=${year}`).set(o).expect(200)).body;
    expect(whole.map((r: { month: string }) => r.month)).toEqual(Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`));
    expect(whole.find((r: { month: string }) => r.month === today().slice(0, 7))).toMatchObject({ income: 40_000, profit: 25_000 });
    expect((await http().get('/expenses/months?year=2020').set(o).expect(200)).body.every((r: { income: number; profit: number }) => r.income === 0 && r.profit === 0)).toBe(true);
    await http().get('/expenses/months?year=1999').set(o).expect(400);
    await http().get(`/expenses/months?year=${year}&count=5`).set(o).expect(400);
    await http().get('/expenses/months?count=1').set(o).expect(400);
    await http().get('/expenses/months?count=99').set(o).expect(400);
    await http().get('/expenses/months').set(bearer(c.users.DOCTOR.token)).expect(403);
    // another clinic sees nothing of it
    const other = await makeClinic('months2');
    expect((await http().get('/expenses/months').set(bearer(other.users.OWNER.token)).expect(200)).body[11]).toMatchObject({ income: 0, profit: 0 });
  });
});
