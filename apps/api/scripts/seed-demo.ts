// Demo data for manual testing of EVERYTHING. Development only.
//   pnpm --filter api seed:demo
// Run it on an EMPTY database (see the reset command in the guide). It creates 5 clinics in different subscription states, every kind of
// user, patients, appointments in every state, treatments in every state, payments, expenses, salaries, X-rays and WhatsApp messages.
// Everything is dated relative to "now", so it is always fresh. All passwords: Demo-Pass-12345 (except the two special users, see the printout).
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { PrismaPg } from '@prisma/adapter-pg';
import { PasswordService } from '../src/auth/password.service.js';
import { getPublicWebUrl, getUploadDir } from '../src/config/env.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { addDaysTo, instantAt, localDate } from '../src/scheduling/clinic-time.js';

if (process.env.NODE_ENV === 'production') throw new Error('The demo seed is for development only');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const PASSWORD = 'Demo-Pass-12345';
const TZ = 'Asia/Hebron';
const DAY = 86_400_000;
const MIN = 60_000;
const ils = (n: number) => Math.round(n * 100); // money is stored in agorot

const today = localDate(new Date(), TZ);
const day = (offset: number) => addDaysTo(today, offset);
/** An instant on a day (offset from today) at hh:mm, clinic time. */
const at = (offset: number, hh: number, mm = 0) => instantAt(day(offset), hh * 60 + mm, TZ);
const ago = (days: number, hh = 11) => at(-days, hh);
const monthOf = (monthsBack: number) => {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** A day in a past month (clamped to the 1st..27th so it exists in every month). */
const inMonth = (monthsBack: number, dom: number, hh = 12) => {
  const [y, m] = monthOf(monthsBack).split('-').map(Number) as [number, number];
  return instantAt(`${y}-${String(m).padStart(2, '0')}-${String(Math.min(dom, 27)).padStart(2, '0')}`, hh * 60, TZ);
};
const roundDown5 = (d: Date) => new Date(Math.floor(d.getTime() / (5 * MIN)) * 5 * MIN);

type Role = 'OWNER' | 'DOCTOR' | 'SECRETARY';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ a tiny grayscale PNG, so the X-rays are real pictures
function xrayPng(w: number, h: number, seed: number): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w + 1);
    for (let x = 0; x < w; x++) {
      const nx = x / w, ny = y / h;
      const arch = Math.exp(-Math.pow((ny - (0.62 - 0.35 * Math.sin(Math.PI * nx))) * 5, 2)); // the row of teeth
      const teeth = 0.5 + 0.5 * Math.sin(nx * 2 * Math.PI * 7 + seed); // gaps between teeth
      const bone = Math.exp(-Math.pow((ny - 0.9) * 4, 2)) * 0.35;
      const noise = ((x * 7 + y * 13 + seed * 31) % 17) / 17 * 0.06;
      row[x + 1] = Math.max(0, Math.min(255, Math.round(255 * (0.12 + 0.62 * arch * (0.55 + 0.45 * teeth) + bone + noise))));
    }
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  if ((await prisma.clinic.count()) > 0 && !process.env.SEED_ALLOW_NONEMPTY) {
    throw new Error('The database is not empty. Reset it first (see the guide), then run this again.');
  }
  const hash = await new PasswordService().hash(PASSWORD);
  const uploadDir = resolve(getUploadDir(), 'xrays');
  mkdirSync(uploadDir, { recursive: true });
  const tag = process.env.SEED_TAG ?? ''; // only used by automated checks, to allow two runs in one database
  const nm = (s: string) => `${s}${tag}`;

  // ================================================================== helpers (all per clinic)
  const makeClinic = (name: string, color: string | null, endsInDays: number | null, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') =>
    prisma.clinic.create({ data: { name: nm(name), themeColor: color, status, subscriptionEndsAt: endsInDays === null ? null : new Date(Date.now() + endsInDays * DAY) } });

  const makeUser = (clinicId: string, username: string, fullName: string, role: Role, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { clinicId, username: nm(username), passwordHash: hash, fullName, role, ...extra } as never });

  const makeDoctor = async (clinicId: string, fullName: string, userId: string | null, periods: [number[], number, number][], extra: Record<string, unknown> = {}) => {
    const d = await prisma.doctor.create({ data: { clinicId, userId, fullName, specialty: 'طب أسنان', ...extra } as never });
    for (const [weekdays, start, end] of periods) for (const weekday of weekdays) await prisma.doctorWorkingPeriod.create({ data: { clinicId, doctorId: d.id, weekday, startMinute: start, endMinute: end } });
    return d;
  };

  const makePatient = (clinicId: string, fullName: string, phone: string, extra: Record<string, unknown> = {}) =>
    prisma.patient.create({ data: { clinicId, fullName, phone, ...extra } as never });

  const makeType = (clinicId: string, name: string, parentId: string | null = null, isActive = true) => prisma.treatmentType.create({ data: { clinicId, name, parentId, isActive } });

  /** One treatment with its teeth and PLANNED sessions 1..planned. */
  const makeTreatment = async (clinicId: string, o: { patientId: string; doctorId: string; teeth: [number, string][]; cost: number; planned: number; startedAt: Date; description?: string; status?: 'OPEN' | 'CLOSED' | 'CANCELLED'; closedAt?: Date; appointmentId?: string }) => {
    const t = await prisma.treatment.create({
      data: { clinicId, patientId: o.patientId, doctorId: o.doctorId, totalCost: ils(o.cost), plannedSessions: o.planned, startedAt: o.startedAt, description: o.description ?? null, status: o.status ?? 'OPEN', closedAt: o.closedAt ?? null, appointmentId: o.appointmentId ?? null },
    });
    for (const [toothCode, treatmentTypeId] of o.teeth) await prisma.treatmentTooth.create({ data: { clinicId, treatmentId: t.id, toothCode, treatmentTypeId } });
    for (let number = 1; number <= o.planned; number++) await prisma.session.create({ data: { clinicId, treatmentId: t.id, number } });
    return t;
  };
  const doneSession = (clinicId: string, treatmentId: string, number: number, when: Date, appointmentId?: string, notes?: string) =>
    prisma.session.updateMany({ where: { clinicId, treatmentId, number }, data: { status: 'COMPLETED', completedAt: when, appointmentId: appointmentId ?? null, notes: notes ?? null } });
  const bookSession = (clinicId: string, treatmentId: string, number: number, appointmentId: string) => prisma.session.updateMany({ where: { clinicId, treatmentId, number }, data: { appointmentId } });

  const pay = (clinicId: string, t: { id: string; patientId: string }, userId: string, amount: number, method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER', paidAt: Date, note?: string) =>
    prisma.payment.create({ data: { clinicId, patientId: t.patientId, treatmentId: t.id, amount: ils(amount), method, paidAt, note: note ?? null, createdByUserId: userId } });
  const voidedPay = (clinicId: string, t: { id: string; patientId: string }, userId: string, amount: number, paidAt: Date, reason: string) =>
    prisma.payment.create({ data: { clinicId, patientId: t.patientId, treatmentId: t.id, amount: ils(amount), method: 'CASH', paidAt, createdByUserId: userId, status: 'VOIDED', voidedAt: new Date(paidAt.getTime() + 3600_000), voidReason: reason, voidedByUserId: userId } });

  type Status = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  const appt = (clinicId: string, o: { patientId: string; doctorId: string; start: Date; minutes?: number; status: Status; notes?: string; cancelReason?: string; bookedByPatient?: boolean; completedAt?: Date }) => {
    const ends = new Date(o.start.getTime() + (o.minutes ?? 30) * MIN);
    return prisma.appointment.create({
      data: {
        clinicId, patientId: o.patientId, doctorId: o.doctorId, startsAt: o.start, endsAt: ends, status: o.status, notes: o.notes ?? null, bookedByPatient: o.bookedByPatient ?? false,
        cancelReason: o.status === 'CANCELLED' ? o.cancelReason ?? 'المريض اعتذر' : null, cancelledAt: o.status === 'CANCELLED' ? new Date(o.start.getTime() - 86_400_000) : null,
        confirmedAt: o.status === 'CONFIRMED' || o.status === 'COMPLETED' ? new Date(o.start.getTime() - 2 * 86_400_000) : null,
        completedAt: o.status === 'COMPLETED' ? o.completedAt ?? ends : null,
      },
    });
  };
  const message = (clinicId: string, appointmentId: string, toPhone: string, o: { kind?: 'BOOKING' | 'CONFIRMATION'; status: 'SCHEDULED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'CANCELLED'; at: Date; response?: 'YES' | 'NO'; error?: string }) =>
    prisma.messageLog.create({
      data: {
        clinicId, appointmentId, kind: o.kind ?? 'CONFIRMATION', status: o.status, toPhone, scheduledFor: o.at, sentAt: o.status === 'SCHEDULED' || o.status === 'CANCELLED' ? null : o.at,
        body: o.status === 'SCHEDULED' ? null : 'مرحبا، هذا تذكير بموعدك بالعيادة. رد بـ نعم للتأكيد أو لا للإلغاء.', errorMessage: o.status === 'FAILED' ? o.error ?? 'رقم غير صالح للواتساب' : null,
        response: o.response ?? null, respondedAt: o.response ? new Date(o.at.getTime() + 20 * MIN) : null,
      },
    });

  const xray = async (clinicId: string, t: { id: string; patientId: string }, userId: string, w: number, h: number, seedN: number, when: Date, note: string | null) => {
    const file = `${clinicId}-${randomBytes(8).toString('hex')}.png`;
    const data = xrayPng(w, h, seedN);
    writeFileSync(join(uploadDir, file), data);
    return prisma.xRay.create({ data: { clinicId, patientId: t.patientId, treatmentId: t.id, file, mime: 'image/png', size: data.length, note, uploadedByUserId: userId, createdAt: when } });
  };

  const subscription = async (clinicId: string, o: { months: number; startDays: number; price: number; payments: [number, number, string?][]; voided?: [number, number, string] }) => {
    const startsAt = new Date(Date.now() + o.startDays * DAY);
    const p = await prisma.subscriptionPeriod.create({ data: { clinicId, months: o.months, startsAt, endsAt: new Date(startsAt.getTime() + o.months * 30 * DAY), price: ils(o.price) } });
    for (const [amount, daysAgo, note] of o.payments) await prisma.subscriptionPayment.create({ data: { periodId: p.id, clinicId, amount: ils(amount), paidAt: new Date(Date.now() - daysAgo * DAY), note: note ?? null } });
    if (o.voided) await prisma.subscriptionPayment.create({ data: { periodId: p.id, clinicId, amount: ils(o.voided[0]), paidAt: new Date(Date.now() - o.voided[1] * DAY), voidedAt: new Date(Date.now() - (o.voided[1] - 1) * DAY), voidReason: o.voided[2] } });
  };

  // ================================================================== 1) عيادة النور: the main one, with everything
  const noor = await makeClinic('عيادة النور', '#0b5d57', 60);
  const N = noor.id;
  const owner = await makeUser(N, 'noor_owner', 'د. أحمد النور', 'OWNER', { canManagePayments: true, phone: '+970599100001' });
  const uSami = await makeUser(N, 'noor_sami', 'د. سامي الخطيب', 'DOCTOR', { monthlySalary: ils(6000), phone: '+970599100002' });
  const uRana = await makeUser(N, 'noor_rana', 'د. رنا الحاج', 'DOCTOR', { monthlySalary: ils(5500), phone: '+970599100003' });
  const uSec = await makeUser(N, 'noor_sec', 'هبة (سكرتيرة بدون صلاحية مالية)', 'SECRETARY', { monthlySalary: ils(3000) });
  const uKey = await makeUser(N, 'noor_key', 'دانا (سكرتيرة مع مفتاح المدفوعات)', 'SECRETARY', { canManagePayments: true, monthlySalary: ils(3200) });
  await makeUser(N, 'noor_old', 'موظف موقوف (ما بيقدر يدخل)', 'SECRETARY', { isActive: false });
  await makeUser(N, 'noor_temp', 'سكرتيرة جديدة (كلمة مرور مؤقتة)', 'SECRETARY', { mustChangePassword: true, temporaryPasswordExpiresAt: new Date(Date.now() + 5 * DAY) });
  await makeUser(N, 'noor_tempexp', 'سكرتيرة كلمتها المؤقتة انتهت', 'SECRETARY', { mustChangePassword: true, temporaryPasswordExpiresAt: new Date(Date.now() - 2 * DAY) });
  await makeUser(N, 'noor_locked', 'مستخدم مقفول بعد محاولات غلط', 'SECRETARY', { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 60 * MIN) });

  const weekdays = [6, 0, 1, 2, 3, 4]; // Saturday to Thursday
  const dOwner = await makeDoctor(N, 'د. أحمد النور', owner.id, [[weekdays, 540, 780], [weekdays, 960, 1200]], { appointmentMinutes: 30 });
  const dSami = await makeDoctor(N, 'د. سامي الخطيب', uSami.id, [[[0, 1, 2, 3, 4], 540, 900]], { appointmentMinutes: 30 });
  const dRana = await makeDoctor(N, 'د. رنا الحاج', uRana.id, [[[0, 1, 2, 3, 4, 6], 960, 1200]], { appointmentMinutes: 60 });
  await makeDoctor(N, 'د. غير فعّال (ما بيظهر بالحجز)', null, [], { isActive: false });

  // ---- treatment types: two levels, one inactive
  const tFill = await makeType(N, 'حشوة');
  const tFillLight = await makeType(N, 'ضوئية', tFill.id);
  const tFillAmalgam = await makeType(N, 'ملغم', tFill.id);
  const tCrown = await makeType(N, 'تاج');
  const tZirconia = await makeType(N, 'زيركون', tCrown.id);
  const tMetal = await makeType(N, 'معدن', tCrown.id);
  const tRoot = await makeType(N, 'علاج عصب');
  const tExtract = await makeType(N, 'قلع');
  const tOrtho = await makeType(N, 'تقويم');
  const tImplant = await makeType(N, 'زراعة');
  const tClean = await makeType(N, 'تنظيف');
  const tWhite = await makeType(N, 'تبييض');
  await makeType(N, 'نوع قديم متوقف', null, false);

  // ---- patients: every kind
  const P: Record<string, { id: string; phone: string }> = {};
  const addP = async (key: string, name: string, phone: string, extra: Record<string, unknown> = {}) => (P[key] = await makePatient(N, name, phone, extra));
  const birth = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
  const yearsAgo = (years: number, m = 3, d = 10) => birth(Number(today.slice(0, 4)) - years, m, d);
  await addP('layla', 'ليلى حداد', '+970599200001', { gender: 'FEMALE', birthDate: yearsAgo(36), nationalId: '900000001', medicalAlerts: 'حساسية بنسلين', region: 'رام الله', address: 'الماصيون، شارع الإرسال' });
  await addP('layla_kid', 'جنى (بنت ليلى)', '+970599200001', { gender: 'FEMALE', birthDate: yearsAgo(10, 8, 2), notes: 'نفس رقم أمها: عائلة وحدة' });
  await addP('mohammad', 'محمد الخطيب', '+970599200002', { gender: 'MALE', birthDate: yearsAgo(41), nationalId: '900000002', region: 'البيرة' });
  await addP('mohammad2', 'محمد الخطيب', '+970599200003', { gender: 'MALE', birthDate: yearsAgo(23), notes: 'نفس الاسم، شخص ثاني (رقم مختلف)' });
  await addP('kareem', 'كريم المراهق', '+970599200004', { gender: 'MALE', birthDate: yearsAgo(15, 2, 2), notes: 'يلبس تقويم' });
  await addP('sara', 'سارة النتشة', '+970599200005', { gender: 'FEMALE', birthDate: yearsAgo(48), medicalAlerts: 'سكري نوع 2', nationalId: '900000005' });
  await addP('hajj', 'أبو أحمد الحاج', '+970599200006', { gender: 'MALE', birthDate: yearsAgo(74), medicalAlerts: 'ضغط + أدوية سيولة الدم: انتبه عند القلع', nationalId: '900000006' });
  await addP('rana_p', 'رنا عودة', '+970599200007', { gender: 'FEMALE', birthDate: yearsAgo(29), nationalId: '900000007' });
  await addP('yousef', 'يوسف قاسم', '+970599200008', { gender: 'MALE', birthDate: yearsAgo(17, 11, 20) });
  await addP('yasmin', 'ياسمين (طفلة)', '+970599200009', { gender: 'FEMALE', birthDate: yearsAgo(4, 5, 5), notes: 'أسنان لبنية' });
  await addP('nodate', 'مريض بدون تاريخ ميلاد', '+970599200010', { gender: 'MALE' });
  await addP('omar', 'عمر الشريف', '+970599200011', { gender: 'MALE', birthDate: yearsAgo(33) });
  await addP('huda', 'هدى بركات', '+970599200012', { gender: 'FEMALE', birthDate: yearsAgo(37), selfRegistered: true, notes: 'سجّلت حالها من صفحة الحجز: لسا ما انفتح لها علاج' });
  await addP('ziad', 'زياد منصور', '+970599200013', { gender: 'MALE', birthDate: yearsAgo(26) });
  await addP('dana', 'دانا حمدان', '+970599200014', { gender: 'FEMALE', birthDate: yearsAgo(23) });
  await addP('khaled', 'خالد حنفي', '+970599200015', { gender: 'MALE', birthDate: yearsAgo(51), notes: 'يفضل المواعيد المسائية' });
  await addP('mona', 'منى سلامة', '+970599200016', { gender: 'FEMALE', birthDate: yearsAgo(57) });
  await addP('long', 'عبد الرحمن محمد أحمد إبراهيم الخطيب الحسيني', '+970599200017', { gender: 'MALE', birthDate: yearsAgo(45) });
  await addP('archived', 'مريض مؤرشف (ما بيظهر بالقائمة العادية)', '+970599200018', { gender: 'MALE', birthDate: yearsAgo(60), archivedAt: new Date(Date.now() - 30 * DAY) });
  await addP('notreat', 'مريض جديد بدون علاجات', '+970599200019', { gender: 'FEMALE', birthDate: yearsAgo(31) });

  // ---- treatments in every state (doctor = whoever did it)
  // 1) open, 3 sessions: #1 done 10 days ago, #2 booked tomorrow (confirmed), #3 not booked. Part-paid. Two X-rays.
  const t1 = await makeTreatment(N, { patientId: P.layla!.id, doctorId: dSami.id, teeth: [[16, tFillLight.id]], cost: 600, planned: 3, startedAt: ago(10), description: 'حشوة ضوئية على 3 جلسات' });
  const a1done = await appt(N, { patientId: P.layla!.id, doctorId: dSami.id, start: ago(10, 11), status: 'COMPLETED' });
  await doneSession(N, t1.id, 1, ago(10, 11), a1done.id, 'تنظيف التسوس وحشوة مؤقتة');
  const a1next = await appt(N, { patientId: P.layla!.id, doctorId: dSami.id, start: at(1, 10), status: 'CONFIRMED' });
  await bookSession(N, t1.id, 2, a1next.id);
  await message(N, a1next.id, P.layla!.phone, { status: 'DELIVERED', at: at(0, 10), response: 'YES' });
  await pay(N, t1, owner.id, 200, 'CASH', ago(10, 12), 'دفعة أولى');
  await xray(N, t1, uSami.id, 900, 450, 1, ago(10, 11), 'بانوراما قبل الحشوة');
  await xray(N, t1, uSami.id, 500, 400, 2, ago(10, 11), 'سن 16 periapical');

  // 2) multi-teeth, two types, 4 sessions: 2 done; one wrong payment voided
  const t2 = await makeTreatment(N, { patientId: P.mohammad!.id, doctorId: dOwner.id, teeth: [[26, tZirconia.id], [27, tFillLight.id]], cost: 1800, planned: 4, startedAt: ago(20), description: 'تاج زيركون + حشوة' });
  await doneSession(N, t2.id, 1, ago(20, 10));
  await doneSession(N, t2.id, 2, ago(12, 10), undefined, 'أخذ قياس التاج');
  await pay(N, t2, owner.id, 500, 'CASH', ago(20, 11));
  await voidedPay(N, t2, owner.id, 3000, ago(12, 11), 'المبلغ انكتب غلط (3000 بدل 300)');
  await pay(N, t2, uKey.id, 300, 'CARD', ago(12, 11));

  // 3) orthodontics: long, part-paid monthly, teenager
  const t3 = await makeTreatment(N, { patientId: P.kareem!.id, doctorId: dSami.id, teeth: [[11, tOrtho.id], [21, tOrtho.id]], cost: 4500, planned: 12, startedAt: ago(150), description: 'تقويم معدني، جلسة كل شهر' });
  for (let n = 1; n <= 5; n++) await doneSession(N, t3.id, n, ago(150 - (n - 1) * 30, 16));
  for (let m = 0; m < 5; m++) await pay(N, t3, owner.id, 300, m % 2 ? 'CARD' : 'CASH', ago(150 - m * 30, 17), m === 0 ? 'دفعة أولى + تركيب' : undefined);
  await xray(N, t3, uSami.id, 1100, 480, 3, ago(150, 16), 'بانوراما قبل التقويم');

  // 4) closed, fully paid with several methods
  const t4 = await makeTreatment(N, { patientId: P.sara!.id, doctorId: dOwner.id, teeth: [[36, tRoot.id]], cost: 900, planned: 2, startedAt: ago(45), description: 'علاج عصب', status: 'CLOSED', closedAt: ago(30, 12) });
  await doneSession(N, t4.id, 1, ago(45, 10));
  await doneSession(N, t4.id, 2, ago(30, 10));
  await pay(N, t4, owner.id, 500, 'CARD', ago(45, 11));
  await pay(N, t4, owner.id, 400, 'TRANSFER', ago(30, 11), 'حوالة بنكية');

  // 5) closed, one session, elderly with a medical alert
  const t5 = await makeTreatment(N, { patientId: P.hajj!.id, doctorId: dOwner.id, teeth: [[48, tExtract.id]], cost: 150, planned: 1, startedAt: ago(8), description: 'قلع ضرس عقل', status: 'CLOSED', closedAt: ago(8, 13) });
  await doneSession(N, t5.id, 1, ago(8, 11), undefined, 'تم القلع، تعليمات ما بعد القلع');
  await pay(N, t5, owner.id, 150, 'CASH', ago(8, 12));

  // 6) closed EARLY (3 planned, only 2 happened): the third session is dropped, plannedSessions = 2
  const t6 = await makeTreatment(N, { patientId: P.rana_p!.id, doctorId: dSami.id, teeth: [[46, tImplant.id]], cost: 3000, planned: 2, startedAt: ago(70), description: 'زراعة: خلصت بجلستين بدل 3', status: 'CLOSED', closedAt: ago(35, 14) });
  await doneSession(N, t6.id, 1, ago(70, 11));
  await doneSession(N, t6.id, 2, ago(35, 11));
  await pay(N, t6, owner.id, 2000, 'TRANSFER', ago(70, 12));
  await pay(N, t6, owner.id, 1000, 'CASH', ago(35, 12));

  // 7) cancelled treatment (no payments: a treatment with payments cannot be cancelled)
  await makeTreatment(N, { patientId: P.omar!.id, doctorId: dOwner.id, teeth: [[11, tWhite.id], [21, tWhite.id]], cost: 800, planned: 1, startedAt: ago(5), description: 'تبييض: المريض ألغى', status: 'CANCELLED', closedAt: ago(4) });

  // 8) child, primary tooth (an appointment for it comes below)
  const t8 = await makeTreatment(N, { patientId: P.yasmin!.id, doctorId: dRana.id, teeth: [[54, tFillLight.id]], cost: 200, planned: 1, startedAt: ago(2), description: 'حشوة سن لبني' });

  // 9) the BIGGEST debt: nothing paid
  const t9 = await makeTreatment(N, { patientId: P.yousef!.id, doctorId: dSami.id, teeth: [[13, tOrtho.id], [23, tOrtho.id]], cost: 5000, planned: 10, startedAt: ago(40), description: 'تقويم: لسا ما دفع شي' });
  await doneSession(N, t9.id, 1, ago(40, 15));

  // 10) open, paid in full, one of two sessions done TODAY
  const t10 = await makeTreatment(N, { patientId: P.mona!.id, doctorId: dSami.id, teeth: [[17, tClean.id]], cost: 150, planned: 2, startedAt: ago(1), description: 'تنظيف على جلستين' });
  const a10 = await appt(N, { patientId: P.mona!.id, doctorId: dSami.id, start: at(0, 9), status: 'COMPLETED' });
  await doneSession(N, t10.id, 1, at(0, 9, 40), a10.id);
  await pay(N, t10, uSec.id, 150, 'CASH', at(0, 9, 45));

  // 11) another doctor (Rana): paid in full, for the per-doctor income
  const t11 = await makeTreatment(N, { patientId: P.dana!.id, doctorId: dRana.id, teeth: [[36, tFillAmalgam.id]], cost: 400, planned: 1, startedAt: ago(3), description: 'حشوة ملغم' });
  const a11 = await appt(N, { patientId: P.dana!.id, doctorId: dRana.id, start: ago(3, 17), status: 'COMPLETED', minutes: 60 });
  await doneSession(N, t11.id, 1, ago(3, 17), a11.id);
  await pay(N, t11, owner.id, 400, 'CARD', ago(3, 18));

  // 12, 13) debts of other sizes, for the balances page
  const t12 = await makeTreatment(N, { patientId: P.khaled!.id, doctorId: dOwner.id, teeth: [[14, tCrown.id]], cost: 1200, planned: 2, startedAt: ago(25), description: 'تاج' });
  await doneSession(N, t12.id, 1, ago(25, 17));
  await pay(N, t12, owner.id, 700, 'CASH', ago(25, 18));
  const t13 = await makeTreatment(N, { patientId: P.long!.id, doctorId: dSami.id, teeth: [[25, tMetal.id]], cost: 650, planned: 1, startedAt: ago(15), description: 'تاج معدني' });
  await doneSession(N, t13.id, 1, ago(15, 10));
  await pay(N, t13, uKey.id, 600, 'CARD', ago(15, 11));

  // ---- history for the analysis page: older closed treatments spread over the last 5 months
  const hist = [P.ziad!, P.huda!, P.omar!, P.rana_p!, P.mona!, P.dana!, P.khaled!, P.sara!];
  let hi = 0;
  for (let m = 1; m <= 5; m++) {
    for (let k = 0; k < 4; k++, hi++) {
      const patient = hist[hi % hist.length]!;
      const doctor = [dOwner, dSami, dRana][hi % 3]!;
      const cost = [150, 300, 450, 800, 1200][(hi + m) % 5]!;
      const type = [tFillLight, tClean, tRoot, tCrown, tExtract][(hi + m) % 5]!;
      const when = inMonth(m, 3 + k * 6);
      const t = await makeTreatment(N, { patientId: patient.id, doctorId: doctor.id, teeth: [[16 + (hi % 8), type.id]], cost, planned: 1, startedAt: when, status: 'CLOSED', closedAt: when, description: `علاج قديم (قبل ${m} شهر)` });
      await doneSession(N, t.id, 1, when);
      await pay(N, t, owner.id, cost, (['CASH', 'CARD', 'TRANSFER'] as const)[hi % 3]!, when);
    }
  }

  // ---- appointments in every state (per doctor, never overlapping)
  // Sami
  await appt(N, { patientId: P.mohammad!.id, doctorId: dSami.id, start: ago(14, 10), status: 'COMPLETED' });
  await appt(N, { patientId: P.ziad!.id, doctorId: dSami.id, start: at(-1, 10), status: 'PENDING', notes: 'فات موعده ولا انأكد: لازم الاستقبال يتصرف' });
  await appt(N, { patientId: P.huda!.id, doctorId: dSami.id, start: at(-1, 12), status: 'CONFIRMED', notes: 'مؤكد وفات وقته ولا انفتح له علاج' });
  await appt(N, { patientId: P.sara!.id, doctorId: dSami.id, start: at(0, 11), status: 'CONFIRMED' });
  const aBooked = await appt(N, { patientId: P.nodate!.id, doctorId: dSami.id, start: at(1, 11, 30), status: 'CONFIRMED', bookedByPatient: true, notes: 'حجز بنفسه من رابط الواتساب (خلال 24 ساعة: مؤكد تلقائياً)' });
  await message(N, aBooked.id, P.nodate!.phone, { kind: 'BOOKING', status: 'DELIVERED', at: at(0, 8) });
  const aFar = await appt(N, { patientId: P.long!.id, doctorId: dSami.id, start: at(3, 10), status: 'PENDING' });
  await message(N, aFar.id, P.long!.phone, { status: 'SCHEDULED', at: at(2, 10) });
  await appt(N, { patientId: P.layla!.id, doctorId: dSami.id, start: at(5, 12), status: 'CANCELLED', cancelReason: 'المريضة سافرت' });
  // Rana (60-minute slots, evenings)
  await appt(N, { patientId: P.yasmin!.id, doctorId: dRana.id, start: at(-1, 17, 30), status: 'CANCELLED', cancelReason: 'الطفلة مريضة' });
  const aKid = await appt(N, { patientId: P.yasmin!.id, doctorId: dRana.id, start: at(0, 17), status: 'PENDING', minutes: 60, notes: 'موعد الطفلة: بانتظار رد الأهل' });
  await bookSession(N, t8.id, 1, aKid.id);
  await message(N, aKid.id, P.yasmin!.phone, { status: 'SENT', at: at(0, 8) });
  await appt(N, { patientId: P.dana!.id, doctorId: dRana.id, start: at(2, 16, 30), status: 'PENDING', minutes: 60 });
  const aFail = await appt(N, { patientId: P.khaled!.id, doctorId: dRana.id, start: at(2, 18), status: 'PENDING', minutes: 60 });
  await message(N, aFail.id, P.khaled!.phone, { status: 'FAILED', at: at(1, 18), error: 'رقم غير مسجل بالواتساب' });
  await appt(N, { patientId: P.hajj!.id, doctorId: dRana.id, start: at(4, 18), status: 'CONFIRMED', minutes: 60 });
  // The owner (as a doctor): times relative to NOW, so there is always one that already started and one coming
  const started = roundDown5(new Date(Date.now() - 45 * MIN));
  await appt(N, { patientId: P.omar!.id, doctorId: dOwner.id, start: started, status: 'CONFIRMED', notes: 'بدأ ولسا ما انفتح له علاج: جرّب "إنهاء وفتح علاج"' });
  await appt(N, { patientId: P.ziad!.id, doctorId: dOwner.id, start: roundDown5(new Date(Date.now() + 60 * MIN)), status: 'CONFIRMED' });
  const aLater = await appt(N, { patientId: P.huda!.id, doctorId: dOwner.id, start: roundDown5(new Date(Date.now() + 180 * MIN)), status: 'PENDING' });
  await message(N, aLater.id, P.huda!.phone, { status: 'SENT', at: new Date(Date.now() - 30 * MIN) });
  const aNo = await appt(N, { patientId: P.mona!.id, doctorId: dOwner.id, start: at(2, 10), status: 'PENDING', notes: 'المريضة ردت "لا" بالواتساب: لسا مش ملغي' });
  await message(N, aNo.id, P.mona!.phone, { status: 'DELIVERED', at: at(1, 10), response: 'NO' });
  const a2next = await appt(N, { patientId: P.mohammad!.id, doctorId: dOwner.id, start: at(1, 9), status: 'CONFIRMED' });
  await bookSession(N, t2.id, 3, a2next.id);
  await message(N, a2next.id, P.mohammad!.phone, { status: 'DELIVERED', at: at(0, 9), response: 'YES' });

  // ---- booking links (the public page): known phone, unknown phone (new-patient flow), expired
  const link = async (phone: string, hours: number) => {
    const token = randomBytes(32).toString('base64url');
    await prisma.bookingLink.create({ data: { clinicId: N, phone, tokenHash: sha(token), expiresAt: new Date(Date.now() + hours * 3600_000) } });
    return `${getPublicWebUrl()}/book/${token}`;
  };
  const links = { known: await link(P.layla!.phone, 12), unknown: await link('+970599888777', 12), expired: await link(P.mohammad!.phone, -3) };

  // ---- expenses: categories, suppliers, bills in every state
  const cat = async (name: string, isActive = true) => prisma.expenseCategory.create({ data: { clinicId: N, name, isActive } });
  const cRent = await cat('إيجار'), cMat = await cat('مواد وأدوات'), cLab = await cat('مختبر'), cUtil = await cat('كهرباء وماء'), cAds = await cat('تسويق'), cFix = await cat('صيانة');
  await cat('تصنيف قديم متوقف', false);
  const sup = (name: string, phone: string | null, notes: string | null = null) => prisma.supplier.create({ data: { clinicId: N, name, phone, notes } });
  const sLab = await sup('مختبر الأسنان المتقدم', '+970599300001', 'تاج وتقويم'), sMed = await sup('شركة المستلزمات الطبية', '+970599300002'), sLand = await sup('مالك العقار (أبو محمود)', '+970599300003', 'الإيجار أول كل شهر');
  const expense = (categoryId: string, supplierId: string | null, amount: number, incurredAt: Date, description: string, extra: Record<string, unknown> = {}) =>
    prisma.expense.create({ data: { clinicId: N, categoryId, supplierId, amount: ils(amount), incurredAt, description, createdByUserId: owner.id, ...extra } as never });
  const expPay = (e: { id: string }, amount: number, method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER', paidAt: Date, extra: Record<string, unknown> = {}) =>
    prisma.expensePayment.create({ data: { clinicId: N, expenseId: e.id, amount: ils(amount), method, paidAt, createdByUserId: owner.id, ...extra } as never });
  for (let m = 1; m <= 5; m++) {
    const rent = await expense(cRent.id, sLand.id, 2500, inMonth(m, 1), `إيجار شهر ${monthOf(m)}`);
    await expPay(rent, 2500, 'TRANSFER', inMonth(m, 2));
    const util = await expense(cUtil.id, null, 300 + m * 25, inMonth(m, 12), `كهرباء وماء ${monthOf(m)}`);
    await expPay(util, 300 + m * 25, 'CASH', inMonth(m, 14));
  }
  const rentNow = await expense(cRent.id, sLand.id, 2500, ago(Math.min(9, Number(today.slice(8, 10)) - 1) || 1), 'إيجار هذا الشهر');
  await expPay(rentNow, 2500, 'TRANSFER', ago(Math.min(8, Number(today.slice(8, 10)) - 1) || 1));
  const matPartial = await expense(cMat.id, sMed.id, 1800, ago(5), 'مواد حشو وتخدير: مدفوع جزء بس');
  await expPay(matPartial, 1000, 'CASH', ago(5));
  const matOld = await expense(cMat.id, sMed.id, 2200, inMonth(1, 10), 'مواد الشهر الماضي');
  await expPay(matOld, 2200, 'CARD', inMonth(1, 11));
  await expense(cLab.id, sLab.id, 950, ago(12), 'فاتورة مختبر: ما اندفعت أبداً');
  const labPaid = await expense(cLab.id, sLab.id, 600, ago(20), 'تاج زيركون من المختبر');
  await expPay(labPaid, 600, 'TRANSFER', ago(19));
  await expense(cAds.id, null, 400, ago(30), 'إعلان فيسبوك', { status: 'VOIDED', voidedAt: ago(29), voidReason: 'فاتورة مكررة', voidedByUserId: owner.id });
  const fix = await expense(cFix.id, null, 350, ago(14), 'صيانة الكرسي: دفعة انلغت وانعادت');
  await expPay(fix, 350, 'CASH', ago(14), { status: 'VOIDED', voidedAt: ago(13), voidReason: 'انسجلت كاش بالغلط، اندفعت بحوالة', voidedByUserId: owner.id });
  await expPay(fix, 350, 'TRANSFER', ago(13));
  const small = await expense(cAds.id, null, 35, at(0, 8), 'ضيافة');
  await expPay(small, 35, 'CASH', at(0, 8, 5));

  // ---- salaries: past months paid, one part-paid, this month with advances and a bonus
  const entry = (userId: string, monthsBack: number, base: number, extra: Record<string, unknown> = {}) =>
    prisma.salaryEntry.create({ data: { clinicId: N, userId, month: monthOf(monthsBack), baseAmount: ils(base), ...extra } as never });
  const salPay = (entryId: string, kind: 'SALARY' | 'ADVANCE', amount: number, method: 'CASH' | 'TRANSFER', paidAt: Date) =>
    prisma.salaryPayment.create({ data: { clinicId: N, entryId, kind, amount: ils(amount), method, paidAt, createdByUserId: owner.id } });
  const staff: [typeof uSami, number][] = [[uSami, 6000], [uRana, 5500], [uSec, 3000], [uKey, 3200]];
  for (const [u, base] of staff) {
    for (const m of [3, 2, 1]) {
      const e = await entry(u.id, m, base);
      const partial = u.id === uSec.id && m === 1; // Hiba: last month only part-paid
      await salPay(e.id, 'SALARY', partial ? 2000 : base, 'TRANSFER', inMonth(m, 26));
    }
  }
  const sNowSami = await entry(uSami.id, 0, 6000);
  await salPay(sNowSami.id, 'ADVANCE', 500, 'CASH', ago(5));
  const sNowKey = await entry(uKey.id, 0, 3200, { adjustment: ils(200), adjustNote: 'مكافأة على الدوام الإضافي' });
  await salPay(sNowKey.id, 'ADVANCE', 300, 'CASH', ago(3));
  // Rana, Hiba: this month's entry is not created yet: the salaries page opens it on demand

  // ---- what Noor owes Fikra
  await subscription(N, { months: 12, startDays: -100, price: 3600, payments: [[1800, 90, 'دفعة أولى'], [1000, 30]], voided: [500, 60, 'دفعة انكتبت غلط'] });

  // ================================================================== 2..5) other clinics: isolation and subscription states
  const small2 = async (clinic: { id: string }, key: string, name: string, patientName: string, phone: string) => {
    const o = await makeUser(clinic.id, `${key}_owner`, name, 'OWNER', { canManagePayments: true });
    const d = await makeDoctor(clinic.id, name, o.id, [[[6, 0, 1, 2, 3, 4], 540, 1020]]);
    const p = await makePatient(clinic.id, patientName, phone, { gender: 'FEMALE', birthDate: yearsAgo(30), nationalId: key === 'amal' ? '900000001' : null });
    return { o, d, p };
  };
  // Amal: a normal second clinic. Its patient Layla has the SAME phone and national ID as Noor's: that must never mix.
  const amal = await makeClinic('عيادة الأمل', '#2457c5', 20);
  const A = await small2(amal, 'amal', 'د. ليلى الأمل', 'ليلى حداد', P.layla!.phone);
  await makeUser(amal.id, 'amal_sec', 'سكرتيرة الأمل', 'SECRETARY');
  const ay = await makePatient(amal.id, 'ياسر العلي', '+970599400002', { gender: 'MALE', birthDate: yearsAgo(40) });
  const aType = await makeType(amal.id, 'حشوة');
  const at1 = await makeTreatment(amal.id, { patientId: A.p.id, doctorId: A.d.id, teeth: [[16, aType.id]], cost: 300, planned: 1, startedAt: ago(4), description: 'علاج بعيادة الأمل (ما لازم يظهر بالنور)' });
  await pay(amal.id, at1, A.o.id, 300, 'CASH', ago(4));
  await appt(amal.id, { patientId: ay.id, doctorId: A.d.id, start: at(0, 10), status: 'CONFIRMED' });
  await appt(amal.id, { patientId: A.p.id, doctorId: A.d.id, start: at(1, 11), status: 'PENDING' });
  await subscription(amal.id, { months: 6, startDays: -30, price: 1800, payments: [[1800, 28]] });
  // Salam: subscription ended yesterday: still inside the 3-day grace (works, with a warning)
  const salam = await makeClinic('عيادة السلام (ضمن المهلة)', '#6a42c2', -1);
  await small2(salam, 'salam', 'د. سلام', 'مريضة السلام', '+970599500001');
  await subscription(salam.id, { months: 1, startDays: -31, price: 300, payments: [] });
  // Rahma: ended 10 days ago: login is blocked
  const rahma = await makeClinic('عيادة الرحمة (منتهية)', '#9b2c46', -10);
  await small2(rahma, 'rahma', 'د. رحمة', 'مريضة الرحمة', '+970599600001');
  await subscription(rahma.id, { months: 1, startDays: -40, price: 600, payments: [[200, 38]] });
  // Wafa: suspended by the platform
  const wafa = await makeClinic('عيادة الوفاء (موقوفة)', '#b4540a', 90, 'SUSPENDED');
  await small2(wafa, 'wafa', 'د. وفاء', 'مريضة الوفاء', '+970599700001');
  await subscription(wafa.id, { months: 3, startDays: -10, price: 900, payments: [[900, 9]] });

  // ================================================================== what to do next
  const line = '-'.repeat(72);
  console.log(`\n${line}\nDEMO DATA READY.  Password for every user below: ${PASSWORD}\n${line}`);
  console.log(`
عيادة النور (الرئيسية)
  noor_owner      المالك + دكتور، صلاحية كل شي
  noor_sami       دكتور (راتب 6000)            noor_rana  دكتورة (60 دقيقة، مسائي)
  noor_sec        سكرتيرة بدون صلاحية مالية      noor_key   سكرتيرة مع مفتاح المدفوعات
  noor_temp       كلمة مرور مؤقتة (لازم تغيّرها عند أول دخول)
  noor_tempexp    كلمتها المؤقتة انتهت            noor_locked مقفول (حتى ساعة)
  noor_old        موقوف (ما بيدخل)
عيادة الأمل      amal_owner / amal_sec        (عيادة ثانية: لفحص العزل)
عيادة السلام     salam_owner                  (انتهى اشتراكها أمس: تشتغل مع تحذير مهلة)
عيادة الرحمة     rahma_owner                  (انتهى من 10 أيام: الدخول ممنوع)
عيادة الوفاء     wafa_owner                   (موقوفة: الدخول ممنوع)

روابط صفحة الحجز العامة:
  مريض معروف (ليلى حداد): ${links.known}
  رقم جديد (يسجّل بياناته): ${links.unknown}
  رابط منتهي:              ${links.expired}

لوحة أدمن Fikra: ما بتنعمل من هون (بدها QR للمصادقة الثنائية). اعملها بـ:
  pnpm --filter api admin:create ali "Ali"
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
