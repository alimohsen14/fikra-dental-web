import { z } from 'zod';

// Fields a clinic's identity can change. Everything else (status, subscription, logo...) is NOT here,
// and .strict() rejects it. Send themeColor: null to go back to the default color.
export const updateClinicSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    themeColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .transform((c) => c.toLowerCase())
      .nullable()
      .optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.themeColor !== undefined, { message: 'nothing to update' });
