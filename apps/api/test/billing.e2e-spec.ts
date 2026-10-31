import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { TokenService } from '../src/auth/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

// Real database. Money is in agorot (100 shekels = 10000).
describe('Subscription billing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tenantPool = new pg.Pool({ connectionString: process.env.TENANT_DATABASE_URL });
  const tag = randomUUID().slice(0, 8);
  const clinicIds: string[] = [];
  let adminId: string;
  let adminToken: string;
  let ownerToken: string;
  const http = () => request(app.getHttpServer());
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);

  async function newClinic(name: string, subscription?: { months: number; price: number }) {
    const res = await asAdmin(
      http()
        .post('/admin/clinics')
        .send({
          name: `${name}-${tag}`,
          ...(subscription ? { subscription } : {}),
          owner: { fullName: `Dr ${name}`, username: `own_${name}_${tag}`.toLowerCase() },
        }),
    ).expect(201);
    clinicIds.push(res.body.clinic.id);
    return res.body.clinic.id as string;
  }
  const pay = (id: string, body: object) => asAdmin(http().post(`/admin/clinics/${id}/payments`).send(body));
  const billing = async (id: string) => (await asAdmin(http().get(`/admin/clinics/${id}/billing`)).expect(200)).body;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    const hash = await app.get(PasswordService).hash('Test-Pass-12345');
    const admin = await prisma.user.create({
      data: { username: `padmin_${tag}`, passwordHash: hash, fullName: 'Test Admin', role: 'PLATFORM_ADMIN' },
    });
    adminId = admin.id;
    adminToken = await app.get(TokenService).signAccess({ sub: admin.id, role: 'PLATFORM_ADMIN', clinicId: null, mcp: false });

    const clinic = await prisma.clinic.create({ data: { name: `plain-${tag}` } });
    clinicIds.push(clinic.id);
    const owner = await prisma.user.create({
      data: { username: `plainowner_${tag}`, passwordHash: hash, fullName: 'Plain', role: 'OWNER', clinicId: clinic.id },
    });
    ownerToken = await app.get(TokenService).signAccess({ sub: owner.id, role: 'OWNER', clinicId: clinic.id, mcp: false });
  }, 60_000);

  afterAll(async () => {
    await prisma.subscriptionPayment.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.subscriptionPeriod.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { actorUserId: adminId }] } });
    await prisma.doctor.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.user.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { username: { endsWith: `_${tag}` } }] } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await tenantPool.end();
    await app.close();
  });

  it('a billed clinic starts as unpaid: the term ends months from now and the price is recorded', async () => {
    const id = await newClinic('b1', { months: 12, price: 300000 });
    const b = await billing(id);
    expect(b.status).toBe('UNPAID');
    expect(b.totalPrice).toBe(300000);
    expect(b.totalRemaining).toBe(300000);
    expect(b.periods).toHaveLength(1);
    expect(b.periods[0].months).toBe(12);
    const ends = new Date(b.periods[0].endsAt).getTime();
    expect(ends).toBeGreaterThan(Date.now() + 360 * DAY);
    expect(ends).toBeLessThan(Date.now() + 370 * DAY);

    const detail = await asAdmin(http().get(`/admin/clinics/${id}`)).expect(200);
    expect(new Date(detail.body.subscriptionEndsAt).getTime()).toBe(ends);
    expect(detail.body.billing.status).toBe('UNPAID');
  });

  it('a clinic with no billed term has status NONE and cannot receive a payment', async () => {
    const id = await newClinic('b0');
    expect((await billing(id)).status).toBe('NONE');
    await pay(id, { amount: 100 }).expect(400);
  });

  it('installments: partial, then paid in full; paying more than is owed is refused', async () => {
    const id = await newClinic('b2', { months: 6, price: 100000 });
    const first = await pay(id, { amount: 40000, paidAt: iso(-3), note: 'دفعة أولى' }).expect(201);
    expect(first.body.status).toBe('PARTIAL');
    expect(first.body.totalPaid).toBe(40000);
    expect(first.body.totalRemaining).toBe(60000);
    expect(first.body.periods[0].payments[0].note).toBe('دفعة أولى');

    await pay(id, { amount: 60001 }).expect(400); // 1 agora too much
    const last = await pay(id, { amount: 60000 }).expect(201);
    expect(last.body.status).toBe('PAID');
    expect(last.body.totalRemaining).toBe(0);
    expect(last.body.periods[0].payments).toHaveLength(2);
    await pay(id, { amount: 1 }).expect(400); // nothing left to pay

    const detail = await asAdmin(http().get(`/admin/clinics/${id}`)).expect(200);
    expect(detail.body.billing.status).toBe('PAID');
  });

  it('refuses bad payment input', async () => {
    const id = await newClinic('b3', { months: 1, price: 50000 });
    for (const bad of [
      { amount: 0 },
      { amount: -5 },
      { amount: 10.5 },
      { amount: '100' },
      {},
      { amount: 100, paidAt: iso(2) }, // future
      { amount: 100, extra: 1 }, // unknown field
      { amount: 100, periodId: 'nope' },
    ]) {
      await pay(id, bad).expect(400);
    }
    await pay(id, { amount: 100, periodId: randomUUID() }).expect(404);
    expect((await billing(id)).totalPaid).toBe(0);
  });

  it('two payments at the same moment cannot both fit into the same remaining amount', async () => {
    const id = await newClinic('b4', { months: 1, price: 100 });
    const results = await Promise.all([pay(id, { amount: 70 }), pay(id, { amount: 70 })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect((await billing(id)).totalPaid).toBe(70);
  });

  it('a payment is never deleted: voiding it with a reason puts the money back on the balance', async () => {
    const id = await newClinic('b5', { months: 3, price: 90000 });
    const paid = await pay(id, { amount: 90000 }).expect(201);
    expect(paid.body.status).toBe('PAID');
    const paymentId = paid.body.periods[0].payments[0].id;

    const path = `/admin/clinics/${id}/payments/${paymentId}/void`;
    await asAdmin(http().post(path).send({})).expect(400); // reason is required
    const voided = await asAdmin(http().post(path).send({ reason: 'سُجلت بالغلط' })).expect(200);
    expect(voided.body.status).toBe('UNPAID');
    expect(voided.body.totalRemaining).toBe(90000);
    expect(voided.body.periods[0].payments[0]).toMatchObject({ id: paymentId, voided: true, voidReason: 'سُجلت بالغلط' });
    await asAdmin(http().post(path).send({ reason: 'again' })).expect(409);

    expect(await prisma.subscriptionPayment.count({ where: { id: paymentId } })).toBe(1); // still in the database
    await pay(id, { amount: 90000 }).expect(201); // the freed amount can be paid again
    await asAdmin(http().post(`/admin/clinics/${id}/payments/${randomUUID()}/void`).send({ reason: 'xx' })).expect(404);
    const other = await newClinic('b5o', { months: 1, price: 100 });
    await asAdmin(http().post(`/admin/clinics/${other}/payments/${paymentId}/void`).send({ reason: 'xx' })).expect(404);

    const actions = (await prisma.auditLog.findMany({ where: { clinicId: id }, orderBy: { createdAt: 'asc' } })).map((l) => l.action);
    expect(actions).toEqual([
      'CLINIC_CREATED',
      'SUBSCRIPTION_PAYMENT_ADDED',
      'SUBSCRIPTION_PAYMENT_VOIDED',
      'SUBSCRIPTION_PAYMENT_ADDED',
    ]);
  });

  it('renewing with a price opens a new term; without a price nothing is billed', async () => {
    const id = await newClinic('b6', { months: 12, price: 120000 });
    await pay(id, { amount: 120000 }).expect(201);

    await asAdmin(http().post(`/admin/clinics/${id}/renew`).send({ months: 1 })).expect(200); // free extension
    expect((await billing(id)).periods).toHaveLength(1);

    await asAdmin(http().post(`/admin/clinics/${id}/renew`).send({ months: 12, price: 150000 })).expect(200);
    const b = await billing(id);
    expect(b.periods).toHaveLength(2);
    expect(b.periods[0].price).toBe(150000); // newest first
    expect(b.periods[0].status).toBe('UNPAID');
    expect(b.periods[1].status).toBe('PAID');
    expect(b.totalPrice).toBe(270000);
    expect(b.totalRemaining).toBe(150000);
    expect(b.status).toBe('PARTIAL');
    // The new term starts where the old one ended.
    expect(new Date(b.periods[0].startsAt).getTime()).toBeGreaterThan(new Date(b.periods[1].endsAt).getTime() - 1000);

    // A payment goes to the latest term unless a term is named.
    const second = await pay(id, { amount: 50000 }).expect(201);
    expect(second.body.periods[0].paid).toBe(50000);
    expect(second.body.periods[1].paid).toBe(120000);
    const oldTerm = b.periods[1].id;
    await pay(id, { amount: 1, periodId: oldTerm }).expect(400); // that term is already fully paid
  });

  it('the list shows who still owes money, and the "unpaid" filter finds them', async () => {
    const owes = await newClinic('u1', { months: 1, price: 10000 });
    const half = await newClinic('u2', { months: 1, price: 10000 });
    const done = await newClinic('u3', { months: 1, price: 10000 });
    await pay(half, { amount: 4000 }).expect(201);
    await pay(done, { amount: 10000 }).expect(201);

    const all = await asAdmin(http().get('/admin/clinics').query({ q: tag })).expect(200);
    const byName = (n: string) => all.body.items.find((i: any) => i.name === `${n}-${tag}`);
    expect(byName('u1').billing).toMatchObject({ status: 'UNPAID', totalRemaining: 10000 });
    expect(byName('u2').billing).toMatchObject({ status: 'PARTIAL', totalPaid: 4000, totalRemaining: 6000 });
    expect(byName('u3').billing).toMatchObject({ status: 'PAID', totalRemaining: 0 });

    const unpaid = await asAdmin(http().get('/admin/clinics').query({ filter: 'unpaid', q: `u` })).expect(200);
    const names = unpaid.body.items.map((i: any) => i.name).filter((n: string) => n.endsWith(tag));
    expect(names).toContain(`u1-${tag}`);
    expect(names).toContain(`u2-${tag}`);
    expect(names).not.toContain(`u3-${tag}`);
    expect(unpaid.body.summary.unpaid).toBeGreaterThanOrEqual(2);
    expect(owes).toBeDefined();
  });

  it('billing never blocks a clinic: only the end date does', async () => {
    const id = await newClinic('nb', { months: 12, price: 500000 }); // owes everything, paid nothing
    const detail = await asAdmin(http().get(`/admin/clinics/${id}`)).expect(200);
    expect(detail.body.state).toBe('ACTIVE');
    const login = await http().post('/auth/login').send({ username: `own_nb_${tag}`, password: 'wrong-password-123' });
    expect(login.status).toBe(401); // wrong password, but not 403: the clinic itself is not blocked
  });

  it('clinic users cannot reach the billing routes, and the clinic database role cannot read the tables', async () => {
    const id = clinicIds[0]!;
    await http().get(`/admin/clinics/${id}/billing`).set('Authorization', `Bearer ${ownerToken}`).expect(403);
    await http().post(`/admin/clinics/${id}/payments`).set('Authorization', `Bearer ${ownerToken}`).send({ amount: 1 }).expect(403);
    await http().post(`/admin/clinics/${id}/payments/${randomUUID()}/void`).set('Authorization', `Bearer ${ownerToken}`).send({ reason: 'xx' }).expect(403);
    await http().get(`/admin/clinics/${id}/billing`).expect(401);

    for (const sql of [
      `SELECT * FROM "SubscriptionPeriod"`,
      `SELECT * FROM "SubscriptionPayment"`,
      `INSERT INTO "SubscriptionPayment" ("id") VALUES (gen_random_uuid())`,
    ]) {
      await expect(tenantPool.query(sql)).rejects.toThrow(/permission denied/);
    }
  });
});
