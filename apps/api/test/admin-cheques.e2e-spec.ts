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
const dayOf = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// Real database. Money in agorot. Cheques a clinic pays its subscription with: incoming only, platform panel only.
describe('Subscription cheques (e2e)', () => {
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

  async function newClinic(name: string, price = 100_000) {
    const res = await asAdmin(
      http().post('/admin/clinics').send({ name: `${name}-${tag}`, subscription: { months: 12, price }, owner: { fullName: `Dr ${name}`, username: `own_${name}_${tag}`.toLowerCase() } }),
    ).expect(201);
    clinicIds.push(res.body.clinic.id);
    return res.body.clinic.id as string;
  }
  const pay = (id: string, body: object) => asAdmin(http().post(`/admin/clinics/${id}/payments`).send(body));
  const billing = async (id: string) => (await asAdmin(http().get(`/admin/clinics/${id}/billing`)).expect(200)).body;
  const cheque = async (id: string) => (await asAdmin(http().get(`/admin/cheques/${id}`)).expect(200)).body;
  const cash = async (query = '') => (await asAdmin(http().get(`/admin/cash${query}`)).expect(200)).body;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await app.get(PasswordService).hash('Test-Pass-12345');
    const admin = await prisma.user.create({ data: { username: `cadmin_${tag}`, passwordHash: hash, fullName: 'Test Admin', role: 'PLATFORM_ADMIN' } });
    adminId = admin.id;
    adminToken = await app.get(TokenService).signAccess({ sub: admin.id, role: 'PLATFORM_ADMIN', clinicId: null, mcp: false });
    const clinic = await prisma.clinic.create({ data: { name: `plain-${tag}` } });
    clinicIds.push(clinic.id);
    const owner = await prisma.user.create({ data: { username: `plainowner_${tag}`, passwordHash: hash, fullName: 'Plain', role: 'OWNER', clinicId: clinic.id } });
    ownerToken = await app.get(TokenService).signAccess({ sub: owner.id, role: 'OWNER', clinicId: clinic.id, mcp: false });
  }, 60_000);

  afterAll(async () => {
    await prisma.subscriptionCheque.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.subscriptionPayment.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.subscriptionPeriod.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { actorUserId: adminId }] } });
    await prisma.doctor.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.user.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { username: { endsWith: `_${tag}` } }] } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await tenantPool.end();
    await app.close();
  });

  it('a cheque payment lowers what the clinic owes at once, but is not cash until cashed', async () => {
    const c = await newClinic('chq1');
    const res = await pay(c, { amount: 40_000, method: 'CHEQUE', cheque: { dueDate: dayOf(10), chequeNumber: '٥٥٠١', bankName: 'بنك فلسطين', drawerName: 'Dr X', drawerPhone: '٠٥٩٩١٢٣٤٥٦' } }).expect(201);
    const id = res.body.createdChequeId as string;
    expect(id).toBeTruthy();
    expect(res.body.totalRemaining).toBe(60_000); // owed drops at once
    expect(res.body.periods[0].payments[0]).toMatchObject({ method: 'CHEQUE', cheque: { id, status: 'PENDING', chequeNumber: '5501' } });
    expect(await cheque(id)).toMatchObject({ status: 'PENDING', amount: 40_000, dueDate: dayOf(10), chequeNumber: '5501', drawerPhone: '0599123456', due: 'later', clinic: { id: c } });
    // not in the cash page yet
    expect((await cash(`?clinicId=${c}`)).total).toBe(0);
    // cashed -> becomes cash that day
    await asAdmin(http().post(`/admin/cheques/${id}/cash`)).expect(200);
    expect(await cheque(id)).toMatchObject({ status: 'CASHED' });
    const page = await cash(`?clinicId=${c}`);
    expect(page.total).toBe(40_000);
    expect(page.fromCheques).toBe(40_000);
    expect(page.items[0]).toMatchObject({ method: 'CHEQUE', fromCheque: true, amount: 40_000, chequeNumber: '5501' });
    await asAdmin(http().post(`/admin/cheques/${id}/cash`)).expect(409); // only once
    await asAdmin(http().post(`/admin/cheques/${id}/return`).send({ reason: 'x y' })).expect(409);
    await asAdmin(http().patch(`/admin/cheques/${id}`).send({ notes: 'late' })).expect(409);
  });

  it('cash payments are on the cash page by their paid day, separate from cheques', async () => {
    const c = await newClinic('chq2');
    await pay(c, { amount: 25_000 }).expect(201); // default method: cash
    await pay(c, { amount: 10_000, method: 'CASH' }).expect(201);
    await pay(c, { amount: 1_000, method: 'TRANSFER' }).expect(400); // only cash or cheque now
    const chq = await pay(c, { amount: 5_000, method: 'CHEQUE', cheque: { dueDate: dayOf(3) } }).expect(201);
    const page = await cash(`?clinicId=${c}`);
    expect(page.total).toBe(35_000);
    expect(page.fromCheques).toBe(0);
    expect(page.items.map((x: { method: string }) => x.method).sort()).toEqual(['CASH', 'CASH']);
    const list = (await asAdmin(http().get(`/admin/cheques?clinicId=${c}`)).expect(200)).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe(chq.body.createdChequeId);
    expect(list.totals.pending).toMatchObject({ amount: expect.any(Number), count: expect.any(Number) });
    // outside the range nothing is shown
    expect((await cash(`?clinicId=${c}&from=2020-01-01&to=2020-01-31`)).total).toBe(0);
  });

  it('a returned cheque voids its payment: the clinic owes the money again, and it is never cash', async () => {
    const c = await newClinic('chq3');
    const r = await pay(c, { amount: 30_000, method: 'CHEQUE', cheque: { dueDate: dayOf(-1) } }).expect(201);
    const id = r.body.createdChequeId as string;
    expect((await cheque(id)).due).toBe('overdue');
    await asAdmin(http().post(`/admin/cheques/${id}/return`).send({ reason: '' })).expect(400);
    await asAdmin(http().post(`/admin/cheques/${id}/return`).send({ reason: 'رصيد غير كاف' })).expect(200);
    expect(await cheque(id)).toMatchObject({ status: 'RETURNED', returnReason: 'رصيد غير كاف' });
    const b = await billing(c);
    expect(b.totalRemaining).toBe(100_000);
    expect(b.periods[0].payments[0]).toMatchObject({ voided: true });
    expect((await cash(`?clinicId=${c}`)).total).toBe(0);
  });

  it('voiding the payment of a cheque cancels the cheque; a cheque cannot exceed what is owed', async () => {
    const c = await newClinic('chq4', 20_000);
    await pay(c, { amount: 30_000, method: 'CHEQUE', cheque: { dueDate: dayOf(2) } }).expect(400);
    const r = await pay(c, { amount: 20_000, method: 'CHEQUE', cheque: { dueDate: dayOf(2) } }).expect(201);
    const id = r.body.createdChequeId as string;
    const paymentId = r.body.periods[0].payments[0].id as string;
    await asAdmin(http().post(`/admin/clinics/${c}/payments/${paymentId}/void`).send({ reason: 'غلط' })).expect(200);
    expect(await cheque(id)).toMatchObject({ status: 'CANCELLED' });
    expect((await cash(`?clinicId=${c}`)).total).toBe(0);
  });

  it('validates: cheque details only with method CHEQUE, due date required, edit while pending, photo', async () => {
    const c = await newClinic('chq5');
    await pay(c, { amount: 1_000, method: 'CHEQUE' }).expect(400); // no cheque details
    await pay(c, { amount: 1_000, method: 'CASH', cheque: { dueDate: dayOf(1) } }).expect(400);
    await pay(c, { amount: 1_000, method: 'CHEQUE', cheque: {} }).expect(400); // due date required
    const r = await pay(c, { amount: 1_000, method: 'CHEQUE', cheque: { dueDate: dayOf(1), chequeNumber: '1' } }).expect(201);
    const id = r.body.createdChequeId as string;
    await asAdmin(http().patch(`/admin/cheques/${id}`).send({ dueDate: dayOf(5), bankName: 'بنك القدس', chequeNumber: '' })).expect(200);
    expect(await cheque(id)).toMatchObject({ dueDate: dayOf(5), bankName: 'بنك القدس', chequeNumber: null });
    await asAdmin(http().post(`/admin/cheques/${id}/image`).set('Content-Type', 'application/octet-stream').send(Buffer.from('not an image'))).expect(415);
    await asAdmin(http().post(`/admin/cheques/${id}/image`).set('Content-Type', 'application/octet-stream').send(PNG)).expect(200);
    expect((await cheque(id)).hasImage).toBe(true);
    const img = await asAdmin(http().get(`/admin/cheques/${id}/image`)).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    await asAdmin(http().get(`/admin/cheques/${randomUUID()}`)).expect(404);
  });

  it('only the platform admin: clinic users get 403, and the restricted role cannot touch the table', async () => {
    for (const path of ['/admin/cheques', '/admin/cash']) await http().get(path).set('Authorization', `Bearer ${ownerToken}`).expect(403);
    await http().get('/admin/cheques').expect(401);
    const bad = [`SELECT * FROM "SubscriptionCheque"`, `INSERT INTO "SubscriptionCheque" ("id") VALUES (gen_random_uuid())`];
    for (const sql of bad) await expect(tenantPool.query(sql)).rejects.toThrow(/permission denied/);
  });

  it('search and status filters on the cheques list', async () => {
    const c = await newClinic('chq6');
    const a = await pay(c, { amount: 2_000, method: 'CHEQUE', cheque: { dueDate: dayOf(4), drawerName: `Zed${tag}`, chequeNumber: '90001' } }).expect(201);
    await asAdmin(http().post(`/admin/cheques/${a.body.createdChequeId}/cash`)).expect(200);
    const byName = (await asAdmin(http().get(`/admin/cheques?q=Zed${tag}`)).expect(200)).body;
    expect(byName.items).toHaveLength(1);
    expect((await asAdmin(http().get(`/admin/cheques?clinicId=${c}&status=PENDING`)).expect(200)).body.items).toHaveLength(0);
    expect((await asAdmin(http().get(`/admin/cheques?clinicId=${c}&status=CASHED`)).expect(200)).body.items).toHaveLength(1);
  });
});
