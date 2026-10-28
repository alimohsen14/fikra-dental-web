import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("Seed is for development only");
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DEV_PASSWORD = "Dev12345!"; // development only, never used in production

type ClinicSeed = {
  name: string;
  themeColor: string;
  ownerUsername: string;
  ownerName: string;
  patients: { fullName: string; phone: string; nationalId?: string }[];
};

async function seedClinic(c: ClinicSeed, passwordHash: string) {
  const clinic = await prisma.clinic.create({
    data: { name: c.name, themeColor: c.themeColor },
  });

  const owner = await prisma.user.create({
    data: {
      clinicId: clinic.id,
      username: c.ownerUsername,
      passwordHash,
      fullName: c.ownerName,
      role: "OWNER",
      canManagePayments: true,
    },
  });

  // The owner is also a doctor.
  const doctor = await prisma.doctor.create({
    data: {
      clinicId: clinic.id,
      userId: owner.id,
      fullName: c.ownerName,
      specialty: "طب أسنان عام",
    },
  });

  // Sunday to Thursday, morning 09:00-13:00 and evening 16:00-20:00.
  const periods = [];
  for (let weekday = 0; weekday <= 4; weekday++) {
    periods.push({ clinicId: clinic.id, doctorId: doctor.id, weekday, startMinute: 540, endMinute: 780 });
    periods.push({ clinicId: clinic.id, doctorId: doctor.id, weekday, startMinute: 960, endMinute: 1200 });
  }
  await prisma.doctorWorkingPeriod.createMany({ data: periods });

  const patients = [];
  for (const p of c.patients) {
    patients.push(
      await prisma.patient.create({
        data: { clinicId: clinic.id, fullName: p.fullName, phone: p.phone, nationalId: p.nationalId },
      }),
    );
  }

  const filling = await prisma.treatmentType.create({ data: { clinicId: clinic.id, name: "حشوة" } });
  await prisma.treatmentType.create({ data: { clinicId: clinic.id, name: "قلع" } });

  // One treatment: total 500 ILS (50000 agorot), 3 sessions, tooth 16.
  const treatment = await prisma.treatment.create({
    data: {
      clinicId: clinic.id,
      patientId: patients[0].id,
      doctorId: doctor.id,
      treatmentTypeId: filling.id,
      totalCost: 50000,
      plannedSessions: 3,
      startedAt: new Date(),
    },
  });
  await prisma.treatmentTooth.createMany({
    data: [{ clinicId: clinic.id, treatmentId: treatment.id, toothCode: 16 }],
  });
  await prisma.session.createMany({
    data: [1, 2, 3].map((number) => ({ clinicId: clinic.id, treatmentId: treatment.id, number })),
  });

  await prisma.appointment.create({
    data: {
      clinicId: clinic.id,
      patientId: patients[0].id,
      doctorId: doctor.id,
      startsAt: new Date("2026-11-15T07:00:00.000Z"),
      endsAt: new Date("2026-11-15T07:30:00.000Z"),
    },
  });

  return clinic;
}

async function main() {
  if ((await prisma.clinic.count()) > 0) {
    console.log("Database already has clinics. Run `prisma migrate reset` first to reseed.");
    return;
  }
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  await prisma.user.create({
    data: { username: "platform", passwordHash, fullName: "Platform Admin", role: "PLATFORM_ADMIN" },
  });

  await seedClinic(
    {
      name: "عيادة النور",
      themeColor: "#0b5d57",
      ownerUsername: "owner_noor",
      ownerName: "د. أحمد النور",
      patients: [
        { fullName: "محمد خالد", phone: "+970599000001", nationalId: "400000001" },
        { fullName: "سارة محمود", phone: "+970599000002" },
      ],
    },
    passwordHash,
  );
  await seedClinic(
    {
      name: "عيادة الأمل",
      themeColor: "#1d4ed8",
      ownerUsername: "owner_amal",
      ownerName: "د. ليلى الأمل",
      patients: [
        { fullName: "يوسف علي", phone: "+970599000003", nationalId: "400000001" },
        { fullName: "رنا حسن", phone: "+970599000004" },
      ],
    },
    passwordHash,
  );

  console.log("Seed done. Users: platform, owner_noor, owner_amal. Dev password: " + DEV_PASSWORD);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
