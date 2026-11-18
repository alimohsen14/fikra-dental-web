import { z } from 'zod';
import { toLatinDigits } from '../common/digits.js';
import { idSchema } from '../treatments/treatments.dto.js';

const MAX_MONEY = 100_000_000; // 1,000,000 shekels, in agorot
const instant = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const money = z.number().int().min(1).max(MAX_MONEY);
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'invalid date');

// Creating: an empty box means "not given". Editing: an empty box means "clear it".
const given = (max: number, digits = false) =>
  z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : digits ? toLatinDigits(v.trim()) : v.trim()) : v), z.string().max(max).optional());
const editable = (max: number, digits = false) =>
  z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? null : digits ? toLatinDigits(v.trim()) : v.trim()) : v), z.string().max(max).nullable().optional());

export const createChequeSchema = z
  .object({
    amount: money.optional(),
    dueDate: dateOnly.optional(),
    chequeNumber: given(40, true),
    bankName: given(80),
    accountNumber: given(40, true),
    drawerName: given(120),
    drawerPhone: given(30, true),
    notes: given(500),
  })
  .strict();

export const updateChequeSchema = z
  .object({
    amount: money.optional(),
    dueDate: dateOnly.optional(),
    chequeNumber: editable(40, true),
    bankName: editable(80),
    accountNumber: editable(40, true),
    drawerName: editable(120),
    drawerPhone: editable(30, true),
    notes: editable(500),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const cashChequeSchema = z.object({ cashedAt: instant.optional() }).strict();
export const returnChequeSchema = z.object({ reason: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().min(2).max(300).optional()) }).strict();

export const listChequesSchema = z
  .object({
    direction: z.enum(['INCOMING', 'OUTGOING']).optional(),
    status: z.enum(['PENDING', 'CASHED', 'RETURNED', 'ENDORSED', 'CANCELLED']).optional(),
    incomplete: z.literal('true').optional(),
    treatmentId: idSchema.optional(),
    patientId: idSchema.optional(),
    q: z.string().trim().max(80).optional(),
  })
  .strict();

export type CreateChequeDto = z.infer<typeof createChequeSchema>;
export type UpdateChequeDto = z.infer<typeof updateChequeSchema>;
export type ListChequesQuery = z.infer<typeof listChequesSchema>;
