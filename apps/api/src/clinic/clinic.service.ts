import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import type { updateClinicSchema } from './clinic.dto.js';
import { detectImage } from './logo.js';
import { LogoStorage } from './logo.storage.js';

/** Changes a clinic's name / accent color. Used by the clinic owner and by the platform admin. */
@Injectable()
export class ClinicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logos: LogoStorage,
  ) {}

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

  /** Saves a new logo (replacing the old one). The file type is decided from its bytes, never from what the client says. */
  async setLogo(clinicId: string, actorId: string, data: Buffer) {
    const kind = detectImage(data);
    if (!kind) throw new BadRequestException('الملف مش صورة صالحة، استخدم PNG أو JPG أو WebP');
    const url = await this.logos.save(clinicId, data, kind);
    try {
      const { before, after } = await this.changeLogo(clinicId, actorId, url, 'CLINIC_LOGO_UPDATED');
      await this.logos.removeByUrl(before);
      return after;
    } catch (e) {
      await this.logos.removeByUrl(url); // the database refused: do not leave an orphan file
      throw e;
    }
  }

  async removeLogo(clinicId: string, actorId: string) {
    const { before, after } = await this.changeLogo(clinicId, actorId, null, 'CLINIC_LOGO_REMOVED');
    await this.logos.removeByUrl(before);
    return after;
  }

  private async changeLogo(clinicId: string, actorId: string, logoUrl: string | null, action: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.clinic.findUnique({ where: { id: clinicId }, select: { logoUrl: true } });
      if (!current) throw new NotFoundException('العيادة غير موجودة');
      const after = await tx.clinic.update({
        where: { id: clinicId },
        data: { logoUrl },
        select: { id: true, name: true, themeColor: true, logoUrl: true },
      });
      await tx.auditLog.create({
        data: { clinicId, actorUserId: actorId, action, entityType: 'Clinic', entityId: clinicId, before: { logoUrl: current.logoUrl }, after: { logoUrl } },
      });
      return { before: current.logoUrl, after };
    });
  }
}
