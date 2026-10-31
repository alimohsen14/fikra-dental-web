import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { TokenService } from '../src/auth/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { Role } from '../src/generated/prisma/client.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(40, 2)]);

// Real database + a temporary upload folder. Creates its own clinics/users and removes them at the end.
describe('Clinic logo upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const uploadDir = mkdtempSync(join(tmpdir(), 'fikra-logos-'));
  const tag = randomUUID().slice(0, 8);
  const password = 'Test-Pass-12345';
  const clinicIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const logoDir = () => join(uploadDir, 'logos');
  const files = () => (existsSync(logoDir()) ? readdirSync(logoDir()) : []);

  async function makeClinic(name: string) {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}` } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash(password);
    const users = {} as Record<Role, { id: string; token: string }>;
    for (const role of ['OWNER', 'DOCTOR', 'SECRETARY'] as Role[]) {
      const username = `${name}_${role}_${tag}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id } });
      users[role] = { id: u.id, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }) };
    }
    return { clinic, users };
  }
  const put = (token: string, body: Buffer, type = 'image/png') => http().put('/clinic/logo').set(bearer(token)).set('Content-Type', type).send(body);

  beforeAll(async () => {
    process.env.UPLOAD_DIR = uploadDir;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.user.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  });

  it('only the owner can upload or remove a logo', async () => {
    const { users } = await makeClinic('roles');
    for (const role of ['DOCTOR', 'SECRETARY'] as Role[]) {
      await put(users[role].token, PNG).expect(403);
      await http().delete('/clinic/logo').set(bearer(users[role].token)).expect(403);
    }
    await http().put('/clinic/logo').set('Content-Type', 'image/png').send(PNG).expect(401);
    expect(files()).toEqual([]);
  });

  it('the owner uploads a PNG: saved, linked to the clinic, served publicly with safe headers, and audited', async () => {
    const { clinic, users } = await makeClinic('up');
    const res = await put(users.OWNER.token, PNG).expect(200);
    expect(res.body.id).toBe(clinic.id);
    expect(res.body.logoUrl).toMatch(new RegExp(`^/clinic/logo/${clinic.id}-[0-9a-f]{16}\\.png$`));
    expect((await prisma.clinic.findUnique({ where: { id: clinic.id } }))!.logoUrl).toBe(res.body.logoUrl);

    // public: no login needed (an <img> tag cannot send a token)
    const img = await http().get(res.body.logoUrl).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);

    // the login/me response carries it
    const me = await http().get('/auth/me').set(bearer(users.OWNER.token)).expect(200);
    expect(me.body.clinic.logoUrl).toBe(res.body.logoUrl);

    const log = await prisma.auditLog.findFirst({ where: { clinicId: clinic.id, action: 'CLINIC_LOGO_UPDATED' } });
    expect(log!.actorUserId).toBe(users.OWNER.id);
    expect(JSON.stringify(log)).not.toContain('iVBOR'); // no file bytes in the log
  });

  it('JPEG and WebP are accepted too', async () => {
    const { users } = await makeClinic('types');
    expect((await put(users.OWNER.token, JPG, 'image/jpeg').expect(200)).body.logoUrl).toMatch(/\.jpg$/);
    expect((await put(users.OWNER.token, WEBP, 'image/webp').expect(200)).body.logoUrl).toMatch(/\.webp$/);
  });

  it('a new logo replaces the old one: the old file is deleted', async () => {
    const { users } = await makeClinic('replace');
    const first = (await put(users.OWNER.token, PNG).expect(200)).body.logoUrl as string;
    const second = (await put(users.OWNER.token, JPG, 'image/jpeg').expect(200)).body.logoUrl as string;
    expect(second).not.toBe(first);
    expect(files()).not.toContain(first.split('/').pop());
    expect(files()).toContain(second.split('/').pop());
    await http().get(first).expect(404);
  });

  it('removing the logo clears it and deletes the file', async () => {
    const { clinic, users } = await makeClinic('remove');
    const url = (await put(users.OWNER.token, PNG).expect(200)).body.logoUrl as string;
    const res = await http().delete('/clinic/logo').set(bearer(users.OWNER.token)).expect(200);
    expect(res.body.logoUrl).toBeNull();
    expect(files()).not.toContain(url.split('/').pop());
    expect((await prisma.clinic.findUnique({ where: { id: clinic.id } }))!.logoUrl).toBeNull();
    expect(await prisma.auditLog.count({ where: { clinicId: clinic.id, action: 'CLINIC_LOGO_REMOVED' } })).toBe(1);
  });

  it('refuses anything that is not a real PNG/JPEG/WebP, whatever the client says it is', async () => {
    const { clinic, users } = await makeClinic('bad');
    const before = files().length;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64, ' '));
    const tooShort = PNG.subarray(0, 10);
    await put(users.OWNER.token, svg, 'image/png').expect(400);
    await put(users.OWNER.token, svg, 'image/svg+xml').expect(400);
    await put(users.OWNER.token, html, 'image/jpeg').expect(400);
    await put(users.OWNER.token, tooShort).expect(400);
    await http().put('/clinic/logo').set(bearer(users.OWNER.token)).set('Content-Type', 'image/png').expect(400); // empty body
    expect(files().length).toBe(before);
    expect((await prisma.clinic.findUnique({ where: { id: clinic.id } }))!.logoUrl).toBeNull();
  });

  it('refuses a file over 512 KB and stores nothing', async () => {
    const { clinic, users } = await makeClinic('big');
    const before = files().length;
    const big = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]);
    await put(users.OWNER.token, big).expect(413);
    const exactlyAtLimit = Buffer.concat([PNG, Buffer.alloc(512 * 1024 - PNG.length)]);
    await put(users.OWNER.token, exactlyAtLimit).expect(200);
    expect(files().length).toBe(before + 1);
    expect((await prisma.clinic.findUnique({ where: { id: clinic.id } }))!.logoUrl).not.toBeNull();
  });

  it('serves only files with the exact generated name pattern (no path tricks, no foreign files)', async () => {
    mkdirSync(logoDir(), { recursive: true });
    writeFileSync(join(logoDir(), 'secret.txt'), 'top secret');
    writeFileSync(join(uploadDir, 'outside.png'), PNG);
    for (const name of ['secret.txt', '..%2foutside.png', '..%2f..%2fetc%2fpasswd', 'x.png', `${randomUUID()}-0123456789abcdef.png`, `${randomUUID()}-0123456789abcdef.svg`]) {
      await http().get(`/clinic/logo/${name}`).expect(404);
    }
  });

  it("an owner can only change their own clinic's logo", async () => {
    const a = await makeClinic('iso_a');
    const b = await makeClinic('iso_b');
    const urlB = (await put(b.users.OWNER.token, PNG).expect(200)).body.logoUrl as string;
    await put(a.users.OWNER.token, JPG, 'image/jpeg').expect(200);
    expect((await prisma.clinic.findUnique({ where: { id: b.clinic.id } }))!.logoUrl).toBe(urlB);
    await http().delete('/clinic/logo').set(bearer(a.users.OWNER.token)).expect(200);
    expect((await prisma.clinic.findUnique({ where: { id: b.clinic.id } }))!.logoUrl).toBe(urlB);
    await http().get(urlB).expect(200);
  });
});
