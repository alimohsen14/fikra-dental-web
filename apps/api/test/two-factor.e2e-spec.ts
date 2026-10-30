import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { TotpService } from '../src/auth/totp.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

const appCode = (secret: string, offsetSeconds = 0) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate({
    timestamp: Date.now() + offsetSeconds * 1000,
  });

// Real database. Creates its own users with random names and deletes them at the end.
describe('Platform admin two-factor login (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let totp: TotpService;
  const tag = randomUUID().slice(0, 8);
  const password = 'Test-Pass-12345';
  const http = () => request(app.getHttpServer());

  async function makeAdmin(name: string, withTwoFactor = true) {
    const secret = totp.newSecret();
    const recovery = totp.newRecoveryCodes();
    const user = await prisma.user.create({
      data: {
        username: `${name}_${tag}`,
        passwordHash: await app.get(PasswordService).hash(password),
        fullName: name,
        role: 'PLATFORM_ADMIN',
        ...(withTwoFactor ? { totpSecret: totp.encrypt(secret), totpEnabledAt: new Date() } : {}),
      },
    });
    if (withTwoFactor) {
      await prisma.recoveryCode.createMany({
        data: recovery.map((c) => ({ userId: user.id, codeHash: totp.hashRecoveryCode(c) })),
      });
    }
    return { user, secret, recovery, username: user.username };
  }

  const login = (username: string) => http().post('/auth/login').send({ username, password });
  const verify = (challengeToken: string, code: string) =>
    http().post('/auth/2fa/verify').send({ challengeToken, code });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    totp = app.get(TotpService);
  }, 60_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { endsWith: `_${tag}` } } });
    await app.close();
  });

  it('the password alone never gives a session: only a challenge', async () => {
    const admin = await makeAdmin('step1');
    const res = await login(admin.username).expect(200);
    expect(res.body.twoFactorRequired).toBe(true);
    expect(res.body.challengeToken).toBeTruthy();
    expect(res.body.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('the challenge token is useless as a login token', async () => {
    const admin = await makeAdmin('notatoken');
    const { challengeToken } = (await login(admin.username).expect(200)).body;
    await http().get('/auth/me').set('Authorization', `Bearer ${challengeToken}`).expect(401);
  });

  it('a correct app code completes the login', async () => {
    const admin = await makeAdmin('happy');
    const { challengeToken } = (await login(admin.username).expect(200)).body;
    const res = await verify(challengeToken, appCode(admin.secret)).expect(200);
    expect(res.body.user.role).toBe('PLATFORM_ADMIN');
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');

    await http().get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    const audit = await prisma.auditLog.findFirst({ where: { actorUserId: admin.user.id, action: 'PLATFORM_ADMIN_LOGIN' } });
    expect(audit).not.toBeNull();
  });

  it('a wrong code is refused', async () => {
    const admin = await makeAdmin('wrong');
    const { challengeToken } = (await login(admin.username).expect(200)).body;
    await verify(challengeToken, '000000').expect(401);
    await verify(challengeToken, 'not-a-code').expect(401);
  });

  it('a code cannot be used twice (replay)', async () => {
    const admin = await makeAdmin('replay');
    const code = appCode(admin.secret);
    const first = (await login(admin.username).expect(200)).body.challengeToken;
    await verify(first, code).expect(200);
    const second = (await login(admin.username).expect(200)).body.challengeToken;
    await verify(second, code).expect(401);
  });

  it('after 5 wrong codes the account locks, even for the right code', async () => {
    const admin = await makeAdmin('lock');
    const { challengeToken } = (await login(admin.username).expect(200)).body;
    for (let i = 0; i < 5; i++) await verify(challengeToken, '000000').expect(401);
    await verify(challengeToken, appCode(admin.secret)).expect(401);
    await login(admin.username).expect(401);
  });

  it('knowing the password does not reset the failed-code counter', async () => {
    const admin = await makeAdmin('counter');
    const { challengeToken } = (await login(admin.username).expect(200)).body;
    for (let i = 0; i < 3; i++) await verify(challengeToken, '000000').expect(401);
    await login(admin.username).expect(200); // password step again
    const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } });
    expect(row.failedLoginCount).toBe(3);
  });

  it('a recovery code works exactly once', async () => {
    const admin = await makeAdmin('recovery');
    const code = admin.recovery[0]!;
    const c1 = (await login(admin.username).expect(200)).body.challengeToken;
    await verify(c1, code.toLowerCase()).expect(200); // formatting does not matter
    const c2 = (await login(admin.username).expect(200)).body.challengeToken;
    await verify(c2, code).expect(401);
    await verify(c2, admin.recovery[1]!).expect(200); // another one still works
  });

  it('the secret is stored encrypted and recovery codes only as hashes', async () => {
    const admin = await makeAdmin('stored');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } });
    expect(row.totpSecret).not.toContain(admin.secret);
    const codes = await prisma.recoveryCode.findMany({ where: { userId: admin.user.id } });
    expect(codes).toHaveLength(8);
    for (const c of codes) expect(admin.recovery.map((r) => r.replace('-', ''))).not.toContain(c.codeHash);
  });

  it('an admin without two-factor set up cannot log in at all', async () => {
    const admin = await makeAdmin('nofa', false);
    const res = await login(admin.username).expect(403);
    expect(res.body.code).toBe('TWO_FACTOR_NOT_SET_UP');
  });

  it('a garbage or expired challenge is refused', async () => {
    await verify('x'.repeat(40), '123456').expect(401);
  });

  it('normal clinic users are not asked for a second step', async () => {
    const clinic = await prisma.clinic.create({ data: { name: `fa-clinic-${tag}` } });
    await prisma.user.create({
      data: {
        username: `faowner_${tag}`,
        passwordHash: await app.get(PasswordService).hash(password),
        fullName: 'owner',
        role: 'OWNER',
        clinicId: clinic.id,
      },
    });
    const res = await login(`faowner_${tag}`).expect(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.twoFactorRequired).toBeUndefined();
    await prisma.user.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.clinic.delete({ where: { id: clinic.id } });
  });
});
