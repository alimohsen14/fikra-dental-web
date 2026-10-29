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

// These tests run against the REAL database. They create their own clinics/users with random
// names and delete them at the end, so they never touch your seed data.
describe('Patients API + clinic isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const clinics: Record<'noor' | 'amal', string> = { noor: '', amal: '' };
  const token: Record<string, string> = {};
  const password = 'Test-Pass-12345';

  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });

  async function makeUser(
    key: string,
    role: Role,
    clinicId: string | null,
    extra: { mustChangePassword?: boolean } = {},
  ) {
    const passwords = app.get(PasswordService);
    const user = await prisma.user.create({
      data: {
        username: `${key.toLowerCase()}_${tag}`,
        passwordHash: await passwords.hash(password),
        fullName: key,
        role,
        clinicId,
        ...extra,
      },
    });
    token[key] = await app.get(TokenService).signAccess({
      sub: user.id,
      role,
      clinicId,
      mcp: extra.mustChangePassword ?? false,
    });
    return user;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    clinics.noor = (await prisma.clinic.create({ data: { name: `noor-${tag}` } })).id;
    clinics.amal = (await prisma.clinic.create({ data: { name: `amal-${tag}` } })).id;

    await makeUser('noorOwner', 'OWNER', clinics.noor);
    await makeUser('noorDoctor', 'DOCTOR', clinics.noor);
    await makeUser('noorSecretary', 'SECRETARY', clinics.noor);
    await makeUser('amalOwner', 'OWNER', clinics.amal);
    await makeUser('amalDoctor', 'DOCTOR', clinics.amal);
    await makeUser('platform', 'PLATFORM_ADMIN', null);
    await makeUser('mustChange', 'OWNER', clinics.noor, { mustChangePassword: true });
  }, 60_000);

  afterAll(async () => {
    const ids = Object.values(clinics);
    await prisma.patient.deleteMany({ where: { clinicId: { in: ids } } });
    await prisma.user.deleteMany({ where: { OR: [{ clinicId: { in: ids } }, { username: { endsWith: `_${tag}` } }] } });
    await prisma.clinic.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  let noorPatientId: string;
  let amalPatientId: string;

  it('real login works end to end', async () => {
    const res = await http().post('/auth/login').send({ username: `noorowner_${tag}`, password }).expect(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.clinicId).toBe(clinics.noor);
  });

  it('requires login, and a changed password', async () => {
    await http().get('/patients').expect(401);
    const res = await http().get('/patients').set(as('mustChange')).expect(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('platform admin cannot touch patient data at all', async () => {
    await http().get('/patients').set(as('platform')).expect(403);
    await http().post('/patients').set(as('platform')).send({ fullName: 'Hack Attempt', phone: '0599000000' }).expect(403);
  });

  it('creates patients; the clinic comes from the token, not the body', async () => {
    const a = await http().post('/patients').set(as('noorSecretary'))
      .send({ fullName: 'مريض النور', phone: '0599123456', nationalId: '400000001', gender: 'MALE', birthDate: '1990-05-01', notes: 'ملاحظة' })
      .expect(201);
    noorPatientId = a.body.patient.id;
    expect(a.body.patient.clinicId).toBe(clinics.noor);
    expect(a.body.patient.phone).toBe('+970599123456');

    const b = await http().post('/patients').set(as('amalOwner'))
      .send({ fullName: 'مريض الأمل', phone: '+970599123456', nationalId: '400000001' }) // same phone and same national ID as Noor's: allowed in another clinic
      .expect(201);
    amalPatientId = b.body.patient.id;
    expect(b.body.patient.clinicId).toBe(clinics.amal);

    // Trying to smuggle a clinicId is rejected outright.
    await http().post('/patients').set(as('noorOwner'))
      .send({ fullName: 'Smuggler', phone: '0599111111', clinicId: clinics.amal }).expect(400);
  });

  it('Noor never sees Amal patients in lists or searches, and vice versa', async () => {
    const noor = await http().get('/patients').set(as('noorOwner')).expect(200);
    expect(noor.body.items.map((p: { id: string }) => p.id)).toEqual([noorPatientId]);
    expect(noor.body.total).toBe(1);

    const amal = await http().get('/patients').set(as('amalDoctor')).expect(200);
    expect(amal.body.items.map((p: { id: string }) => p.id)).toEqual([amalPatientId]);

    const search = await http().get('/patients?q=الأمل').set(as('noorOwner')).expect(200);
    expect(search.body.items).toHaveLength(0);
    const byPhone = await http().get('/patients?q=599123').set(as('noorOwner')).expect(200);
    expect(byPhone.body.items.map((p: { id: string }) => p.id)).toEqual([noorPatientId]);
  });

  it('Noor cannot read, edit or archive an Amal patient (looks like it does not exist)', async () => {
    await http().get(`/patients/${amalPatientId}`).set(as('noorOwner')).expect(404);
    await http().patch(`/patients/${amalPatientId}`).set(as('noorOwner')).send({ fullName: 'Hijacked' }).expect(404);
    await http().post(`/patients/${amalPatientId}/archive`).set(as('noorOwner')).expect(404);

    const row = await prisma.patient.findUniqueOrThrow({ where: { id: amalPatientId } });
    expect(row.fullName).toBe('مريض الأمل');
    expect(row.archivedAt).toBeNull();
    expect(row.clinicId).toBe(clinics.amal);
  });

  it('a patient cannot be moved to another clinic through update', async () => {
    await http().patch(`/patients/${noorPatientId}`).set(as('noorOwner')).send({ clinicId: clinics.amal }).expect(400);
    const row = await prisma.patient.findUniqueOrThrow({ where: { id: noorPatientId } });
    expect(row.clinicId).toBe(clinics.noor);
  });

  it('everyone in the same clinic shares the patient records', async () => {
    for (const who of ['noorOwner', 'noorDoctor', 'noorSecretary']) {
      const res = await http().get(`/patients/${noorPatientId}`).set(as(who)).expect(200);
      expect(res.body.fullName).toBe('مريض النور');
    }
  });

  it('national ID is unique inside a clinic only', async () => {
    await http().post('/patients').set(as('noorOwner'))
      .send({ fullName: 'Duplicate Id', phone: '0599222222', nationalId: '400000001' }).expect(409);
  });

  it('duplicate phone only warns (families share phones)', async () => {
    const res = await http().post('/patients').set(as('noorOwner'))
      .send({ fullName: 'ابن العائلة', phone: '059-912-3456' }).expect(201);
    expect(res.body.sharedPhoneWith.map((p: { id: string }) => p.id)).toEqual([noorPatientId]);
  });

  it('rejects invalid input', async () => {
    await http().post('/patients').set(as('noorOwner')).send({ fullName: 'x', phone: '0599333333' }).expect(400);
    await http().post('/patients').set(as('noorOwner')).send({ fullName: 'Valid Name', phone: '123' }).expect(400);
    await http().post('/patients').set(as('noorOwner')).send({ fullName: 'Valid Name' }).expect(400);
    await http().get('/patients/not-a-uuid').set(as('noorOwner')).expect(400);
  });

  it('updates, archives and unarchives (never deletes)', async () => {
    const upd = await http().patch(`/patients/${noorPatientId}`).set(as('noorDoctor'))
      .send({ notes: null, phone: '0568000000' }).expect(200);
    expect(upd.body.notes).toBeNull();
    expect(upd.body.phone).toBe('+970568000000');

    await http().post(`/patients/${noorPatientId}/archive`).set(as('noorOwner')).expect(200);
    const hidden = await http().get('/patients').set(as('noorOwner')).expect(200);
    expect(hidden.body.items.map((p: { id: string }) => p.id)).not.toContain(noorPatientId);
    const archived = await http().get('/patients?archived=true').set(as('noorOwner')).expect(200);
    expect(archived.body.items.map((p: { id: string }) => p.id)).toEqual([noorPatientId]);

    await http().post(`/patients/${noorPatientId}/unarchive`).set(as('noorOwner')).expect(200);
    expect(await prisma.patient.count({ where: { id: noorPatientId } })).toBe(1);
  });
});
