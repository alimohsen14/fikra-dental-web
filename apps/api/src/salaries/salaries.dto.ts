import { z } from 'zod';
import { idSchema, voidSchema } from '../expenses/expenses.dto.js';

export { idSchema, voidSchema };
const MAX_MONEY = 100_000_000;
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const instant = z.string().datetime({ offset: true }).transform((s) => new Date(s));

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const monthQuerySchema = z.object({ month: monthSchema }).strict();
export const setSalarySchema = z.object({ monthlySalary: z.number().int().min(0).max(MAX_MONEY) }).strict();
export const adjustSchema = z
  .object({
    adjustment: z.number().int().min(-MAX_MONEY).max(MAX_MONEY),
    adjustNote: z.preprocess(emptyToNull, z.string().trim().max(300).nullable().optional()),
  })
  .strict();
export const salaryPaymentSchema = z
  .object({
    kind: z.enum(['SALARY', 'ADVANCE']),
    amount: z.number().int().min(1).max(MAX_MONEY),
    method: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']),
    paidAt: instant,
    note: z.preprocess(emptyToUndefined, z.string().trim().max(300).optional()),
  })
  .strict();

export type SalaryPaymentDto = z.infer<typeof salaryPaymentSchema>;
export type AdjustDto = z.infer<typeof adjustSchema>;
