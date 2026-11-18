import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { TokenService } from '../src/auth/token.service.js';
import { ChequeStorage } from '../src/cheques/cheques.storage.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { Role } from '../src/generated/prisma/client.js';

// Real database. Creates its own clinics/users with random names and deletes them at the end.
describe('Cheques (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const clinicIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hebron' });
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Hebron' });

  type Who = 'OWNER' | 'DOC' | 'DOC2' | 'DOCNOKEY' | 'SECRETARY' | 'KEYHOLDER';
  async function makeClinic(name: string) {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}` } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash('Test-Pass-12345');
    const users = {} as Record<Who, { id: string; token: string }>;
    const defs: [Who, Role, boolean][] = [['OWNER', 'OWNER', true], ['DOC', 'DOCTOR', true], ['DOC2', 'DOCTOR', true], ['DOCNOKEY', 'DOCTOR', false], ['SECRETARY', 'SECRETARY', false], ['KEYHOLDER', 'SECRETARY', true]];
    for (const [key, role, canManagePayments] of defs) {
      const username = `${name}_${key}_${tag}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id, canManagePayments } });
      users[key] = { id: u.id, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }) };
    }
    const doc = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOC.id, fullName: 'Doc One' } });
    await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOC2.id, fullName: 'Doc Two' } });
    await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOCNOKEY.id, fullName: 'Doc Three' } });
    await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.OWNER.id, fullName: 'Owner Doc' } });
    const patient = await prisma.patient.create({ data: { clinicId: clinic.id, fullName: `Patient ${name}`, phone: '+970599000111' } });
    const type = await prisma.treatmentType.create({ data: { clinicId: clinic.id, name: 'حشوة' } });
    return { id: clinic.id, users, doc: doc.id, patient: patient.id, type: type.id };
  }
  type Clinic = Awaited<ReturnType<typeof makeClinic>>;

  const treat = async (c: Clinic, who: Who = 'DOC', totalCost = 100_000) =>
    (await http().post('/treatments').set(bearer(c.users[who].token)).send({ patientId: c.patient, teeth: [{ toothCode: 16, treatmentTypeId: c.type }], totalCost, plannedSessions: 1 }).expect(201)).body.id as string;
  const addCheque = (c: Clinic, who: Who, treatmentId: string, over: Record<string, unknown> = {}) =>
    http().post(`/treatments/${treatmentId}/cheques`).set(bearer(c.users[who].token)).send({ amount: 30_000, dueDate: inDays(10), ...over });
  const getT = async (c: Clinic, id: string) => (await http().get(`/treatments/${id}`).set(bearer(c.users.OWNER.token)).expect(200)).body;
  const income = async (c: Clinic) => (await http().get(`/expenses/summary?period=day&date=${today()}`).set(bearer(c.users.OWNER.token)).expect(200)).body.income as number;
  const png = (extra = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra, 7)]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    const w = { clinicId: { in: clinicIds } };
    const stored = await prisma.cheque.findMany({ where: w, select: { image: true } });
    for (const s of stored) if (s.image) await app.get(ChequeStorage).remove(s.image);
    await prisma.cheque.deleteMany({ where: w });
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

  it('a cheque is a payment: it lowers the balance at once, shows in the payments, but is not clinic income until it is cashed', async () => {
    const c = await makeClinic('chq1');
    const t = await treat(c);
    const r = (await addCheque(c, 'DOC', t, { chequeNumber: '٠٠١٢٣٤', bankName: 'بنك فلسطين', accountNumber: '55-77', drawerName: 'أبو أحمد', drawerPhone: '٠٥٩٩١٢٣٤٥٦', notes: 'ملاحظة' }).expect(201)).body;
    expect(r).toMatchObject({ status: 'PENDING', amount: 30_000, dueDate: inDays(10), chequeNumber: '001234', drawerPhone: '0599123456', direction: 'INCOMING', incomplete: false, due: 'later', hasImage: false });
    expect(r.patient.id).toBe(c.patient);
    expect(r.treatment.id).toBe(t);
    const detail = await getT(c, t);
    expect(detail).toMatchObject({ paid: 30_000, remaining: 70_000 });
    expect(detail.payments[0]).toMatchObject({ method: 'CHEQUE', amount: 30_000, status: 'ACTIVE', cheque: { id: r.id, status: 'PENDING' } });
    expect(await income(c)).toBe(0); // in hand: not income yet

    const done = (await http().post(`/cheques/${r.id}/cash`).set(bearer(c.users.OWNER.token)).send({}).expect(200)).body;
    expect(done).toMatchObject({ status: 'CASHED', due: null });
    expect(done.cashedAt).toBeTruthy();
    expect(await income(c)).toBe(30_000); // from the day it was cashed
    // a doctor's own income counts it too, and says it came from a cheque
    const mine = (await http().get(`/my-income?period=day&date=${today()}`).set(bearer(c.users.DOC.token)).expect(200)).body;
    expect(mine).toMatchObject({ income: 30_000, count: 1 });
    expect(mine.payments[0]).toMatchObject({ fromCheque: true });
    await http().post(`/cheques/${r.id}/cash`).set(bearer(c.users.OWNER.token)).send({}).expect(409); // already cashed
  });

  it('a cashed or returned cheque can no longer be edited; a pending one can (amount follows the payment)', async () => {
    const c = await makeClinic('chq2');
    const t = await treat(c);
    const r = (await addCheque(c, 'OWNER', t).expect(201)).body;
    const edited = (await http().patch(`/cheques/${r.id}`).set(bearer(c.users.OWNER.token)).send({ amount: 45_000, bankName: 'بنك القدس', notes: '' }).expect(200)).body;
    expect(edited).toMatchObject({ amount: 45_000, bankName: 'بنك القدس', notes: null });
    expect(await getT(c, t)).toMatchObject({ paid: 45_000, remaining: 55_000 });
    await http().patch(`/cheques/${r.id}`).set(bearer(c.users.OWNER.token)).send({ amount: 999_999 }).expect(400); // more than what is left
    await http().patch(`/cheques/${r.id}`).set(bearer(c.users.OWNER.token)).send({}).expect(400);
    await http().post(`/cheques/${r.id}/cash`).set(bearer(c.users.OWNER.token)).send({ cashedAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }).expect(400); // future
    await http().post(`/cheques/${r.id}/cash`).set(bearer(c.users.OWNER.token)).send({}).expect(200);
    await http().patch(`/cheques/${r.id}`).set(bearer(c.users.OWNER.token)).send({ amount: 1_000 }).expect(409);
    await http().post(`/cheques/${r.id}/return`).set(bearer(c.users.OWNER.token)).send({}).expect(409); // cashed money does not come back
    expect(await getT(c, t)).toMatchObject({ paid: 45_000 });
  });

  it('a returned cheque is not money: the payment is voided, the patient owes it again, a closed treatment reopens, and it stays listed as returned', async () => {
    const c = await makeClinic('chq3');
    const t = await treat(c, 'DOC', 50_000);
    const r = (await addCheque(c, 'DOC', t, { amount: 50_000 }).expect(201)).body;
    await http().post(`/treatments/${t}/sessions/1/complete`).set(bearer(c.users.DOC.token)).send({}).expect(200);
    await http().post(`/treatments/${t}/close`).set(bearer(c.users.DOC.token)).send({}).expect(200);
    expect((await getT(c, t)).status).toBe('CLOSED');

    const ret = (await http().post(`/cheques/${r.id}/return`).set(bearer(c.users.OWNER.token)).send({ reason: 'بدون رصيد' }).expect(200)).body;
    expect(ret).toMatchObject({ status: 'RETURNED', returnReason: 'بدون رصيد', due: null });
    const d = await getT(c, t);
    expect(d).toMatchObject({ status: 'OPEN', paid: 0, remaining: 50_000 });
    expect(d.payments[0]).toMatchObject({ status: 'VOIDED', voidReason: 'شك مرتجع' });
    expect(await income(c)).toBe(0);

    const list = (await http().get('/cheques').set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(list.items[0]).toMatchObject({ id: r.id, status: 'RETURNED', patient: { id: c.patient } });
    expect(list.totals).toMatchObject({ pending: { count: 0, amount: 0 }, returned: { count: 1, amount: 50_000 }, cashed: { count: 0 } });
    await http().post(`/cheques/${r.id}/return`).set(bearer(c.users.OWNER.token)).send({}).expect(409);
  });

  it('a cheque photographed without amount or date is incomplete: no payment, a reminder, and it completes later', async () => {
    const c = await makeClinic('chq4');
    const t = await treat(c);
    const r = (await http().post(`/treatments/${t}/cheques`).set(bearer(c.users.DOC.token)).send({}).expect(201)).body;
    expect(r).toMatchObject({ status: 'PENDING', amount: null, dueDate: null, incomplete: true, due: null });
    expect(await getT(c, t)).toMatchObject({ paid: 0, remaining: 100_000 });
    const s = (await http().get('/cheques/summary').set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(s).toMatchObject({ incomplete: 1, pending: { count: 0, amount: 0 } });
    await http().post(`/cheques/${r.id}/cash`).set(bearer(c.users.OWNER.token)).send({}).expect(409); // complete it first

    // only the amount: still incomplete, no payment
    const half = (await http().patch(`/cheques/${r.id}`).set(bearer(c.users.DOC.token)).send({ amount: 20_000 }).expect(200)).body;
    expect(half).toMatchObject({ incomplete: true, amount: 20_000 });
    expect(await getT(c, t)).toMatchObject({ paid: 0 });
    // now the date: it becomes a real payment
    const full = (await http().patch(`/cheques/${r.id}`).set(bearer(c.users.DOC.token)).send({ dueDate: today() }).expect(200)).body;
    expect(full).toMatchObject({ incomplete: false, due: 'today' });
    expect(await getT(c, t)).toMatchObject({ paid: 20_000, remaining: 80_000 });
    const s2 = (await http().get('/cheques/summary').set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect(s2).toMatchObject({ incomplete: 0, dueToday: { count: 1, amount: 20_000 }, overdue: { count: 0 }, pending: { count: 1, amount: 20_000 } });

    // a photo by mistake can be cancelled (nothing behind it), a complete one cannot
    const mistake = (await http().post(`/treatments/${t}/cheques`).set(bearer(c.users.DOC.token)).send({}).expect(201)).body;
    expect((await http().post(`/cheques/${mistake.id}/cancel`).set(bearer(c.users.DOC.token)).expect(200)).body.status).toBe('CANCELLED');
    await http().post(`/cheques/${r.id}/cancel`).set(bearer(c.users.DOC.token)).expect(409);
    expect((await http().get('/cheques/summary').set(bearer(c.users.OWNER.token)).expect(200)).body.incomplete).toBe(0);
  });

  it('a cheque whose day has passed and is not cashed is flagged overdue', async () => {
    const c = await makeClinic('chq5');
    const t = await treat(c);
    const r = (await addCheque(c, 'OWNER', t, { dueDate: inDays(-2) }).expect(201)).body;
    expect(r.due).toBe('overdue');
    expect((await http().get('/cheques/summary').set(bearer(c.users.OWNER.token)).expect(200)).body).toMatchObject({ overdue: { count: 1, amount: 30_000 } });
  });

  it('who may touch cheques: same as payments, and a doctor only on their own treatments', async () => {
    const c = await makeClinic('chq6');
    const t = await treat(c, 'DOC');
    // no payments key: no access at all
    await addCheque(c, 'SECRETARY', t).expect(403);
    await addCheque(c, 'DOCNOKEY', t).expect(403);
    await http().get('/cheques').set(bearer(c.users.SECRETARY.token)).expect(403);
    // another doctor (even with the key) cannot add to a colleague's treatment
    await addCheque(c, 'DOC2', t).expect(403);
    const r = (await addCheque(c, 'DOC', t).expect(201)).body;
    // ... nor see, edit, cash or open the photo of it
    await http().get(`/cheques/${r.id}`).set(bearer(c.users.DOC2.token)).expect(404);
    await http().patch(`/cheques/${r.id}`).set(bearer(c.users.DOC2.token)).send({ notes: 'x' }).expect(404);
    await http().post(`/cheques/${r.id}/cash`).set(bearer(c.users.DOC2.token)).send({}).expect(404);
    expect((await http().get('/cheques').set(bearer(c.users.DOC2.token)).expect(200)).body.items).toHaveLength(0);
    expect((await http().get('/cheques').set(bearer(c.users.DOC.token)).expect(200)).body.items).toHaveLength(1);
    // the owner and the key holder see the whole clinic
    for (const who of ['OWNER', 'KEYHOLDER'] as const) expect((await http().get('/cheques').set(bearer(c.users[who].token)).expect(200)).body.items).toHaveLength(1);
    await http().post(`/cheques/${r.id}/cash`).set(bearer(c.users.KEYHOLDER.token)).send({}).expect(200);
    // a cheque cannot be added through the ordinary payment route
    const t2 = await treat(c, 'DOC');
    await http().post(`/treatments/${t2}/payments`).set(bearer(c.users.OWNER.token)).send({ amount: 100, method: 'CHEQUE', paidAt: new Date().toISOString() }).expect(400);
    await http().get('/cheques').expect(401);
  });

  it('validation: needs a real amount (not more than what is left), a real date, no duplicate cheque, a closed treatment takes none', async () => {
    const c = await makeClinic('chq7');
    const t = await treat(c, 'OWNER', 100_000);
    await addCheque(c, 'OWNER', t, { amount: 0 }).expect(400);
    await addCheque(c, 'OWNER', t, { amount: 100_001 }).expect(400);
    await addCheque(c, 'OWNER', t, { dueDate: '2026-13-45' }).expect(400);
    await addCheque(c, 'OWNER', t, { dueDate: 'غدا' }).expect(400);
    await addCheque(c, 'OWNER', t, { surprise: 1 }).expect(400);
    await addCheque(c, 'OWNER', t, { chequeNumber: '777', accountNumber: '1-2-3', bankName: 'بنك' }).expect(201);
    await addCheque(c, 'OWNER', t, { chequeNumber: '٧٧٧', accountNumber: '1-2-3', bankName: 'بنك' }).expect(409); // same cheque, Arabic digits
    await addCheque(c, 'OWNER', t, { chequeNumber: '778', accountNumber: '1-2-3', bankName: 'بنك' }).expect(201); // another number is fine
    await addCheque(c, 'OWNER', t, { amount: 40_001 }).expect(400); // 60,000 + ... : only 40,000 left
    await http().post(`/treatments/${randomUUID()}/cheques`).set(bearer(c.users.OWNER.token)).send({}).expect(404);
  });

  it('the photo: png/jpg/webp only, kept with the cheque, opened only by a login of the same clinic that may see it', async () => {
    const c = await makeClinic('chq8');
    const other = await makeClinic('chq8b');
    const t = await treat(c);
    const r = (await addCheque(c, 'DOC', t).expect(201)).body;
    await http().post(`/cheques/${r.id}/image`).set(bearer(c.users.DOC.token)).set('Content-Type', 'image/png').send(Buffer.from('not an image at all')).expect(415);
    const img = png(400);
    const up = (await http().post(`/cheques/${r.id}/image`).set(bearer(c.users.DOC.token)).set('Content-Type', 'image/png').send(img).expect(200)).body;
    expect(up.hasImage).toBe(true);
    expect(up).not.toHaveProperty('image'); // the stored file name is never exposed
    const res = await http().get(`/cheques/${r.id}/image`).set(bearer(c.users.OWNER.token)).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body as Buffer, img)).toBe(0);
    await http().get(`/cheques/${r.id}/image`).set(bearer(c.users.DOC2.token)).expect(404); // a colleague's cheque
    await http().get(`/cheques/${r.id}/image`).set(bearer(other.users.OWNER.token)).expect(404); // another clinic
    await http().get(`/cheques/${r.id}/image`).expect(401);
    await http().post(`/cheques/${r.id}/cash`).set(bearer(c.users.OWNER.token)).send({}).expect(200);
    await http().post(`/cheques/${r.id}/image`).set(bearer(c.users.OWNER.token)).set('Content-Type', 'image/png').send(png(50)).expect(409); // cashed: frozen
    // another clinic can never see or touch it
    await http().get(`/cheques/${r.id}`).set(bearer(other.users.OWNER.token)).expect(404);
    await http().post(`/cheques/${r.id}/return`).set(bearer(other.users.OWNER.token)).send({}).expect(404);
    expect((await http().get('/cheques').set(bearer(other.users.OWNER.token)).expect(200)).body.items).toHaveLength(0);
  });

  it('the list filters by status, incomplete, patient, treatment and a search word; the months report counts a cheque in the month it was cashed', async () => {
    const c = await makeClinic('chq9');
    const t = await treat(c, 'OWNER', 200_000);
    const a = (await addCheque(c, 'OWNER', t, { amount: 10_000, drawerName: 'سامي' }).expect(201)).body;
    await addCheque(c, 'OWNER', t, { amount: 20_000, drawerName: 'ليلى', chequeNumber: '4455' }).expect(201);
    await http().post(`/treatments/${t}/cheques`).set(bearer(c.users.OWNER.token)).send({}).expect(201);
    await http().post(`/cheques/${a.id}/cash`).set(bearer(c.users.OWNER.token)).send({}).expect(200);
    const q = async (qs: string) => (await http().get(`/cheques?${qs}`).set(bearer(c.users.OWNER.token)).expect(200)).body;
    expect((await q('')).items).toHaveLength(3);
    expect((await q('status=CASHED')).items.map((x: { id: string }) => x.id)).toEqual([a.id]);
    expect((await q('status=PENDING')).items).toHaveLength(2);
    expect((await q('incomplete=true')).items).toHaveLength(1);
    expect((await q('q=ليلى')).items).toHaveLength(1);
    expect((await q('q=4455')).items).toHaveLength(1);
    expect((await q(`patientId=${c.patient}`)).items).toHaveLength(3);
    expect((await q(`treatmentId=${t}`)).items).toHaveLength(3);
    expect((await q(`treatmentId=${randomUUID()}`)).items).toHaveLength(0);
    expect((await q('direction=OUTGOING')).items).toHaveLength(0);
    expect((await q('')).totals).toMatchObject({ pending: { count: 1, amount: 20_000 }, cashed: { count: 1, amount: 10_000 }, incomplete: 1 });
    await http().get('/cheques?status=NOPE').set(bearer(c.users.OWNER.token)).expect(400);
    const months = (await http().get(`/expenses/months?year=${today().slice(0, 4)}`).set(bearer(c.users.OWNER.token)).expect(200)).body as { month: string; income: number }[];
    expect(months.find((m) => m.month === today().slice(0, 7))?.income).toBe(10_000); // only the cashed one
    // the owner is also a doctor here: the cashed cheque on his own treatment counts in his own income (and a pending one does not)
    expect((await http().get(`/my-income?period=day&date=${today()}`).set(bearer(c.users.OWNER.token)).expect(200)).body).toMatchObject({ income: 10_000, count: 1 });
    expect((await http().get(`/my-income/months?year=${today().slice(0, 4)}`).set(bearer(c.users.OWNER.token)).expect(200)).body.find((m: { month: string }) => m.month === today().slice(0, 7)).income).toBe(10_000);
    // ... and NOT in a colleague's income
    expect((await http().get(`/my-income?period=day&date=${today()}`).set(bearer(c.users.DOC2.token)).expect(200)).body).toMatchObject({ income: 0, count: 0 });
  });
});
