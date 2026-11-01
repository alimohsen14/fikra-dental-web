import { z } from 'zod';

export const idSchema = z.uuid();

export const SLOT_MINUTES = 30; // appointments start on :00 or :30 and last 30 or 60 minutes
export const DURATIONS = [30, 60] as const;
export const MAX_RANGE_DAYS = 31;

const instant = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));
const duration = z.union([z.literal(30), z.literal(60)]);
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
const emptyToNull = (v: unknown) => (v === '' ? null : v);

export const createAppointmentSchema = z
  .object({
    patientId: idSchema,
    doctorId: idSchema,
    startsAt: instant,
    durationMinutes: duration,
    notes: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
  })
  .strict();

export const updateAppointmentSchema = z
  .object({
    doctorId: idSchema.optional(),
    startsAt: instant.optional(),
    durationMinutes: duration.optional(),
    notes: z.preprocess(emptyToNull, z.string().trim().max(1000).nullable().optional()),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'nothing to update' });

export const listAppointmentsSchema = z
  .object({
    from: instant,
    to: instant,
    doctorId: idSchema.optional(),
    status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
  })
  .strict()
  .refine((v) => v.to > v.from && v.to.getTime() - v.from.getTime() <= MAX_RANGE_DAYS * 86_400_000, { message: 'bad range' });

export const cancelAppointmentSchema = z.object({ reason: z.string().trim().min(2).max(300).optional() }).strict();

const period = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1410),
    endMinute: z.number().int().min(30).max(1440),
  })
  .strict()
  .refine((p) => p.startMinute % SLOT_MINUTES === 0 && p.endMinute % SLOT_MINUTES === 0 && p.endMinute > p.startMinute, { message: 'bad period' });

// Several periods per day are fine (morning + evening) as long as they do not overlap.
export const workingPeriodsSchema = z
  .object({ periods: z.array(period).max(28) })
  .strict()
  .refine(
    (v) => {
      const byDay = new Map<number, { startMinute: number; endMinute: number }[]>();
      for (const p of v.periods) byDay.set(p.weekday, [...(byDay.get(p.weekday) ?? []), p]);
      return [...byDay.values()].every((list) => {
        const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute);
        return sorted.every((p, i) => i === 0 || sorted[i - 1]!.endMinute <= p.startMinute);
      });
    },
    { message: 'periods overlap' },
  );

export type CreateAppointmentDto = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentDto = z.infer<typeof updateAppointmentSchema>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsSchema>;
export type WorkingPeriodsDto = z.infer<typeof workingPeriodsSchema>;
