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
describe('Clinic identity: branding in /auth/me and settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const password = 'Test-Pass-12345';
  const clinicIds: string[] = [];
  let adminId: string;
  let adminToken: string;
  const http = () => request(app.getHttpServer());

  async function makeClinic(name: string, themeColor: string | null) {
    const clinic = await prisma.clinic.create({
      data: { name: `${name}-${tag}`, themeColor, logoUrl: `https://example.com/${name}.png` },
    });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash(password);
    const users = {} as Record<Role, { id: string; token: string; username: string }>;
    for (const role of ['OWNER', 'DOCTOR', 'SECRETARY'] as Role[]) {
      const username = `${name}_${role}_${tag}`.toLowerCase();
      const u = await prisma.user.create({
        data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id },
      });
      const token = await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false });
      users[role] = { id: u.id, token, username };
    }
    return { clinic, users };
  }

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

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
  }, 60_000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { actorUserId: adminId }] } });
    await prisma.user.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { username: { endsWith: `_${tag}` } }] } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  it('login, /auth/me: every clinic user gets the clinic name, color and logo; the platform admin gets none', async () => {
    const { clinic, users } = await makeClinic('brand', '#058ffb');
    const expected = { id: clinic.id, name: `brand-${tag}`, themeColor: '#058ffb', logoUrl: 'https://example.com/brand.png' };

    for (const role of ['OWNER', 'DOCTOR', 'SECRETARY'] as Role[]) {
      const login = await http().post('/auth/login').send({ username: users[role].username, password }).expect(200);
      expect(login.body.clinic).toEqual(expected);
      const me = await http().get('/auth/me').set(bearer(users[role].token)).expect(200);
      expect(me.body.clinic).toEqual(expected);
    }
    const adminMe = await http().get('/auth/me').set(bearer(adminToken)).expect(200);
    expect(adminMe.body.clinic).toBeNull();
  });

  it('the owner changes the clinic name and color; a null color goes back to the default', async () => {
    const { clinic, users } = await makeClinic('own', '#111111');
    const res = await http().patch('/clinic/settings').set(bearer(users.OWNER.token)).send({ name: `New Name ${tag}`, themeColor: '#0B5D57' }).expect(200);
    expect(res.body).toMatchObject({ id: clinic.id, name: `New Name ${tag}`, themeColor: '#0b5d57' }); // stored lowercase
    const me = await http().get('/auth/me').set(bearer(users.DOCTOR.token)).expect(200);
    expect(me.body.clinic.name).toBe(`New Name ${tag}`);

    const reset = await http().patch('/clinic/settings').set(bearer(users.OWNER.token)).send({ themeColor: null }).expect(200);
    expect(reset.body.themeColor).toBeNull();
    expect(reset.body.name).toBe(`New Name ${tag}`); // untouched

    const logs = await prisma.auditLog.findMany({ where: { clinicId: clinic.id, action: 'CLINIC_SETTINGS_UPDATED' }, orderBy: { createdAt: 'asc' } });
    expect(logs).toHaveLength(2);
    expect(logs[0]!.actorUserId).toBe(users.OWNER.id);
    expect(logs[0]!.before).toEqual({ name: `own-${tag}`, themeColor: '#111111' });
  });

  it('refuses bad colors, empty updates and every field the owner must not change', async () => {
    const { clinic, users } = await makeClinic('bad', '#222222');
    const send = (body: object) => http().patch('/clinic/settings').set(bearer(users.OWNER.token)).send(body);
    for (const bad of [
      {},
      { themeColor: 'red' },
      { themeColor: '#12345' },
      { themeColor: 'javascript:alert(1)' },
      { name: 'x' },
      { name: 5 },
      { status: 'SUSPENDED' },
      { subscriptionEndsAt: '2099-01-01T00:00:00Z' },
      { logoUrl: 'https://evil.example/x.png' },
      { clinicId: randomUUID() },
      { id: randomUUID() },
      // A forbidden field hidden next to a valid one must be refused as well, not silently ignored.
      { name: 'Valid Name', status: 'SUSPENDED' },
      { themeColor: '#123456', logoUrl: 'https://evil.example/x.png' },
      { name: 'Valid Name', clinicId: randomUUID() },
      { name: 'Valid Name', subscriptionEndsAt: '2099-01-01T00:00:00Z' },
    ]) {
      await send(bad).expect(400);
    }
    const after = await prisma.clinic.findUnique({ where: { id: clinic.id } });
    expect(after).toMatchObject({ name: `bad-${tag}`, themeColor: '#222222', status: 'ACTIVE', logoUrl: 'https://example.com/bad.png' });
  });

  it('an owner can only ever change their own clinic', async () => {
    const a = await makeClinic('ta', '#aaaaaa');
    const b = await makeClinic('tb', '#bbbbbb');
    // Even if the request carries the other clinic's id anywhere, only the token's clinic is touched.
    await http().patch(`/clinic/settings?clinicId=${b.clinic.id}`).set(bearer(a.users.OWNER.token)).send({ themeColor: '#123456' }).expect(200);
    expect((await prisma.clinic.findUnique({ where: { id: a.clinic.id } }))!.themeColor).toBe('#123456');
    expect((await prisma.clinic.findUnique({ where: { id: b.clinic.id } }))!.themeColor).toBe('#bbbbbb');
  });

  it('doctors, secretaries, the platform admin and anonymous users cannot use /clinic/settings', async () => {
    const { users } = await makeClinic('role', '#333333');
    for (const t of [users.DOCTOR.token, users.SECRETARY.token, adminToken]) {
      await http().patch('/clinic/settings').set(bearer(t)).send({ name: 'Hacked' }).expect(403);
    }
    await http().patch('/clinic/settings').send({ name: 'Hacked' }).expect(401);
  });

  it('the platform admin edits any clinic; clinic users cannot', async () => {
    const { clinic, users } = await makeClinic('adm', '#444444');
    const res = await http().patch(`/admin/clinics/${clinic.id}`).set(bearer(adminToken)).send({ name: `Renamed ${tag}`, themeColor: '#058ffb' }).expect(200);
    expect(res.body).toMatchObject({ id: clinic.id, name: `Renamed ${tag}`, themeColor: '#058ffb' });
    const log = await prisma.auditLog.findFirst({ where: { clinicId: clinic.id, action: 'CLINIC_UPDATED' } });
    expect(log!.actorUserId).toBe(adminId);

    await http().patch(`/admin/clinics/${clinic.id}`).set(bearer(users.OWNER.token)).send({ name: 'Hacked' }).expect(403);
    await http().patch(`/admin/clinics/${randomUUID()}`).set(bearer(adminToken)).send({ name: 'Nope!' }).expect(404);
    await http().patch('/admin/clinics/not-a-uuid').set(bearer(adminToken)).send({ name: 'Nope!' }).expect(400);
    await http().patch(`/admin/clinics/${clinic.id}`).set(bearer(adminToken)).send({ status: 'SUSPENDED' }).expect(400);
    await http().patch(`/admin/clinics/${clinic.id}`).set(bearer(adminToken)).send({ name: 'Valid Name', status: 'SUSPENDED' }).expect(400);
    expect((await prisma.clinic.findUnique({ where: { id: clinic.id } }))!.status).toBe('ACTIVE');
  });
});
