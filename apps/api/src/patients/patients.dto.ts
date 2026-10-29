import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
// Empty strings from forms become "not provided".
const optionalText = (max: number) =>
  z.preprocess((v) => (v === '' ? undefined : v), text(max).optional());
const nullableText = (max: number) =>
  z.preprocess((v) => (v === '' ? null : v), text(max).nullable().optional());

const birthDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1900 && d <= new Date();
  });

const base = {
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(1).max(30),
  gender: z.enum(['MALE', 'FEMALE']),
};

export const createPatientSchema = z
  .object({
    fullName: base.fullName,
    phone: base.phone,
    nationalId: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(5).max(20).optional()),
    birthDate: z.preprocess((v) => (v === '' ? undefined : v), birthDate.optional()),
    gender: z.preprocess((v) => (v === '' ? undefined : v), base.gender.optional()),
    region: optionalText(80),
    address: optionalText(200),
    notes: optionalText(2000),
    medicalAlerts: optionalText(1000),
  })
  .strict();

// On update, optional fields may be sent as null (or "") to clear them.
export const updatePatientSchema = z
  .object({
    fullName: base.fullName.optional(),
    phone: base.phone.optional(),
    nationalId: z.preprocess(
      (v) => (v === '' ? null : v),
      z.string().trim().min(5).max(20).nullable().optional(),
    ),
    birthDate: z.preprocess((v) => (v === '' ? null : v), birthDate.nullable().optional()),
    gender: z.preprocess((v) => (v === '' ? null : v), base.gender.nullable().optional()),
    region: nullableText(80),
    address: nullableText(200),
    notes: nullableText(2000),
    medicalAlerts: nullableText(1000),
  })
  .strict();

export const listPatientsSchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    archived: z.enum(['true', 'false']).default('false'),
  })
  .strict();

export const idSchema = z.uuid();

export type CreatePatientDto = z.infer<typeof createPatientSchema>;
export type UpdatePatientDto = z.infer<typeof updatePatientSchema>;
export type ListPatientsQuery = z.infer<typeof listPatientsSchema>;
