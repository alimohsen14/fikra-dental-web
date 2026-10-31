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

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (d: number) => new Date(Date.now() + d * DAY);

// Real database. Creates its own clinics/users with random names and deletes them at the end.
describe('Platform admin panel (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const password = 'Test-Pass-12345';
  const clinicIds: string[] = [];
  let adminId: string;
  let adminToken: string;
  let ownerToken: string; // a normal clinic owner: must never reach /admin
  const http = () => request(app.getHttpServer());
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);
  const login = (username: string, pw = password) => http().post('/auth/login').send({ username, password: pw });

  // Creates a clinic through the real endpoint. Returns the id, the owner username and the temp password.
  async function createViaApi(name: string, extra: Record<string, unknown> = {}) {
    const username = `own_${name}_${tag}`.toLowerCase();
    const res = await asAdmin(
      http()
        .post('/admin/clinics')
        .send({ name: `${name}-${tag}`, owner: { fullName: `Dr ${name}`, username }, ...extra }),
    ).expect(201);
    clinicIds.push(res.body.clinic.id);
    return { id: res.body.clinic.id as string, username, temp: res.body.temporaryPassword as string, body: res.body };
  }

  // A clinic created straight in the DB with the given subscription end, for list/filter tests.
  async function makeClinic(name: string, endsAt: Date | null, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}`, subscriptionEndsAt: endsAt, status } });
    clinicIds.push(clinic.id);
    return clinic;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    const hash = await app.get(PasswordService).hash(password);
    const admin = await prisma.user.create({
      data: { username: `padmin_${tag}`, passwordHash: hash, fullName: 'Test Admin', role: 'PLATFORM_ADMIN' },
    });
    adminId = admin.id;
    adminToken = await app.get(TokenService).signAccess({ sub: admin.id, role: 'PLATFORM_ADMIN', clinicId: null, mcp: false });

    const clinic = await makeClinic('plain', daysFromNow(30));
    const owner = await prisma.user.create({
      data: { username: `plainowner_${tag}`, passwordHash: hash, fullName: 'Plain', role: 'OWNER', clinicId: clinic.id },
    });
    ownerToken = await app.get(TokenService).signAccess({ sub: owner.id, role: 'OWNER', clinicId: clinic.id, mcp: false });
  }, 60_000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { actorUserId: adminId }] } });
    await prisma.doctor.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.user.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { username: { endsWith: `_${tag}` } }] } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  it('only the platform admin gets in: no token = 401, clinic users = 403 on every route', async () => {
    const id = clinicIds[0]!;
    const routes: [string, string][] = [
      ['get', '/admin/clinics'],
      ['get', `/admin/clinics/${id}`],
      ['post', '/admin/clinics'],
      ['post', `/admin/clinics/${id}/suspend`],
      ['post', `/admin/clinics/${id}/activate`],
      ['post', `/admin/clinics/${id}/renew`],
      ['post', `/admin/clinics/${id}/reset-owner-password`],
      ['get', '/admin/audit'],
    ];
    for (const [method, path] of routes) {
      await (http() as any)[method](path).expect(401);
      await (http() as any)[method](path).set('Authorization', `Bearer ${ownerToken}`).send({}).expect(403);
    }
  });

  it('creates a clinic: owner login with a temporary password, owner is also a doctor, shown once', async () => {
    const c = await createViaApi('create', { themeColor: '#0b5d57', subscriptionEndsAt: daysFromNow(30).toISOString() });
    expect(c.temp.length).toBeGreaterThanOrEqual(12);

    const res = await login(c.username, c.temp).expect(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.user.role).toBe('OWNER');
    expect(res.body.user.clinicId).toBe(c.id);

    const owner = await prisma.user.findUnique({ where: { username: c.username } });
    expect(owner!.canManagePayments).toBe(true);
    expect(owner!.temporaryPasswordExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(owner!.passwordHash).not.toContain(c.temp);
    const doctor = await prisma.doctor.findUnique({ where: { userId: owner!.id } });
    expect(doctor!.clinicId).toBe(c.id);

    // The password is never readable again, and never written to the audit log.
    const detail = await asAdmin(http().get(`/admin/clinics/${c.id}`)).expect(200);
    expect(JSON.stringify(detail.body)).not.toContain(c.temp);
    expect(JSON.stringify(detail.body)).not.toContain('passwordHash');
    const logs = await prisma.auditLog.findMany({ where: { clinicId: c.id } });
    expect(logs.map((l) => l.action)).toEqual(['CLINIC_CREATED']);
    expect(JSON.stringify(logs)).not.toContain(c.temp);
  });

  it('rejects a taken username, bad input, unknown fields and a past end date', async () => {
    const c = await createViaApi('dup');
    const body = (over: object) => ({ name: `x-${tag}`, owner: { fullName: 'Dr X', username: `ok_${tag}` }, ...over });
    await asAdmin(http().post('/admin/clinics').send(body({ owner: { fullName: 'Dr X', username: c.username } }))).expect(409);
    await asAdmin(http().post('/admin/clinics').send(body({ owner: { fullName: 'Dr X', username: 'Bad Name!' } }))).expect(400);
    await asAdmin(http().post('/admin/clinics').send(body({ status: 'ACTIVE' }))).expect(400);
    await asAdmin(http().post('/admin/clinics').send(body({ subscriptionEndsAt: daysFromNow(-1).toISOString() }))).expect(400);
    await asAdmin(http().post('/admin/clinics').send({ name: 'x' })).expect(400);
    // Nothing half-created: still exactly one clinic with that name.
    expect(await prisma.clinic.count({ where: { name: `x-${tag}` } })).toBe(0);
  });

  it('lists clinics with their state, and the "expired" filter shows grace + blocked, oldest first', async () => {
    await makeClinic('l_active', daysFromNow(30));
    await makeClinic('l_forever', null);
    await makeClinic('l_grace', daysFromNow(-1));
    await makeClinic('l_blocked', daysFromNow(-10));
    await makeClinic('l_susp', daysFromNow(30), 'SUSPENDED');
    await makeClinic('l_susp_expired', daysFromNow(-10), 'SUSPENDED');

    const all = await asAdmin(http().get('/admin/clinics').query({ q: `l_` })).expect(200);
    const mine = all.body.items.filter((i: any) => i.name.endsWith(tag) && i.name.startsWith('l_'));
    const state = (n: string) => mine.find((i: any) => i.name === `${n}-${tag}`).state;
    expect(state('l_active')).toBe('ACTIVE');
    expect(state('l_forever')).toBe('ACTIVE');
    expect(state('l_grace')).toBe('GRACE');
    expect(state('l_blocked')).toBe('EXPIRED');
    expect(state('l_susp')).toBe('SUSPENDED');
    expect(state('l_susp_expired')).toBe('SUSPENDED');
    expect(all.body.summary.total).toBeGreaterThanOrEqual(6);

    const grace = mine.find((i: any) => i.name === `l_grace-${tag}`);
    expect(grace.graceDaysLeft).toBeGreaterThanOrEqual(1);
    expect(grace.graceDaysLeft).toBeLessThanOrEqual(3);

    const exp = await asAdmin(http().get('/admin/clinics').query({ filter: 'expired', q: tag })).expect(200);
    expect(exp.body.items.map((i: any) => i.name)).toEqual([`l_blocked-${tag}`, `l_grace-${tag}`]);

    const sus = await asAdmin(http().get('/admin/clinics').query({ filter: 'suspended', q: tag })).expect(200);
    expect(sus.body.items.map((i: any) => i.name).sort()).toEqual([`l_susp-${tag}`, `l_susp_expired-${tag}`]);

    await asAdmin(http().get('/admin/clinics').query({ filter: 'nope' })).expect(400);
  });

  it('suspend blocks the owner at once, activate lets them back; repeating it changes nothing', async () => {
    const c = await createViaApi('susp');
    await login(c.username, c.temp).expect(200);

    await asAdmin(http().post(`/admin/clinics/${c.id}/suspend`).send({ reason: 'لم يدفع' })).expect(200);
    const blocked = await login(c.username, c.temp).expect(403);
    expect(blocked.body.code).toBe('CLINIC_SUSPENDED');
    await asAdmin(http().post(`/admin/clinics/${c.id}/suspend`).send({})).expect(200);

    const back = await asAdmin(http().post(`/admin/clinics/${c.id}/activate`).send({})).expect(200);
    expect(back.body.status).toBe('ACTIVE');
    await login(c.username, c.temp).expect(200);

    const actions = (await prisma.auditLog.findMany({ where: { clinicId: c.id }, orderBy: { createdAt: 'asc' } })).map((l) => l.action);
    expect(actions).toEqual(['CLINIC_CREATED', 'CLINIC_SUSPENDED', 'CLINIC_ACTIVATED']);
  });

  it('renew: an expired clinic works again; months extend from the end date; bad input is refused', async () => {
    const c = await createViaApi('renew', { subscriptionEndsAt: daysFromNow(2).toISOString() });
    await prisma.clinic.update({ where: { id: c.id }, data: { subscriptionEndsAt: daysFromNow(-10) } });
    const blocked = await login(c.username, c.temp).expect(403);
    expect(blocked.body.code).toBe('SUBSCRIPTION_EXPIRED');

    // Ended 10 days ago: 1 month counts from today, not from the old date.
    const r1 = await asAdmin(http().post(`/admin/clinics/${c.id}/renew`).send({ months: 1 })).expect(200);
    const end1 = new Date(r1.body.subscriptionEndsAt).getTime();
    expect(end1).toBeGreaterThan(daysFromNow(27).getTime());
    expect(end1).toBeLessThan(daysFromNow(32).getTime());
    expect(r1.body.state).toBe('ACTIVE');
    await login(c.username, c.temp).expect(200);

    // Still running: 1 more month is added on top of the current end date.
    const r2 = await asAdmin(http().post(`/admin/clinics/${c.id}/renew`).send({ months: 1 })).expect(200);
    expect(new Date(r2.body.subscriptionEndsAt).getTime()).toBeGreaterThan(end1 + 27 * DAY);

    const exact = daysFromNow(90);
    const r3 = await asAdmin(http().post(`/admin/clinics/${c.id}/renew`).send({ endsAt: exact.toISOString() })).expect(200);
    expect(new Date(r3.body.subscriptionEndsAt).toISOString()).toBe(exact.toISOString());

    await asAdmin(http().post(`/admin/clinics/${c.id}/renew`).send({})).expect(400);
    await asAdmin(http().post(`/admin/clinics/${c.id}/renew`).send({ months: 1, endsAt: exact.toISOString() })).expect(400);
    await asAdmin(http().post(`/admin/clinics/${c.id}/renew`).send({ endsAt: daysFromNow(-1).toISOString() })).expect(400);
    await asAdmin(http().post(`/admin/clinics/${c.id}/renew`).send({ months: 0 })).expect(400);

    const logs = await prisma.auditLog.findMany({ where: { clinicId: c.id, action: 'SUBSCRIPTION_RENEWED' } });
    expect(logs).toHaveLength(3);
  });

  it('reset owner password: new temporary password, old one dead, lockout cleared, old sessions ended', async () => {
    const c = await createViaApi('reset');
    const first = await login(c.username, c.temp).expect(200);
    expect(first.headers['set-cookie']).toBeDefined();
    for (let i = 0; i < 5; i++) await login(c.username, 'wrong-password-123');
    await login(c.username, c.temp).expect(401); // locked out even with the right password

    const res = await asAdmin(http().post(`/admin/clinics/${c.id}/reset-owner-password`)).expect(200);
    expect(res.body.temporaryPassword).not.toBe(c.temp);
    expect(res.body.owner.username).toBe(c.username);

    await login(c.username, c.temp).expect(401);
    const ok = await login(c.username, res.body.temporaryPassword).expect(200);
    expect(ok.body.mustChangePassword).toBe(true);

    const owner = await prisma.user.findUnique({ where: { username: c.username } });
    const live = await prisma.refreshToken.count({ where: { userId: owner!.id, revokedAt: null } });
    expect(live).toBe(1); // only the session created by the login just above

    const logs = await prisma.auditLog.findMany({ where: { clinicId: c.id, action: 'OWNER_PASSWORD_RESET' } });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(res.body.temporaryPassword);
  });

  it('audit log: filter by clinic, shows who did it, pages with nextBefore', async () => {
    const c = await createViaApi('audit');
    await asAdmin(http().post(`/admin/clinics/${c.id}/suspend`).send({})).expect(200);
    await asAdmin(http().post(`/admin/clinics/${c.id}/activate`).send({})).expect(200);

    const all = await asAdmin(http().get('/admin/audit').query({ clinicId: c.id })).expect(200);
    expect(all.body.items.map((i: any) => i.action)).toEqual(['CLINIC_ACTIVATED', 'CLINIC_SUSPENDED', 'CLINIC_CREATED']);
    expect(all.body.items[0].actor.username).toBe(`padmin_${tag}`);
    expect(all.body.nextBefore).toBeNull();

    const page1 = await asAdmin(http().get('/admin/audit').query({ clinicId: c.id, limit: 2 })).expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextBefore).not.toBeNull();
    const page2 = await asAdmin(http().get('/admin/audit').query({ clinicId: c.id, limit: 2, before: page1.body.nextBefore })).expect(200);
    expect(page2.body.items.map((i: any) => i.action)).toEqual(['CLINIC_CREATED']);

    await asAdmin(http().get('/admin/audit').query({ limit: 1000 })).expect(400);
    await asAdmin(http().get('/admin/audit').query({ clinicId: 'not-a-uuid' })).expect(400);
  });

  it('unknown or malformed clinic id: 404 / 400', async () => {
    await asAdmin(http().get(`/admin/clinics/${randomUUID()}`)).expect(404);
    await asAdmin(http().post(`/admin/clinics/${randomUUID()}/suspend`).send({})).expect(404);
    await asAdmin(http().post(`/admin/clinics/${randomUUID()}/reset-owner-password`)).expect(404);
    await asAdmin(http().get('/admin/clinics/not-a-uuid')).expect(400);
  });

  it('a platform admin whose password is still temporary cannot use the panel', async () => {
    const hash = await app.get(PasswordService).hash(password);
    const u = await prisma.user.create({
      data: { username: `tmpadmin_${tag}`, passwordHash: hash, fullName: 'T', role: 'PLATFORM_ADMIN', mustChangePassword: true },
    });
    const t = await app.get(TokenService).signAccess({ sub: u.id, role: 'PLATFORM_ADMIN', clinicId: null, mcp: true });
    await http().get('/admin/clinics').set('Authorization', `Bearer ${t}`).expect(403);
  });
});
