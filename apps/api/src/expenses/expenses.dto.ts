import { z } from 'zod';

export const idSchema = z.uuid();
const MAX_MONEY = 100_000_000; // 1,000,000 shekels, in agorot
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const instant = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int().min(1).max(MAX_MONEY);
const method = z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']);
const text = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const createCategorySchema = z.object({ name: z.string().trim().min(2).max(60) }).strict();
export const updateCategorySchema = z
  .object({ name: z.string().trim().min(2).max(60).optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const createSupplierSchema = z.object({ name: z.string().trim().min(2).max(100), phone: text(30), notes: text(500) }).strict();
export const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()),
    notes: z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

/** `paidAmount` left out = paid in full on the spot; 0 = bought on credit (we owe it). */
export const createExpenseSchema = z
  .object({
    categoryId: idSchema,
    supplierId: idSchema.optional(),
    description: text(500),
    amount: money,
    incurredAt: instant,
    paidAmount: z.number().int().min(0).max(MAX_MONEY).optional(),
    method: method.optional(),
  })
  .strict();

export const updateExpenseSchema = z
  .object({
    categoryId: idSchema.optional(),
    supplierId: idSchema.nullable().optional(),
    description: z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
    amount: money.optional(),
    incurredAt: instant.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const expensePaymentSchema = z.object({ amount: money, method, paidAt: instant, note: text(300) }).strict();
export const voidSchema = z.object({ reason: z.string().trim().min(2).max(300) }).strict();

export const listExpensesQuerySchema = z
  .object({
    from: date.optional(),
    to: date.optional(), // included
    supplierId: idSchema.optional(),
    categoryId: idSchema.optional(),
    unpaid: z.enum(['1']).optional(),
  })
  .strict();

export const summaryQuerySchema = z.object({ period: z.enum(['day', 'week', 'month', 'year']), date }).strict();

export const monthsQuerySchema = z
  .object({ count: z.coerce.number().int().min(2).max(24).optional(), year: z.coerce.number().int().min(2000).max(2100).optional() })
  .strict()
  .refine((q) => !(q.count && q.year), { message: 'count or year, not both' });

export type CreateExpenseDto = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseDto = z.infer<typeof updateExpenseSchema>;
export type ExpensePaymentDto = z.infer<typeof expensePaymentSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
