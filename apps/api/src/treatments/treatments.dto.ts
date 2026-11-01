import { z } from 'zod';
import { isValidTooth } from './teeth.js';

export const idSchema = z.uuid();

const MAX_MONEY = 100_000_000; // 1,000,000 shekels, in agorot
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

// Every tooth carries its own treatment type; cost and sessions belong to the whole treatment.
const teeth = z
  .array(z.object({ toothCode: z.number().int().refine(isValidTooth, 'invalid tooth'), treatmentTypeId: idSchema }).strict())
  .min(1)
  .max(52)
  .refine((a) => new Set(a.map((t) => t.toothCode)).size === a.length, 'duplicate tooth');
const money = z.number().int().min(0).max(MAX_MONEY);
const sessions = z.number().int().min(1).max(50);
const instant = z.string().datetime({ offset: true }).transform((s) => new Date(s));

export const createTreatmentSchema = z
  .object({
    patientId: idSchema,
    doctorId: idSchema.optional(),
    teeth,
    description: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
    totalCost: money,
    plannedSessions: sessions,
    appointmentId: idSchema.optional(),
    startedAt: instant.optional(),
  })
  .strict();

export const updateTreatmentSchema = z
  .object({
    teeth: teeth.optional(),
    description: z.preprocess(emptyToNull, z.string().trim().max(1000).nullable().optional()),
    totalCost: money.optional(),
    plannedSessions: sessions.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const listTreatmentsSchema = z
  .object({ patientId: idSchema.optional(), status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).optional() })
  .strict();

export const completeSessionSchema = z.object({ notes: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()) }).strict();
export const cancelTreatmentSchema = z.object({ reason: z.preprocess(emptyToUndefined, z.string().trim().min(2).max(300).optional()) }).strict();

export const createPaymentSchema = z
  .object({
    amount: z.number().int().min(1).max(MAX_MONEY),
    method: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']),
    paidAt: instant,
    note: z.preprocess(emptyToUndefined, z.string().trim().max(300).optional()),
  })
  .strict();
export const voidPaymentSchema = z.object({ reason: z.string().trim().min(2).max(300) }).strict();

export const createTypeSchema = z.object({ name: z.string().trim().min(2).max(80), parentId: idSchema.optional() }).strict();
export const updateTypeSchema = z
  .object({ name: z.string().trim().min(2).max(80).optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const bookSessionSchema = z
  .object({
    doctorId: idSchema.optional(), // default: the treatment's own doctor
    startsAt: instant,
    durationMinutes: z.union([z.literal(30), z.literal(60)]),
    notes: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
  })
  .strict();

export type BookSessionDto = z.infer<typeof bookSessionSchema>;
export type CreateTreatmentDto = z.infer<typeof createTreatmentSchema>;
export type UpdateTreatmentDto = z.infer<typeof updateTreatmentSchema>;
export type ListTreatmentsQuery = z.infer<typeof listTreatmentsSchema>;
export type CreatePaymentDto = z.infer<typeof createPaymentSchema>;
