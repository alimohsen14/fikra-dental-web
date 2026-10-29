import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

// .strict() rejects unknown fields (e.g. someone sending clinicId or role).
export const loginSchema = z
  .object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) })
  .strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) })
  .strict();

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException('بيانات غير صالحة');
  return result.data;
}
