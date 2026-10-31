import { z } from 'zod';

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
    themeColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
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
  })
  .strict();

export const voidPaymentSchema = z.object({ reason: z.string().trim().min(2).max(200) }).strict();
