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
import { TERMS_VERSION } from '../src/legal/terms.js';
import type { Role } from '../src/generated/prisma/client.js';

// The clinic owner must accept the terms of use before using the system. Real database; the other tests switch this check off.
describe('Terms of use: the owner accepts before using the system (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const password = 'Test-Pass-12345';
  let clinicId: string;
  let adminId: string;
  const ids = {} as Record<string, string>;
  const tokens = {} as Record<string, string>;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.TERMS_ENFORCED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await app.get(PasswordService).hash(password);
    const clinic = await prisma.clinic.create({ data: { name: `terms-${tag}` } });
    clinicId = clinic.id;
    for (const role of ['OWNER', 'DOCTOR', 'SECRETARY'] as Role[]) {
      const u = await prisma.user.create({ data: { username: `terms_${role}_${tag}`.toLowerCase(), passwordHash: hash, fullName: role, role, clinicId } });
      ids[role] = u.id;
      tokens[role] = await app.get(TokenService).signAccess({ sub: u.id, role, clinicId, mcp: false });
    }
    const admin = await prisma.user.create({ data: { username: `terms_padmin_${tag}`, passwordHash: hash, fullName: 'Admin', role: 'PLATFORM_ADMIN' } });
    adminId = admin.id;
    tokens.ADMIN = await app.get(TokenService).signAccess({ sub: admin.id, role: 'PLATFORM_ADMIN', clinicId: null, mcp: false });
  }, 60_000);

  afterAll(async () => {
    process.env.TERMS_ENFORCED = 'false';
    await prisma.auditLog.deleteMany({ where: { OR: [{ clinicId }, { actorUserId: adminId }] } });
    await prisma.user.deleteMany({ where: { OR: [{ clinicId }, { id: adminId }] } });
    await prisma.clinic.deleteMany({ where: { id: clinicId } });
    await app.close();
  });

  it('the text is public, and carries its version', async () => {
    const res = await http().get('/legal/terms').expect(200);
    expect(res.body.version).toBe(TERMS_VERSION);
    expect(res.body.sections.length).toBeGreaterThan(5);
    expect(JSON.stringify(res.body)).toContain('تحديد المسؤولية');
  });

  it('an owner who has not accepted is blocked everywhere except /auth/me and accepting; staff and the platform admin are not asked', async () => {
    const login = await http().post('/auth/login').send({ username: `terms_owner_${tag}`, password }).expect(200);
    expect(login.body.termsRequired).toBe(true);

    const blocked = await http().get('/patients').set(bearer(tokens.OWNER)).expect(403);
    expect(blocked.body.code).toBe('TERMS_REQUIRED');
    const me = await http().get('/auth/me').set(bearer(tokens.OWNER)).expect(200);
    expect(me.body.termsRequired).toBe(true);

    await http().get('/patients').set(bearer(tokens.DOCTOR)).expect(200);
    await http().get('/patients').set(bearer(tokens.SECRETARY)).expect(200);
    expect((await http().get('/auth/me').set(bearer(tokens.DOCTOR)).expect(200)).body.termsRequired).toBe(false);
    expect((await http().get('/auth/me').set(bearer(tokens.ADMIN)).expect(200)).body.termsRequired).toBe(false);
  });

  it('only the owner can accept, and only the current version; the acceptance is recorded with when and from where', async () => {
    await http().post('/auth/accept-terms').set(bearer(tokens.DOCTOR)).send({ version: TERMS_VERSION }).expect(403);
    await http().post('/auth/accept-terms').set(bearer(tokens.OWNER)).send({ version: 'old-version' }).expect(400);
    await http().post('/auth/accept-terms').set(bearer(tokens.OWNER)).send({}).expect(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.OWNER } })).termsAcceptedAt).toBeNull();

    await http().post('/auth/accept-terms').set(bearer(tokens.OWNER)).set('User-Agent', 'terms-test').send({ version: TERMS_VERSION }).expect(204);

    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ids.OWNER } });
    expect(owner.termsAcceptedVersion).toBe(TERMS_VERSION);
    expect(owner.termsAcceptedAt).not.toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { actorUserId: ids.OWNER, action: 'TERMS_ACCEPTED' } });
    expect(log.after).toMatchObject({ version: TERMS_VERSION, userAgent: 'terms-test' });

    await http().get('/patients').set(bearer(tokens.OWNER)).expect(200);
    expect((await http().get('/auth/me').set(bearer(tokens.OWNER)).expect(200)).body.termsRequired).toBe(false);
    const login = await http().post('/auth/login').send({ username: `terms_owner_${tag}`, password }).expect(200);
    expect(login.body.termsRequired).toBe(false);
  });

  it('a new version of the terms asks the owner again', async () => {
    await prisma.user.update({ where: { id: ids.OWNER }, data: { termsAcceptedVersion: '2000-01-01' } });
    const res = await http().get('/patients').set(bearer(tokens.OWNER)).expect(403);
    expect(res.body.code).toBe('TERMS_REQUIRED');
  });

  it('the platform admin sees who accepted and when', async () => {
    await prisma.user.update({ where: { id: ids.OWNER }, data: { termsAcceptedVersion: TERMS_VERSION, termsAcceptedAt: new Date() } });
    const res = await http().get(`/admin/clinics/${clinicId}`).set(bearer(tokens.ADMIN)).expect(200);
    const owner = res.body.users.find((u: { role: string }) => u.role === 'OWNER');
    expect(owner.termsAcceptedVersion).toBe(TERMS_VERSION);
    expect(owner.termsAcceptedAt).toBeTruthy();
  });
});
