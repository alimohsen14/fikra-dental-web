import { z } from 'zod';
import { createPatientSchema } from '../patients/patients.dto.js';

export const tokenSchema = z.string().min(20).max(100);
const id = z.uuid();
const instant = z.string().datetime({ offset: true }).transform((s) => new Date(s));

/** The same form the clinic staff fill, but the phone number is not a field: it is the one WhatsApp reported. */
export const registerSchema = createPatientSchema.omit({ phone: true });
export const bookSchema = z.object({ patientId: id, doctorId: id, startsAt: instant }).strict();
export const rescheduleSchema = z.object({ doctorId: id.optional(), startsAt: instant }).strict();
export const daysQuerySchema = z.object({ doctorId: id, appointmentId: id.optional() }).strict();
export const slotsQuerySchema = z.object({ doctorId: id, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), appointmentId: id.optional() }).strict();
export const incomingSchema = z.object({ phone: z.string().trim().min(5).max(30) }).strict();
