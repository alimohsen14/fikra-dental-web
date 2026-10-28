import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

let failures = 0;
const createdAppointments: string[] = [];
const createdPatients: string[] = [];

async function expectReject(label: string, hint: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`FAIL  ${label}: was accepted`);
    failures++;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).replace(/\s+/g, " ");
    if (msg.includes(hint)) {
      console.log(`PASS  ${label}`);
    } else {
      console.log(`WARN  ${label}: rejected, but "${hint}" not in message`);
      console.log("      " + msg.slice(0, 220));
    }
  }
}

async function expectAccept(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
  } catch (e) {
    console.log(`FAIL  ${label}: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 220)}`);
    failures++;
  }
}

async function main() {
  const noor = await prisma.clinic.findFirstOrThrow({ where: { name: "عيادة النور" } });
  const amal = await prisma.clinic.findFirstOrThrow({ where: { name: "عيادة الأمل" } });
  const doctor = await prisma.doctor.findFirstOrThrow({ where: { clinicId: noor.id } });
  const patient = await prisma.patient.findFirstOrThrow({ where: { clinicId: noor.id, nationalId: "400000001" } });
  const treatment = await prisma.treatment.findFirstOrThrow({ where: { clinicId: noor.id } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner_noor" } });

  const appt = (start: string, end: string, status: "PENDING" | "CANCELLED" = "PENDING") =>
    prisma.appointment
      .create({
        data: {
          clinicId: noor.id,
          patientId: patient.id,
          doctorId: doctor.id,
          startsAt: new Date(start),
          endsAt: new Date(end),
          status,
        },
      })
      .then((a) => {
        createdAppointments.push(a.id);
        return a;
      });

  // The seed already has an appointment 07:00-07:30 UTC on 2026-11-15 for this doctor.
  await expectReject("overlapping appointment, same doctor", "appointment_no_overlap_per_doctor", () =>
    appt("2026-11-15T07:15:00.000Z", "2026-11-15T07:45:00.000Z"),
  );
  await expectAccept("back-to-back appointment is allowed", () =>
    appt("2026-11-15T07:30:00.000Z", "2026-11-15T08:00:00.000Z"),
  );
  await expectAccept("cancelled appointment may overlap", () =>
    appt("2026-11-15T07:00:00.000Z", "2026-11-15T07:30:00.000Z", "CANCELLED"),
  );
  await expectReject("appointment ends before it starts", "appointment_ends_after_starts", () =>
    appt("2026-11-16T08:00:00.000Z", "2026-11-16T07:00:00.000Z"),
  );
  await expectReject("payment amount of zero", "payment_amount_positive", () =>
    prisma.payment.create({
      data: {
        clinicId: noor.id,
        patientId: patient.id,
        treatmentId: treatment.id,
        amount: 0,
        method: "CASH",
        paidAt: new Date(),
        createdByUserId: owner.id,
      },
    }),
  );
  await expectReject("clinic user without a clinic", "user_clinic_matches_role", () =>
    prisma.user.create({
      data: { username: "orphan_owner", passwordHash: "x", fullName: "No Clinic", role: "OWNER" },
    }),
  );
  await expectReject("duplicate national ID in the same clinic", "nationalId", () =>
    prisma.patient
      .create({ data: { clinicId: noor.id, fullName: "مكرر", phone: "+970599000099", nationalId: "400000001" } })
      .then((p) => createdPatients.push(p.id)),
  );
  await expectAccept("same national ID in another clinic is allowed", () =>
    prisma.patient
      .create({ data: { clinicId: amal.id, fullName: "هوية مشتركة", phone: "+970599000098", nationalId: "400000099" } })
      .then((p) => createdPatients.push(p.id))
      .then(() =>
        prisma.patient
          .create({ data: { clinicId: noor.id, fullName: "هوية مشتركة 2", phone: "+970599000097", nationalId: "400000099" } })
          .then((p) => createdPatients.push(p.id)),
      ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    // Remove only what this script created.
    await prisma.appointment.deleteMany({ where: { id: { in: createdAppointments } } });
    await prisma.patient.deleteMany({ where: { id: { in: createdPatients } } });
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nAll checks done." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  });
