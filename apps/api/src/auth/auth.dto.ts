import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { toLatinDigits } from '../common/digits.js';

// .strict() rejects unknown fields (e.g. someone sending clinicId or role).
export const acceptTermsSchema = z.object({ version: z.string().min(1).max(40) }).strict();

export const loginSchema = z
  .object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) })
  .strict();

export const twoFactorSchema = z
  .object({ challengeToken: z.string().min(10).max(2000), code: z.preprocess((v) => (typeof v === 'string' ? toLatinDigits(v) : v), z.string().trim().min(6).max(20)) })
  .strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) })
  .strict();

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException('بيانات غير صالحة');
  return result.data;
}
