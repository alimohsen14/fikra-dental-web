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

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (d: number) => new Date(Date.now() + d * DAY);

// Real database. Creates its own clinics/users with random names and deletes them at the end.
describe('Subscription and clinic access (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const password = 'Test-Pass-12345';
  const clinicIds: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeClinic(name: string, subscriptionEndsAt: Date | null, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}`, subscriptionEndsAt, status } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash(password);
    const users: Record<string, { id: string; token: string; username: string }> = {};
    for (const role of ['OWNER', 'DOCTOR'] as Role[]) {
      const username = `${name}_${role}_${tag}`.toLowerCase();
      const u = await prisma.user.create({
        data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id },
      });
      const token = await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false });
      users[role] = { id: u.id, token, username };
    }
    return { clinic, users };
  }

  const login = (username: string) => http().post('/auth/login').send({ username, password });
  const me = (token: string) => http().get('/auth/me').set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { username: { endsWith: `_${tag}` } }] } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  it('active subscription: everything works and nobody sees a warning', async () => {
    const { users } = await makeClinic('ok', daysFromNow(30));
    const res = await login(users.OWNER!.username).expect(200);
    expect(res.body.subscriptionWarning).toBeNull();
    const info = await me(users.OWNER!.token).expect(200);
    expect(info.body.subscriptionWarning).toBeNull();
    expect(info.body.user.role).toBe('OWNER');
  });

  it('no end date set: works forever', async () => {
    const { users } = await makeClinic('forever', null);
    await login(users.OWNER!.username).expect(200);
  });

  it('grace days: still works, but ONLY the owner gets the warning', async () => {
    const { users } = await makeClinic('grace', daysFromNow(-1));
    const owner = await login(users.OWNER!.username).expect(200);
    expect(owner.body.subscriptionWarning.graceDaysLeft).toBe(2);
    const doctor = await login(users.DOCTOR!.username).expect(200);
    expect(doctor.body.subscriptionWarning).toBeNull();

    const ownerMe = await me(users.OWNER!.token).expect(200);
    expect(ownerMe.body.subscriptionWarning.graceDaysLeft).toBe(2);
    const doctorMe = await me(users.DOCTOR!.token).expect(200);
    expect(doctorMe.body.subscriptionWarning).toBeNull();
  });

  it('more than 3 days after the end: nobody can log in, and open sessions stop immediately', async () => {
    const { users } = await makeClinic('expired', daysFromNow(-4));
    for (const role of ['OWNER', 'DOCTOR']) {
      const res = await login(users[role]!.username).expect(403);
      expect(res.body.code).toBe('SUBSCRIPTION_EXPIRED');
    }
    // A token issued earlier is refused on the very next request.
    const res = await me(users.OWNER!.token).expect(403);
    expect(res.body.code).toBe('SUBSCRIPTION_EXPIRED');
    await http().get('/patients').set('Authorization', `Bearer ${users.DOCTOR!.token}`).expect(403);
  });

  it('wrong password on an expired clinic still gets the generic error (nothing leaks)', async () => {
    const { users } = await makeClinic('expired2', daysFromNow(-10));
    await http().post('/auth/login').send({ username: users.OWNER!.username, password: 'wrong-password-1' }).expect(401);
  });

  it('renewing the subscription brings everything back', async () => {
    const { clinic, users } = await makeClinic('renew', daysFromNow(-10));
    await login(users.OWNER!.username).expect(403);
    await prisma.clinic.update({ where: { id: clinic.id }, data: { subscriptionEndsAt: daysFromNow(365) } });
    await login(users.OWNER!.username).expect(200);
    await me(users.OWNER!.token).expect(200);
  });

  it('a suspended clinic is blocked even with a valid subscription', async () => {
    const { users } = await makeClinic('suspended', daysFromNow(100), 'SUSPENDED');
    const res = await login(users.OWNER!.username).expect(403);
    expect(res.body.code).toBe('CLINIC_SUSPENDED');
    await me(users.OWNER!.token).expect(403);
  });

  it('refresh is refused once the clinic is locked', async () => {
    const { clinic, users } = await makeClinic('refresh', daysFromNow(10));
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ username: users.OWNER!.username, password }).expect(200);
    await agent.post('/auth/refresh').expect(200);
    await prisma.clinic.update({ where: { id: clinic.id }, data: { subscriptionEndsAt: daysFromNow(-5) } });
    await agent.post('/auth/refresh').expect(401);
  });

  it('platform admin (no clinic) is never blocked by subscriptions', async () => {
    const admin = await prisma.user.create({
      data: {
        username: `platform_${tag}`,
        passwordHash: await app.get(PasswordService).hash(password),
        fullName: 'platform',
        role: 'PLATFORM_ADMIN',
      },
    });
    const token = await app.get(TokenService).signAccess({ sub: admin.id, role: 'PLATFORM_ADMIN', clinicId: null, mcp: false });
    await me(token).expect(200);
  });
});
