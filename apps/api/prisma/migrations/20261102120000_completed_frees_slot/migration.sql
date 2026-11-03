-- A finished visit no longer holds the doctor's time: if the patient came early and the treatment was opened on a
-- later appointment, that later slot is free again. Only waiting (PENDING) and confirmed appointments block time.
ALTER TABLE "Appointment" DROP CONSTRAINT "appointment_no_overlap_per_doctor";
ALTER TABLE "Appointment"
  ADD CONSTRAINT "appointment_no_overlap_per_doctor"
  EXCLUDE USING gist (
    "doctorId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" IN ('PENDING', 'CONFIRMED'));
