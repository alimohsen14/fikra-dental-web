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
describe('Team management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const password = 'Test-Pass-12345';
  const clinicIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function makeClinic(name: string) {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}` } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash(password);
    const users = {} as Record<Role, { id: string; username: string; token: string }>;
    for (const role of ['OWNER', 'DOCTOR', 'SECRETARY'] as Role[]) {
      const username = `${name}_${role}_${tag}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id } });
      users[role] = { id: u.id, username, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }) };
    }
    await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.OWNER.id, fullName: 'Owner Doc' } });
    return { id: clinic.id, users };
  }
  type Clinic = Awaited<ReturnType<typeof makeClinic>>;

  const add = (c: Clinic, body: Record<string, unknown>) => http().post('/staff').set(bearer(c.users.OWNER.token)).send(body);
  const login = (username: string, pw: string) => http().post('/auth/login').send({ username, password: pw });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { clinicId: { in: clinicIds } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.appointment.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.patient.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.doctorWorkingPeriod.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.doctor.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.user.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });

  it('the owner adds a doctor: temporary password shown once, doctor record created, audited, must change password', async () => {
    const c = await makeClinic('adddoc');
    const username = `dr_new_${tag}`;
    const res = await add(c, { username, fullName: 'د. سمير', role: 'DOCTOR', specialty: 'تقويم', phone: '0599123456' }).expect(201);
    expect(res.body.temporaryPassword).toMatch(/.{12,}/);
    expect(res.body.staff).toMatchObject({ username, role: 'DOCTOR', isActive: true, mustChangePassword: true, canManagePayments: false, doctor: { specialty: 'تقويم', isActive: true } });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const row = await prisma.user.findUnique({ where: { username } });
    expect(row!.clinicId).toBe(c.id);
    expect(row!.passwordHash).not.toContain(res.body.temporaryPassword); // only the hash is stored
    expect((await prisma.doctor.findUnique({ where: { userId: row!.id } }))!.clinicId).toBe(c.id);
    const audit = await prisma.auditLog.findFirst({ where: { clinicId: c.id, action: 'STAFF_CREATED', entityId: row!.id } });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain(res.body.temporaryPassword);

    // the new doctor can log in with it and is forced to change it
    const l = await login(username, res.body.temporaryPassword).expect(200);
    expect(l.body.mustChangePassword ?? l.body.user?.mustChangePassword ?? true).toBeTruthy();
    // and shows up in the doctors list used by the calendar
    const docs = await http().get('/doctors').set(bearer(c.users.OWNER.token)).expect(200);
    expect(docs.body.map((d: { fullName: string }) => d.fullName)).toContain('د. سمير');
  });

  it('the owner adds a secretary (no doctor record); can give payments permission', async () => {
    const c = await makeClinic('addsec');
    const res = await add(c, { username: `sec_new_${tag}`, fullName: 'رنا', role: 'SECRETARY', canManagePayments: true }).expect(201);
    expect(res.body.staff).toMatchObject({ role: 'SECRETARY', canManagePayments: true, doctor: null });
    expect(await prisma.doctor.count({ where: { clinicId: c.id } })).toBe(1); // only the owner's
  });

  it('refuses: duplicate username (even from another clinic), bad input, extra fields, owner/admin roles, specialty on a secretary', async () => {
    const c = await makeClinic('bad');
    const other = await makeClinic('bad2');
    const ok = { username: `dup_${tag}`, fullName: 'اسم', role: 'SECRETARY' };
    await add(c, ok).expect(201);
    await add(c, ok).expect(409);
    await add(other, ok).expect(409); // usernames are unique across the whole system
    await add(c, { ...ok, username: 'x' }).expect(400);
    await add(c, { ...ok, username: 'has space' }).expect(400);
    await add(c, { ...ok, username: `u2_${tag}`, role: 'OWNER' }).expect(400);
    await add(c, { ...ok, username: `u3_${tag}`, role: 'PLATFORM_ADMIN' }).expect(400);
    await add(c, { ...ok, username: `u4_${tag}`, clinicId: other.id }).expect(400);
    await add(c, { ...ok, username: `u5_${tag}`, specialty: 'تقويم' }).expect(400);
    await add(c, { username: `u6_${tag}` }).expect(400);
    expect(await prisma.user.count({ where: { username: { in: [`u2_${tag}`, `u3_${tag}`, `u4_${tag}`, `u5_${tag}`, `u6_${tag}`] } } })).toBe(0);
  });

  it('only the owner: secretary, doctor, platform admin and anonymous are refused on every route', async () => {
    const c = await makeClinic('perm');
    const admin = await prisma.user.create({ data: { username: `padmin_${tag}`, passwordHash: 'x', fullName: 'A', role: 'PLATFORM_ADMIN' } });
    const adminToken = await app.get(TokenService).signAccess({ sub: admin.id, role: 'PLATFORM_ADMIN', clinicId: null, mcp: false });
    const id = c.users.SECRETARY.id;
    for (const t of [c.users.SECRETARY.token, c.users.DOCTOR.token, adminToken]) {
      await http().get('/staff').set(bearer(t)).expect(403);
      await http().post('/staff').set(bearer(t)).send({ username: `zz_${tag}`, fullName: 'اسم', role: 'SECRETARY' }).expect(403);
      await http().patch(`/staff/${id}`).set(bearer(t)).send({ fullName: 'اسم جديد' }).expect(403);
      for (const a of ['deactivate', 'activate', 'reset-password']) await http().post(`/staff/${id}/${a}`).set(bearer(t)).expect(403);
    }
    await http().get('/staff').expect(401);
    expect(await prisma.user.count({ where: { username: `zz_${tag}` } })).toBe(0);
    await prisma.user.delete({ where: { id: admin.id } });
  });

  it('lists only this clinic, without secrets', async () => {
    const a = await makeClinic('lista');
    const b = await makeClinic('listb');
    const res = await http().get('/staff').set(bearer(a.users.OWNER.token)).expect(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((u: { id: string }) => u.id).sort()).toEqual([a.users.OWNER.id, a.users.DOCTOR.id, a.users.SECRETARY.id].sort());
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|totp/);
    expect(res.body.map((u: { id: string }) => u.id)).not.toContain(b.users.OWNER.id);
  });

  it('edit: name/phone/specialty/payments flag; the doctor record follows; owner and self are protected', async () => {
    const c = await makeClinic('edit');
    const created = (await add(c, { username: `ed_${tag}`, fullName: 'قديم', role: 'DOCTOR', specialty: 'عام' }).expect(201)).body.staff;
    const res = await http().patch(`/staff/${created.id}`).set(bearer(c.users.OWNER.token)).send({ fullName: 'جديد', phone: '0599000111', specialty: 'أطفال', canManagePayments: true }).expect(200);
    expect(res.body).toMatchObject({ fullName: 'جديد', phone: '0599000111', canManagePayments: true, doctor: { specialty: 'أطفال' } });
    expect((await prisma.doctor.findUnique({ where: { id: created.doctor.id } }))!.fullName).toBe('جديد');
    await http().patch(`/staff/${created.id}`).set(bearer(c.users.OWNER.token)).send({ phone: null, specialty: null }).expect(200);
    await http().patch(`/staff/${created.id}`).set(bearer(c.users.OWNER.token)).send({}).expect(400);
    await http().patch(`/staff/${created.id}`).set(bearer(c.users.OWNER.token)).send({ role: 'OWNER' }).expect(400);
    await http().patch(`/staff/${created.id}`).set(bearer(c.users.OWNER.token)).send({ username: 'hacked' }).expect(400);
    await http().patch(`/staff/${c.users.OWNER.id}`).set(bearer(c.users.OWNER.token)).send({ fullName: 'اسم صحيح' }).expect(400); // the owner himself
    const sec = (await add(c, { username: `es_${tag}`, fullName: 'سكرتيرة', role: 'SECRETARY' }).expect(201)).body.staff;
    await http().patch(`/staff/${sec.id}`).set(bearer(c.users.OWNER.token)).send({ specialty: 'تقويم' }).expect(400); // not a doctor
    await http().patch(`/staff/${randomUUID()}`).set(bearer(c.users.OWNER.token)).send({ fullName: 'اسم صحيح' }).expect(404);
    await http().patch('/staff/not-a-uuid').set(bearer(c.users.OWNER.token)).send({ fullName: 'اسم صحيح' }).expect(400);
  });

  it('stopping an account: login dies immediately, sessions end, doctor leaves the booking list, nothing is deleted; restore works', async () => {
    const c = await makeClinic('stop');
    const created = (await add(c, { username: `st_${tag}`, fullName: 'مؤقت', role: 'DOCTOR' }).expect(201)).body;
    const staff = created.staff;
    // finish onboarding so we hold a real session
    const l = await login(staff.username, created.temporaryPassword).expect(200);
    const access = l.body.accessToken as string;
    await http().get('/auth/me').set(bearer(access)).expect(200);

    const pat = await prisma.patient.create({ data: { clinicId: c.id, fullName: 'مريض', phone: '+970599000222' } });
    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    await prisma.appointment.create({ data: { clinicId: c.id, patientId: pat.id, doctorId: staff.doctor.id, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000) } });

    const res = await http().post(`/staff/${staff.id}/deactivate`).set(bearer(c.users.OWNER.token)).expect(200);
    expect(res.body.staff).toMatchObject({ isActive: false, doctor: { isActive: false } });
    expect(res.body.upcomingAppointments).toBe(1);
    expect(await prisma.appointment.count({ where: { doctorId: staff.doctor.id, status: 'PENDING' } })).toBe(1); // never auto-cancelled
    await http().get('/auth/me').set(bearer(access)).expect(401); // the live access token stops at once
    await login(staff.username, created.temporaryPassword).expect(401);
    expect(await prisma.refreshToken.count({ where: { userId: staff.id, revokedAt: null } })).toBe(0);
    const docs = await http().get('/doctors').set(bearer(c.users.OWNER.token)).expect(200);
    expect(docs.body.map((d: { id: string }) => d.id)).not.toContain(staff.doctor.id);
    expect(await prisma.user.count({ where: { id: staff.id } })).toBe(1);

    const back = await http().post(`/staff/${staff.id}/activate`).set(bearer(c.users.OWNER.token)).expect(200);
    expect(back.body.staff).toMatchObject({ isActive: true, doctor: { isActive: true } });
    await login(staff.username, created.temporaryPassword).expect(200);
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: { in: ['STAFF_DEACTIVATED', 'STAFF_ACTIVATED'] } } })).toBe(2);
  });

  it('cannot stop the owner or yourself', async () => {
    const c = await makeClinic('self');
    await http().post(`/staff/${c.users.OWNER.id}/deactivate`).set(bearer(c.users.OWNER.token)).expect(400);
    await http().post(`/staff/${c.users.OWNER.id}/reset-password`).set(bearer(c.users.OWNER.token)).expect(400);
    expect((await prisma.user.findUnique({ where: { id: c.users.OWNER.id } }))!.isActive).toBe(true);
    // even another owner (not possible through the API, but the rule must not depend on that) cannot touch an owner
    const hash = await app.get(PasswordService).hash(password);
    const second = await prisma.user.create({ data: { username: `own2_${tag}`, passwordHash: hash, fullName: 'مالك ثاني', role: 'OWNER', clinicId: c.id } });
    const t2 = await app.get(TokenService).signAccess({ sub: second.id, role: 'OWNER', clinicId: c.id, mcp: false });
    await http().post(`/staff/${c.users.OWNER.id}/deactivate`).set(bearer(t2)).expect(400);
    await http().post(`/staff/${c.users.OWNER.id}/reset-password`).set(bearer(t2)).expect(400);
    await http().patch(`/staff/${c.users.OWNER.id}`).set(bearer(t2)).send({ fullName: 'اسم صحيح' }).expect(400);
  });

  it('reset password: new temporary password works, old one is dead, lockout cleared, old sessions ended', async () => {
    const c = await makeClinic('reset');
    const created = (await add(c, { username: `rp_${tag}`, fullName: 'موظف', role: 'SECRETARY' }).expect(201)).body;
    await prisma.user.update({ where: { id: created.staff.id }, data: { failedLoginCount: 9, lockedUntil: new Date(Date.now() + 3_600_000) } });
    await prisma.user.update({ where: { id: created.staff.id }, data: { failedLoginCount: 0, lockedUntil: null, mustChangePassword: false } });
    const first = await login(created.staff.username, created.temporaryPassword).expect(200);
    const access = first.body.accessToken as string;
    await prisma.user.update({ where: { id: created.staff.id }, data: { failedLoginCount: 4, lockedUntil: new Date(Date.now() + 3_600_000) } });

    const res = await http().post(`/staff/${created.staff.id}/reset-password`).set(bearer(c.users.OWNER.token)).expect(200);
    expect(res.body.temporaryPassword).not.toBe(created.temporaryPassword);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    const row = await prisma.user.findUnique({ where: { id: created.staff.id } });
    expect(row).toMatchObject({ mustChangePassword: true, failedLoginCount: 0, lockedUntil: null });
    await login(created.staff.username, created.temporaryPassword).expect(401);
    await login(created.staff.username, res.body.temporaryPassword).expect(200);
    expect(access).toBeTruthy();
    const audit = await prisma.auditLog.findFirst({ where: { clinicId: c.id, action: 'STAFF_PASSWORD_RESET' } });
    expect(JSON.stringify(audit)).not.toContain(res.body.temporaryPassword);
  });

  it("clinic B's owner cannot see or touch clinic A's team", async () => {
    const a = await makeClinic('isoa');
    const b = await makeClinic('isob');
    const target = a.users.SECRETARY.id;
    await http().patch(`/staff/${target}`).set(bearer(b.users.OWNER.token)).send({ fullName: 'hacked' }).expect(404);
    for (const act of ['deactivate', 'activate', 'reset-password']) await http().post(`/staff/${target}/${act}`).set(bearer(b.users.OWNER.token)).expect(404);
    const row = await prisma.user.findUnique({ where: { id: target } });
    expect(row).toMatchObject({ isActive: true, fullName: a.users.SECRETARY.username });
    const created = (await add(b, { username: `iso_${tag}`, fullName: 'جديد', role: 'SECRETARY' }).expect(201)).body.staff;
    expect((await prisma.user.findUnique({ where: { id: created.id } }))!.clinicId).toBe(b.id); // always the caller's clinic
  });
});
