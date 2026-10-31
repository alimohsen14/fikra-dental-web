import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import type { updateClinicSchema } from './clinic.dto.js';

/** Changes a clinic's name / accent color. Used by the clinic owner and by the platform admin. */
@Injectable()
export class ClinicService {
  constructor(private readonly prisma: PrismaService) {}

  async update(clinicId: string, actorId: string, dto: z.infer<typeof updateClinicSchema>, action: string) {
    const before = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true, themeColor: true },
    });
    if (!before) throw new NotFoundException('العيادة غير موجودة');

    const data = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.themeColor !== undefined ? { themeColor: dto.themeColor } : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.clinic.update({
        where: { id: clinicId },
        data,
        select: { id: true, name: true, themeColor: true, logoUrl: true },
      });
      await tx.auditLog.create({
        data: {
          clinicId,
          actorUserId: actorId,
          action,
          entityType: 'Clinic',
          entityId: clinicId,
          before,
          after: { name: after.name, themeColor: after.themeColor },
        },
      });
      return after;
    });
  }
}
