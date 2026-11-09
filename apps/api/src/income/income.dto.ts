import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const myIncomeQuerySchema = z.object({ period: z.enum(['day', 'week', 'month', 'year']), date }).strict();
export const myIncomeMonthsQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).strict();
