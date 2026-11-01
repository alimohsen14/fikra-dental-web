import { z } from 'zod';

export const idSchema = z.uuid();

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,32}$/, 'username');
const fullName = z.string().trim().min(2).max(120);
const phone = z.string().trim().min(5).max(30);
const specialty = z.string().trim().min(2).max(80);

// The owner can add doctors and secretaries only: a second owner or a platform admin can never be created here.
export const createStaffSchema = z
  .object({
    username,
    fullName,
    role: z.enum(['DOCTOR', 'SECRETARY']),
    phone: phone.optional(),
    specialty: specialty.optional(),
    canManagePayments: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.role === 'DOCTOR' || v.specialty === undefined, { message: 'specialty is for doctors only' });

export const updateStaffSchema = z
  .object({
    fullName: fullName.optional(),
    phone: phone.nullable().optional(),
    specialty: specialty.nullable().optional(),
    canManagePayments: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export type CreateStaffDto = z.infer<typeof createStaffSchema>;
export type UpdateStaffDto = z.infer<typeof updateStaffSchema>;
