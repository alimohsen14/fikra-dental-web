import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { TokenService } from '../src/auth/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { Role } from '../src/generated/prisma/client.js';
import { XrayStorage } from '../src/xrays/xrays.storage.js';

// Real database. Creates its own clinics/users with random names and deletes them at the end.
describe('X-rays (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const clinicIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const now = () => new Date().toISOString();


  async function makeClinic(name: string) {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}` } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash('Test-Pass-12345');
    const users = {} as Record<'OWNER' | 'DOCTOR' | 'DOCTOR2' | 'SECRETARY' | 'KEYHOLDER', { id: string; token: string }>;
    const defs: [keyof typeof users, Role, boolean][] = [['OWNER', 'OWNER', true], ['DOCTOR', 'DOCTOR', false], ['DOCTOR2', 'DOCTOR', false], ['SECRETARY', 'SECRETARY', false], ['KEYHOLDER', 'SECRETARY', true]];
    for (const [key, role, canManagePayments] of defs) {
      const username = `${name}_${key}_${tag}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id, canManagePayments } });
      users[key] = { id: u.id, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }) };
    }
    const docOwner = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.OWNER.id, fullName: 'Owner Doc' } });
    const doc1 = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOCTOR.id, fullName: 'Doc One' } });
    const doc2 = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOCTOR2.id, fullName: 'Doc Two' } });
    const patient = await prisma.patient.create({ data: { clinicId: clinic.id, fullName: `Patient ${name}`, phone: '+970599000111' } });
    const type = await prisma.treatmentType.create({ data: { clinicId: clinic.id, name: 'حشوة' } });
    return { id: clinic.id, users, docOwner: docOwner.id, doc1: doc1.id, doc2: doc2.id, patient: patient.id, type: type.id };
  }
  type Clinic = Awaited<ReturnType<typeof makeClinic>>;

  /** Shortcut: `toothCodes` (+ optional `treatmentTypeId`) become teeth that all share one type; pass `teeth` for per-tooth types. */
  const body = (c: Clinic, over: Record<string, unknown> = {}) => {
    const { toothCodes = [16], treatmentTypeId = c.type, ...rest } = over as { toothCodes?: unknown[]; treatmentTypeId?: unknown } & Record<string, unknown>;
    return { patientId: c.patient, teeth: toothCodes.map((toothCode) => ({ toothCode, treatmentTypeId })), totalCost: 100_000, plannedSessions: 2, ...rest };
  };
  const create = (token: string, c: Clinic, over: Record<string, unknown> = {}) => http().post('/treatments').set(bearer(token)).send(body(c, over));
  const pay = (token: string, id: string, over: Record<string, unknown> = {}) => http().post(`/treatments/${id}/payments`).set(bearer(token)).send({ amount: 10_000, method: 'CASH', paidAt: now(), ...over });
  const close = (token: string, id: string) => http().post(`/treatments/${id}/close`).set(bearer(token)).send({});
  const complete = (token: string, id: string, n: number) => http().post(`/treatments/${id}/sessions/${n}/complete`).set(bearer(token)).send({});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    const w = { clinicId: { in: clinicIds } };
    const stored = await prisma.xRay.findMany({ where: w, select: { file: true } });
    for (const s of stored) await app.get(XrayStorage).remove(s.file);
    await prisma.xRay.deleteMany({ where: w });
    await prisma.payment.deleteMany({ where: w });
    await prisma.session.deleteMany({ where: w });
    await prisma.treatmentTooth.deleteMany({ where: w });
    await prisma.treatment.deleteMany({ where: w });
    await prisma.treatmentType.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: w });
    await prisma.appointment.deleteMany({ where: w });
    await prisma.patient.deleteMany({ where: w });
    await prisma.doctorWorkingPeriod.deleteMany({ where: w });
    await prisma.doctor.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });


  const png = (extra = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra, 7)]);
  const upload = (token: string, id: string, data: Buffer, type = 'image/png', q = '') => http().post(`/treatments/${id}/xrays${q}`).set(bearer(token)).set('Content-Type', type).send(data);

  it('the owner and any doctor add an X-ray to a treatment; it lists on the treatment and on the patient; only a login of this clinic can open the image', async () => {
    const c = await makeClinic('xray');
    const t = (await create(c.users.DOCTOR.token, c).expect(201)).body;
    const img = png(500);
    const a = (await upload(c.users.DOCTOR2.token, t.id, img, 'image/png', '?note=' + encodeURIComponent('بانوراما')).expect(201)).body;
    expect(a).toMatchObject({ treatmentId: t.id, patientId: c.patient, note: 'بانوراما', size: img.length });
    await upload(c.users.OWNER.token, t.id, png(100)).expect(201);

    for (const path of [`/treatments/${t.id}/xrays`, `/patients/${c.patient}/xrays`]) {
      for (const who of ['OWNER', 'DOCTOR', 'SECRETARY'] as const) {
        const list = (await http().get(path).set(bearer(c.users[who].token)).expect(200)).body;
        expect(list).toHaveLength(2);
      }
    }
    const list = (await http().get(`/patients/${c.patient}/xrays`).set(bearer(c.users.SECRETARY.token)).expect(200)).body;
    expect(list[0]).toHaveProperty('uploadedBy.fullName');
    expect(list.map((x: { id: string }) => x.id)).toContain(a.id);

    const res = await http().get(`/xrays/${a.id}/file`).set(bearer(c.users.SECRETARY.token)).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body as Buffer, img)).toBe(0);
    await http().get(`/xrays/${a.id}/file`).expect(401);

    // a secretary can look but never add or remove
    await upload(c.users.SECRETARY.token, t.id, png()).expect(403);
    await upload(c.users.KEYHOLDER.token, t.id, png()).expect(403);
    await http().delete(`/xrays/${a.id}`).set(bearer(c.users.SECRETARY.token)).expect(403);
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: 'XRAY_ADDED' } })).toBe(2);
  });

  it('refuses what is not an image, too big files, long notes, unknown or cancelled treatments', async () => {
    const c = await makeClinic('xrayrules');
    const o = c.users.OWNER.token;
    const t = (await create(o, c).expect(201)).body;
    await upload(o, t.id, Buffer.from('%PDF-1.4 not an image at all, just text'), 'application/pdf').expect(415);
    await upload(o, t.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml').expect(415);
    await upload(o, t.id, png(11 * 1024 * 1024)).expect(413);
    await upload(o, t.id, png(), 'image/png', '?note=' + 'x'.repeat(201)).expect(400);
    await upload(o, t.id, png(), 'image/png', '?other=1').expect(400);
    await upload(o, randomUUID(), png()).expect(404);
    await upload(o, 'nope', png()).expect(400);
    expect(await prisma.xRay.count({ where: { clinicId: c.id } })).toBe(0);
    await http().post(`/treatments/${t.id}/cancel`).set(bearer(o)).send({}).expect(200);
    await upload(o, t.id, png()).expect(409);
  });

  it('only the owner or the doctor who added an X-ray removes it; the file goes too; another clinic sees nothing', async () => {
    const c = await makeClinic('xraydel');
    const t = (await create(c.users.DOCTOR.token, c).expect(201)).body;
    const mine = (await upload(c.users.DOCTOR.token, t.id, png()).expect(201)).body;
    const other = (await upload(c.users.DOCTOR.token, t.id, png(80)).expect(201)).body;
    const storage = app.get(XrayStorage);
    const fileOf = async (id: string) => storage.pathOf((await prisma.xRay.findUniqueOrThrow({ where: { id } })).file)!;
    const path = await fileOf(mine.id);
    expect(existsSync(path)).toBe(true);

    await http().delete(`/xrays/${mine.id}`).set(bearer(c.users.DOCTOR2.token)).expect(403);
    expect(existsSync(path)).toBe(true);

    const b = await makeClinic('xraydelb');
    const bo = b.users.OWNER.token;
    await http().get(`/xrays/${mine.id}/file`).set(bearer(bo)).expect(404);
    await http().get(`/treatments/${t.id}/xrays`).set(bearer(bo)).expect(404);
    await http().get(`/patients/${c.patient}/xrays`).set(bearer(bo)).expect(404);
    await http().delete(`/xrays/${mine.id}`).set(bearer(bo)).expect(404);
    await upload(bo, t.id, png()).expect(404);

    await http().delete(`/xrays/${mine.id}`).set(bearer(c.users.DOCTOR.token)).expect(200);
    expect(existsSync(path)).toBe(false);
    await http().get(`/xrays/${mine.id}/file`).set(bearer(c.users.OWNER.token)).expect(404);
    await http().delete(`/xrays/${other.id}`).set(bearer(c.users.OWNER.token)).expect(200);
    expect(await prisma.auditLog.count({ where: { clinicId: c.id, action: 'XRAY_DELETED' } })).toBe(2);
    expect((await http().get(`/patients/${c.patient}/xrays`).set(bearer(c.users.OWNER.token)).expect(200)).body).toEqual([]);
  });
});
