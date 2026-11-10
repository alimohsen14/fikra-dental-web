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
import { instantAt, localDate } from '../src/scheduling/clinic-time.js';

// Real database. Creates its own clinics/users with random names and deletes them at the end.
describe('No dates in the future for money or treatments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const clinicIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const now = () => new Date().toISOString();
  const today = () => localDate(new Date(), 'Asia/Hebron');

  async function makeClinic(name: string) {
    const clinic = await prisma.clinic.create({ data: { name: `${name}-${tag}` } });
    clinicIds.push(clinic.id);
    const hash = await app.get(PasswordService).hash('Test-Pass-12345');
    const users = {} as Record<'OWNER' | 'DOCTOR' | 'SECRETARY', { id: string; token: string }>;
    const defs: [keyof typeof users, Role][] = [['OWNER', 'OWNER'], ['DOCTOR', 'DOCTOR'], ['SECRETARY', 'SECRETARY']];
    for (const [key, role] of defs) {
      const username = `${name}_${key}_${tag}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, passwordHash: hash, fullName: username, role, clinicId: clinic.id, canManagePayments: true } });
      users[key] = { id: u.id, token: await app.get(TokenService).signAccess({ sub: u.id, role, clinicId: clinic.id, mcp: false }) };
    }
    const doc = await prisma.doctor.create({ data: { clinicId: clinic.id, userId: users.DOCTOR.id, fullName: 'Doc' } });
    const patient = await prisma.patient.create({ data: { clinicId: clinic.id, fullName: 'P', phone: '+970599000111' } });
    const type = await prisma.treatmentType.create({ data: { clinicId: clinic.id, name: 'حشوة' } });
    return { id: clinic.id, users, doc: doc.id, patient: patient.id, type: type.id };
  }
  type Clinic = Awaited<ReturnType<typeof makeClinic>>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    const w = { clinicId: { in: clinicIds } };
    await prisma.messageLog.deleteMany({ where: w });
    await prisma.session.deleteMany({ where: w });
    await prisma.appointment.deleteMany({ where: w });
    await prisma.doctorWorkingPeriod.deleteMany({ where: w });
    await prisma.salaryPayment.deleteMany({ where: w });
    await prisma.salaryEntry.deleteMany({ where: w });
    await prisma.expensePayment.deleteMany({ where: w });
    await prisma.expense.deleteMany({ where: w });
    await prisma.supplier.deleteMany({ where: w });
    await prisma.expenseCategory.deleteMany({ where: w });
    await prisma.payment.deleteMany({ where: w });
    await prisma.session.deleteMany({ where: w });
    await prisma.treatmentTooth.deleteMany({ where: w });
    await prisma.treatment.deleteMany({ where: w });
    await prisma.treatmentType.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: w });
    await prisma.patient.deleteMany({ where: w });
    await prisma.doctor.deleteMany({ where: w });
    await prisma.user.deleteMany({ where: w });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await app.close();
  });


  const later = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

  it('expenses, their payments, salary payments, treatment payments and treatment start dates all refuse the future; appointments are not touched', async () => {
    const c = await makeClinic('future');
    const o = bearer(c.users.OWNER.token);
    const d = bearer(c.users.DOCTOR.token);
    const category = (await http().post('/expense-categories').set(o).send({ name: 'كهرباء' }).expect(201)).body.id as string;
    // expenses
    await http().post('/expenses').set(o).send({ categoryId: category, amount: 10_000, incurredAt: later(26) }).expect(400);
    const e = (await http().post('/expenses').set(o).send({ categoryId: category, amount: 10_000, incurredAt: now(), paidAmount: 0 }).expect(201)).body;
    await http().patch(`/expenses/${e.id}`).set(o).send({ incurredAt: later(26) }).expect(400);
    await http().post(`/expenses/${e.id}/payments`).set(o).send({ amount: 100, method: 'CASH', paidAt: later(26) }).expect(400);
    await http().post(`/expenses/${e.id}/payments`).set(o).send({ amount: 100, method: 'CASH', paidAt: now() }).expect(201);
    // salaries
    await http().patch(`/salaries/staff/${c.users.DOCTOR.id}`).set(o).send({ monthlySalary: 100_000 }).expect(200);
    const month = (await http().get(`/salaries?month=${today().slice(0, 7)}`).set(o).expect(200)).body;
    const entry = month.entries.find((x: { userId: string }) => x.userId === c.users.DOCTOR.id);
    await http().post(`/salaries/${entry.id}/payments`).set(o).send({ kind: 'ADVANCE', amount: 100, method: 'CASH', paidAt: later(26) }).expect(400);
    await http().post(`/salaries/${entry.id}/payments`).set(o).send({ kind: 'ADVANCE', amount: 100, method: 'CASH', paidAt: now() }).expect(201);
    // treatments
    const body = { patientId: c.patient, doctorId: c.doc, teeth: [{ toothCode: 16, treatmentTypeId: c.type }], totalCost: 50_000, plannedSessions: 1 };
    await http().post('/treatments').set(d).send({ ...body, startedAt: later(26) }).expect(400);
    const t = (await http().post('/treatments').set(d).send({ ...body, startedAt: now() }).expect(201)).body;
    await http().post(`/treatments/${t.id}/payments`).set(o).send({ amount: 100, method: 'CASH', paidAt: later(26) }).expect(400);
    await http().post(`/treatments/${t.id}/payments`).set(o).send({ amount: 100, method: 'CASH', paidAt: now() }).expect(201);
    // nothing future was saved
    expect(await prisma.expensePayment.count({ where: { clinicId: c.id, paidAt: { gt: new Date(Date.now() + 600_000) } } })).toBe(0);
    expect(await prisma.salaryPayment.count({ where: { clinicId: c.id, paidAt: { gt: new Date(Date.now() + 600_000) } } })).toBe(0);
    expect(await prisma.payment.count({ where: { clinicId: c.id, paidAt: { gt: new Date(Date.now() + 600_000) } } })).toBe(0);
    expect(await prisma.expense.count({ where: { clinicId: c.id, incurredAt: { gt: new Date(Date.now() + 600_000) } } })).toBe(0);
    // appointments may still be booked in the future (week ahead, inside the clinic hours)
    const day = localDate(new Date(Date.now() + 7 * 86_400_000), 'Asia/Hebron');
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    await prisma.doctorWorkingPeriod.create({ data: { clinicId: c.id, doctorId: c.doc, weekday, startMinute: 480, endMinute: 1080 } });
    await http().post('/appointments').set(o).send({ patientId: c.patient, doctorId: c.doc, startsAt: instantAt(day, 540, 'Asia/Hebron').toISOString(), durationMinutes: 30 }).expect(201);
  });
});
