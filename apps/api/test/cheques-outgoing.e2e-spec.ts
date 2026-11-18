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

// Real database. Creates its own clinics/users with random names and deletes them at the end.
describe('Paying bills with cheques (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const clinicIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hebron' });
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Hebron' });

  type Who = 'OWNER' | 'DOC' | 'KEYHOLDER' | 'SECRETARY';
  async function makeClinic(name: string) {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}` } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash('Test-Pass-12345');
    const users = {} as Record<Who, { id: string; token: string }>;
    const defs: [Who, Role, boolean][] = [['OWNER', 'OWNER', true], ['DOC', 'DOCTOR', true], ['KEYHOLDER', 'SECRETARY', true], ['SECRETARY', 'SECRETARY', false]];
    for (const [key, role, canManagePayments] of defs) {
      const username = `${name}_${key}_${tag}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id, canManagePayments } });
      users[key] = { id: u.id, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }) };
    }
    await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOC.id, fullName: 'Doc One' } });
    const patient = await prisma.patient.create({ data: { clinicId: clinic.id, fullName: `Patient ${name}`, phone: '+970599000111' } });
    const type = await prisma.treatmentType.create({ data: { clinicId: clinic.id, name: 'حشوة' } });
    const category = await prisma.expenseCategory.create({ data: { clinicId: clinic.id, name: 'مشتريات' } });
    const supplier = await prisma.supplier.create({ data: { clinicId: clinic.id, name: 'شركة المستلزمات' } });
    return { id: clinic.id, users, patient: patient.id, type: type.id, category: category.id, supplier: supplier.id };
  }
  type Clinic = Awaited<ReturnType<typeof makeClinic>>;

  const bill = async (c: Clinic, amount = 80_000) =>
    (await http().post('/expenses').set(bearer(c.users.OWNER.token)).send({ categoryId: c.category, supplierId: c.supplier, amount, incurredAt: new Date().toISOString(), paidAmount: 0 }).expect(201)).body.id as string;
  const getBill = async (c: Clinic, id: string) => (await http().get(`/expenses/${id}`).set(bearer(c.users.OWNER.token)).expect(200)).body;
  const issue = (c: Clinic, id: string, over: Record<string, unknown> = {}, who: Who = 'OWNER') =>
    http().post(`/expenses/${id}/cheques`).set(bearer(c.users[who].token)).send({ amount: 50_000, dueDate: inDays(30), ...over });
  const treat = async (c: Clinic, totalCost = 500_000) =>
    (await http().post('/treatments').set(bearer(c.users.DOC.token)).send({ patientId: c.patient, teeth: [{ toothCode: 16, treatmentTypeId: c.type }], totalCost, plannedSessions: 1 }).expect(201)).body.id as string;
  const patientCheque = async (c: Clinic, treatmentId: string, over: Record<string, unknown> = {}) =>
    (await http().post(`/treatments/${treatmentId}/cheques`).set(bearer(c.users.DOC.token)).send({ amount: 30_000, dueDate: inDays(7), ...over }).expect(201)).body;
  const summary = async (c: Clinic) => (await http().get(`/expenses/summary?period=day&date=${today()}`).set(bearer(c.users.OWNER.token)).expect(200)).body;
  const cheque = async (c: Clinic, id: string, who: Who = 'OWNER') => (await http().get(`/cheques/${id}`).set(bearer(c.users[who].token)).expect(200)).body;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    const w = { clinicId: { in: clinicIds } };
    await prisma.cheque.deleteMany({ where: w });
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
    await prisma.appointment.deleteMany({ where: w });
    await prisma.patient.deleteMany({ where: w });
    await prisma.doctorWorkingPeriod.deleteMany({ where: w });
    await prisma.doctor.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  it('a cheque we write pays the bill down at once and counts as an expense of the day it was written, marked as a cheque; its cash day is only information', async () => {
    const c = await makeClinic('out1');
    const e = await bill(c);
    const ch = (await issue(c, e, { chequeNumber: '٥٥٠١', bankName: 'بنك القدس', accountNumber: '9-9', notes: 'دفعة أولى' }).expect(201)).body;
    expect(ch).toMatchObject({ direction: 'OUTGOING', status: 'PENDING', amount: 50_000, dueDate: inDays(30), chequeNumber: '5501', incomplete: false, due: 'later', forBill: true });
    expect(ch.bill).toMatchObject({ id: e, category: 'مشتريات', supplier: { name: 'شركة المستلزمات' } });
    const b = await getBill(c, e);
    expect(b).toMatchObject({ paid: 50_000, remaining: 30_000 });
    expect(b.payments[0]).toMatchObject({ method: 'CHEQUE', amount: 50_000, status: 'ACTIVE' });
    expect(b.payments[0].cheques[0]).toMatchObject({ id: ch.id, direction: 'OUTGOING', status: 'PENDING' });
    const s = await summary(c);
    expect(s).toMatchObject({ expensesPaid: 50_000, expensesByCheque: 50_000, incomeByCheque: 0, profit: -50_000 }); // an expense today, not on the 30th

    // it only shows in the cheques box as "outgoing, not cashed yet"
    const list = (await http().get('/cheques').set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(list.outgoing).toMatchObject({ pending: { count: 1, amount: 50_000 } });
    expect(list.totals.pending.count).toBe(0); // not mixed with what patients gave us

    // cashing it changes nothing in the money figures (the expense was counted when written)
    expect((await http().post(`/cheques/${ch.id}/cash`).set(bearer(c.users.OWNER.token)).send({}).expect(200)).body.status).toBe('CASHED');
    expect(await summary(c)).toMatchObject({ expensesPaid: 50_000, profit: -50_000 });
    expect((await http().get('/cheques').set(bearer(c.users.OWNER.token)).expect(200)).body.outgoing).toMatchObject({ pending: { count: 0 }, cashed: { count: 1, amount: 50_000 } });
  });

  it('the rules of writing one: amount and cash day required, not above what is left, no duplicate, the owner only', async () => {
    const c = await makeClinic('out2');
    const e = await bill(c, 80_000);
    await issue(c, e, { amount: undefined }).expect(400);
    await issue(c, e, { dueDate: undefined }).expect(400);
    await issue(c, e, { amount: 80_001 }).expect(400);
    await issue(c, e, { dueDate: '2026-02-30' }).expect(400);
    await issue(c, e, {}, 'KEYHOLDER').expect(403);
    await issue(c, e, {}, 'DOC').expect(403);
    await issue(c, e, {}, 'SECRETARY').expect(403);
    await issue(c, randomUUID()).expect(404);
    await issue(c, e, { chequeNumber: '1', accountNumber: '2' }).expect(201);
    await issue(c, e, { chequeNumber: '1', accountNumber: '2', amount: 10_000 }).expect(409); // the same cheque twice
    await issue(c, e, { chequeNumber: '3', accountNumber: '2', amount: 30_001 }).expect(400); // only 30,000 left
    await issue(c, e, { chequeNumber: '3', accountNumber: '2', amount: 30_000 }).expect(201); // the bill is now fully paid
    await issue(c, e, { amount: 1 }).expect(400);
    // a voided bill takes none
    const e2 = await bill(c);
    await http().post(`/expenses/${e2}/void`).set(bearer(c.users.OWNER.token)).send({ reason: 'خطأ' }).expect(200);
    await issue(c, e2).expect(409);
  });

  it('it can be edited (not its amount) until it is cashed; cancelling it voids its payment and the bill is owed again', async () => {
    const c = await makeClinic('out3');
    const e = await bill(c);
    const ch = (await issue(c, e).expect(201)).body;
    const edited = (await http().patch(`/cheques/${ch.id}`).set(bearer(c.users.OWNER.token)).send({ dueDate: inDays(45), bankName: 'بنك فلسطين', notes: '' }).expect(200)).body;
    expect(edited).toMatchObject({ dueDate: inDays(45), bankName: 'بنك فلسطين', notes: null, amount: 50_000 });
    await http().patch(`/cheques/${ch.id}`).set(bearer(c.users.OWNER.token)).send({ amount: 60_000 }).expect(400);
    await http().post(`/cheques/${ch.id}/return`).set(bearer(c.users.OWNER.token)).send({}).expect(400); // ours are cancelled, not returned
    const done = (await http().post(`/cheques/${ch.id}/cancel`).set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(done.status).toBe('CANCELLED');
    expect(await getBill(c, e)).toMatchObject({ paid: 0, remaining: 80_000 });
    expect((await getBill(c, e)).payments[0]).toMatchObject({ status: 'VOIDED', voidReason: 'شك صادر مُلغى' });
    expect(await summary(c)).toMatchObject({ expensesPaid: 0 });
    await http().patch(`/cheques/${ch.id}`).set(bearer(c.users.OWNER.token)).send({ notes: 'x' }).expect(409);
    // a cashed one can no longer be changed or cancelled
    const ch2 = (await issue(c, e, { amount: 10_000 }).expect(201)).body;
    await http().post(`/cheques/${ch2.id}/cash`).set(bearer(c.users.OWNER.token)).send({}).expect(200);
    await http().patch(`/cheques/${ch2.id}`).set(bearer(c.users.OWNER.token)).send({ notes: 'x' }).expect(409);
    await http().post(`/cheques/${ch2.id}/cancel`).set(bearer(c.users.OWNER.token)).expect(409);
  });

  it('cheques patients gave us can be handed over to pay a bill: they leave "not cashed", count as income AND expense of the day (profit unchanged), and the patient still has paid', async () => {
    const c = await makeClinic('hand1');
    const t = await treat(c);
    const a = await patientCheque(c, t, { amount: 30_000 });
    const b = await patientCheque(c, t, { amount: 20_000 });
    const e = await bill(c, 60_000);
    expect((await http().get('/cheques').set(bearer(c.users.OWNER.token)).expect(200)).body.totals.pending).toMatchObject({ count: 2, amount: 50_000 });

    const r = (await http().post(`/expenses/${e}/hand-over-cheques`).set(bearer(c.users.OWNER.token)).send({ chequeIds: [a.id, b.id] }).expect(200)).body;
    expect(r).toMatchObject({ count: 2, total: 50_000 });
    expect(await getBill(c, e)).toMatchObject({ paid: 50_000, remaining: 10_000 });
    for (const x of [a, b]) expect(await cheque(c, x.id)).toMatchObject({ status: 'ENDORSED', forBill: true, bill: { id: e, supplier: { name: 'شركة المستلزمات' } } });
    // the outgoing tab also lists the incoming cheques handed over (owner only)
    const outTab = (await http().get('/cheques?direction=OUTGOING').set(bearer(c.users.OWNER.token)).expect(200)).body.items.map((x: { id: string }) => x.id);
    expect(outTab).toEqual(expect.arrayContaining([a.id, b.id]));
    const list = (await http().get('/cheques').set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(list.totals).toMatchObject({ pending: { count: 0, amount: 0 }, endorsed: { count: 2, amount: 50_000 } });
    const s = await summary(c);
    expect(s).toMatchObject({ income: 50_000, incomeByCheque: 50_000, expensesPaid: 50_000, expensesByCheque: 50_000, profit: 0 });
    // the patient paid and still has: nothing changes on his side; and the doctor's own income counts it
    const tr = (await http().get(`/treatments/${t}`).set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(tr).toMatchObject({ paid: 50_000, remaining: 450_000 });
    expect((await http().get(`/my-income?period=day&date=${today()}`).set(bearer(c.users.DOC.token)).expect(200)).body).toMatchObject({ income: 50_000 });

    // not again, not more than what is left, not incomplete ones, not someone else's
    await http().post(`/expenses/${e}/hand-over-cheques`).set(bearer(c.users.OWNER.token)).send({ chequeIds: [a.id] }).expect(409);
    const c3 = await patientCheque(c, t, { amount: 20_000 });
    await http().post(`/expenses/${e}/hand-over-cheques`).set(bearer(c.users.OWNER.token)).send({ chequeIds: [c3.id] }).expect(400); // 10,000 left
    const half = (await http().post(`/treatments/${t}/cheques`).set(bearer(c.users.DOC.token)).send({}).expect(201)).body;
    const e2 = await bill(c, 90_000);
    await http().post(`/expenses/${e2}/hand-over-cheques`).set(bearer(c.users.OWNER.token)).send({ chequeIds: [half.id] }).expect(409);
    await http().post(`/expenses/${e2}/hand-over-cheques`).set(bearer(c.users.OWNER.token)).send({ chequeIds: [] }).expect(400);
    await http().post(`/expenses/${e2}/hand-over-cheques`).set(bearer(c.users.OWNER.token)).send({ chequeIds: [randomUUID()] }).expect(409);
    const other = await makeClinic('hand1b');
    await http().post(`/expenses/${await bill(other)}/hand-over-cheques`).set(bearer(other.users.OWNER.token)).send({ chequeIds: [c3.id] }).expect(409); // another clinic's cheque
    await http().post(`/expenses/${e2}/hand-over-cheques`).set(bearer(c.users.KEYHOLDER.token)).send({ chequeIds: [c3.id] }).expect(403); // the owner only
    await http().post(`/expenses/${e2}/hand-over-cheques`).set(bearer(c.users.OWNER.token)).send({ chequeIds: [c3.id] }).expect(200);

    // voiding the bill payment gives the cheques back (in hand again, no longer income)
    const pay = (await getBill(c, e)).payments[0];
    await http().post(`/expense-payments/${pay.id}/void`).set(bearer(c.users.OWNER.token)).send({ reason: 'اختلاف مع المورد' }).expect(200);
    for (const x of [a, b]) expect(await cheque(c, x.id)).toMatchObject({ status: 'PENDING', forBill: false, bill: null });
    expect(await getBill(c, e)).toMatchObject({ paid: 0, remaining: 60_000 });
    expect(await summary(c)).toMatchObject({ income: 20_000, expensesPaid: 20_000 }); // only the other bill's hand-over is left
  });

  it('voiding a whole bill releases its cheques: ours are cancelled, the patients\' come back to hand', async () => {
    const c = await makeClinic('hand2');
    const t = await treat(c);
    const a = await patientCheque(c, t, { amount: 30_000 });
    const e = await bill(c, 100_000);
    await http().post(`/expenses/${e}/hand-over-cheques`).set(bearer(c.users.OWNER.token)).send({ chequeIds: [a.id] }).expect(200);
    const ours = (await issue(c, e, { amount: 40_000 }).expect(201)).body;
    await http().post(`/expenses/${e}/void`).set(bearer(c.users.OWNER.token)).send({ reason: 'فاتورة خاطئة' }).expect(200);
    expect(await cheque(c, a.id)).toMatchObject({ status: 'PENDING', bill: null });
    expect(await cheque(c, ours.id)).toMatchObject({ status: 'CANCELLED' });
    expect(await summary(c)).toMatchObject({ income: 0, expensesPaid: 0, profit: 0 });
  });

  it('bills are the owner\'s: nobody else ever sees outgoing cheques, even by asking for them', async () => {
    const c = await makeClinic('priv');
    const e = await bill(c);
    const ch = (await issue(c, e).expect(201)).body;
    const t = await treat(c);
    const mine = await patientCheque(c, t);
    for (const who of ['KEYHOLDER', 'DOC'] as const) {
      const all = (await http().get('/cheques').set(bearer(c.users[who].token)).expect(200)).body;
      expect(all.outgoing).toBeNull();
      expect(all.items.map((x: { id: string }) => x.id)).not.toContain(ch.id);
      expect((await http().get('/cheques?direction=OUTGOING').set(bearer(c.users[who].token)).expect(200)).body.items).toHaveLength(0);
      await http().get(`/cheques/${ch.id}`).set(bearer(c.users[who].token)).expect(404);
      await http().post(`/cheques/${ch.id}/cash`).set(bearer(c.users[who].token)).send({}).expect(404);
      await http().post(`/cheques/${ch.id}/cancel`).set(bearer(c.users[who].token)).expect(404);
      await http().get(`/cheques/${ch.id}/image`).set(bearer(c.users[who].token)).expect(404);
      expect((await http().get('/cheques/summary').set(bearer(c.users[who].token)).expect(200)).body.outgoing).toBeNull();
    }
    // after a hand-over the patient's cheque is still visible to them, but without the bill or the supplier
    await http().post(`/expenses/${await bill(c, 40_000)}/hand-over-cheques`).set(bearer(c.users.OWNER.token)).send({ chequeIds: [mine.id] }).expect(200);
    const seen = await cheque(c, mine.id, 'KEYHOLDER');
    expect(seen).toMatchObject({ status: 'ENDORSED', forBill: true, bill: null });
    expect(await cheque(c, mine.id, 'OWNER')).toMatchObject({ bill: { supplier: { name: 'شركة المستلزمات' } } });
  });

  it('same-day check: the list can be asked for the cheques that fall due on one day (to warn before writing another)', async () => {
    const c = await makeClinic('same');
    const e = await bill(c, 200_000);
    const d = inDays(20);
    await issue(c, e, { amount: 10_000, dueDate: d }).expect(201);
    await issue(c, e, { amount: 20_000, dueDate: d }).expect(201);
    await issue(c, e, { amount: 30_000, dueDate: inDays(21) }).expect(201);
    const q = (await http().get(`/cheques?direction=OUTGOING&status=PENDING&dueDate=${d}`).set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(q.items).toHaveLength(2);
    expect(q.items.reduce((t: number, x: { amount: number }) => t + x.amount, 0)).toBe(30_000);
    await http().get('/cheques?dueDate=soon').set(bearer(c.users.OWNER.token)).expect(400);
    // home reminders for the owner: ours due today are not cashed yet
    const e2 = await bill(c, 10_000);
    await issue(c, e2, { amount: 5_000, dueDate: today() }).expect(201);
    expect((await http().get('/cheques/summary').set(bearer(c.users.OWNER.token)).expect(200)).body.outgoing).toMatchObject({ dueToday: { count: 1, amount: 5_000 } });
  });
});
