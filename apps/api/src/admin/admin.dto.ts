import { z } from 'zod';
import { toLatinDigits } from '../common/digits.js';

export const idSchema = z.string().uuid();

// Money is always a whole number of the smallest unit (agorot): 150 shekels = 15000.
const MAX_MONEY = 100_000_000;
const price = z.number().int().min(0).max(MAX_MONEY);

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,32}$/, 'username');

const futureDate = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .refine((d) => d.getTime() > Date.now(), 'must be in the future');

export const createClinicSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    // Option 1: a billed term. Ends `months` from now and records what the clinic owes.
    subscription: z.object({ months: z.number().int().min(1).max(60), price }).strict().optional(),
    // Option 2: just an end date, nothing billed. Leave both out for "no end date".
    subscriptionEndsAt: futureDate.optional(),
    owner: z
      .object({
        fullName: z.string().trim().min(2).max(120),
        username,
        phone: z.string().trim().min(5).max(30).optional(),
        specialty: z.string().trim().min(2).max(80).optional(),
      })
      .strict(),
  })
  .strict()
  .refine((v) => !(v.subscription && v.subscriptionEndsAt), {
    message: 'send either subscription or subscriptionEndsAt, not both',
  });

export const listClinicsSchema = z
  .object({
    filter: z.enum(['all', 'active', 'expired', 'suspended', 'unpaid']).default('all'),
    q: z.string().trim().max(100).optional(),
  })
  .strict();

export const statusChangeSchema = z.object({ reason: z.string().trim().min(2).max(200).optional() }).strict();

// Either extend by N months (from the current end date, or from today if it already ended),
// or set an exact new end date.
export const renewSchema = z
  .object({
    months: z.number().int().min(1).max(60).optional(),
    endsAt: futureDate.optional(),
    // What the clinic owes for this term. Leave out for a free extension (nothing is billed).
    price: price.optional(),
  })
  .strict()
  .refine((v) => (v.months === undefined) !== (v.endsAt === undefined), {
    message: 'send exactly one of months or endsAt',
  });

export const auditQuerySchema = z
  .object({
    clinicId: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const notInFuture = (d: Date) => d.getTime() <= Date.now() + 5 * 60 * 1000;

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'invalid date');
const given = (max: number, digits = false) =>
  z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : digits ? toLatinDigits(v.trim()) : v.trim()) : v), z.string().max(max).optional());
const editable = (max: number, digits = false) =>
  z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? null : digits ? toLatinDigits(v.trim()) : v.trim()) : v), z.string().max(max).nullable().optional());

/** The cheque a clinic pays with: the amount is the payment's amount; only the day it can be cashed is required. */
const chequeInfoShape = {
  chequeNumber: given(40, true),
  bankName: given(80),
  accountNumber: given(40, true),
  drawerName: given(120),
  drawerPhone: given(30, true),
  notes: given(500),
};
export const subscriptionChequeSchema = z.object({ dueDate: dateOnly, ...chequeInfoShape }).strict();

export const addPaymentSchema = z
  .object({
    amount: z.number().int().min(1).max(MAX_MONEY),
    paidAt: z
      .string()
      .datetime({ offset: true })
      .transform((v) => new Date(v))
      .refine(notInFuture, 'paidAt cannot be in the future')
      .optional(),
    periodId: idSchema.optional(), // default: the latest term
    note: z.string().trim().min(1).max(300).optional(),
    method: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER', 'CHEQUE']).default('CASH'),
    cheque: subscriptionChequeSchema.optional(), // required with CHEQUE, not allowed otherwise
  })
  .strict()
  .refine((v) => (v.method === 'CHEQUE') === (v.cheque !== undefined), { message: 'cheque details go with method CHEQUE only' });

export const updateSubscriptionChequeSchema = z
  .object({
    dueDate: dateOnly.optional(),
    chequeNumber: editable(40, true),
    bankName: editable(80),
    accountNumber: editable(40, true),
    drawerName: editable(120),
    drawerPhone: editable(30, true),
    notes: editable(500),
  })
  .strict();

export const returnSubscriptionChequeSchema = z.object({ reason: z.string().trim().min(2).max(200) }).strict();

export const listSubscriptionChequesSchema = z
  .object({
    status: z.enum(['PENDING', 'CASHED', 'RETURNED', 'CANCELLED']).optional(),
    clinicId: idSchema.optional(),
    q: z.string().trim().max(80).optional(),
  })
  .strict();

export const cashQuerySchema = z
  .object({
    from: dateOnly.optional(), // local days, both included; default: this month
    to: dateOnly.optional(),
    clinicId: idSchema.optional(),
  })
  .strict();

export const voidPaymentSchema = z.object({ reason: z.string().trim().min(2).max(200) }).strict();

// Meta gives these three values. The token is only ever sent IN (never returned).
export const whatsappSchema = z
  .object({
    phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, 'phoneNumberId'),
    businessAccountId: z.string().trim().regex(/^\d{5,30}$/, 'businessAccountId').nullable().optional(),
    accessToken: z.string().trim().min(20).max(1000).optional(), // left out = keep the saved one
  })
  .strict();
