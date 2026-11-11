import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { detectImage } from '../clinic/logo.js';
import { PrismaService } from '../database/prisma.service.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import { XrayStorage } from './xrays.storage.js';

export const XRAY_MAX_BYTES = 10 * 1024 * 1024;

const LIST = {
  id: true,
  createdAt: true,
  note: true,
  size: true,
  treatmentId: true,
  patientId: true,
  uploadedByUserId: true,
  uploadedBy: { select: { fullName: true } },
  treatment: { select: { description: true } },
} as const;

/**
 * X-rays belong to a treatment (and show in the patient's record). The owner and doctors add them; everyone who can open the
 * record can look. The image itself is only ever sent to a logged-in user of the SAME clinic: the stored name is never a link.
 */
@Injectable()
export class XraysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantPrismaService,
    private readonly storage: XrayStorage,
  ) {}

  async add(user: AuthUser, treatmentId: string, data: Buffer, note: string | null) {
    const clinicId = user.clinicId!;
    const treatment = await this.tenant.db.treatment.findUnique({ where: { id: treatmentId }, select: { patientId: true, status: true } });
    if (!treatment) throw new NotFoundException('العلاج غير موجود');
    if (treatment.status === 'CANCELLED') throw new ConflictException('العلاج ملغي');
    const kind = detectImage(data);
    if (!kind) throw new UnsupportedMediaTypeException('يجب أن يكون الملف صورة (JPG أو PNG أو WEBP)');
    const file = await this.storage.save(clinicId, data, kind);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const x = await tx.xRay.create({
          data: { clinicId, patientId: treatment.patientId, treatmentId, file, mime: kind.mime, size: data.length, note, uploadedByUserId: user.id },
          select: LIST,
        });
        await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'XRAY_ADDED', entityType: 'XRay', entityId: x.id, after: { treatmentId, size: data.length } } });
        return x;
      });
      return row;
    } catch (e) {
      await this.storage.remove(file); // the database refused: do not leave an orphan file
      throw e;
    }
  }

  async ofTreatment(treatmentId: string) {
    if (!(await this.tenant.db.treatment.findUnique({ where: { id: treatmentId }, select: { id: true } }))) throw new NotFoundException('العلاج غير موجود');
    return this.tenant.db.xRay.findMany({ where: { treatmentId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: LIST });
  }

  async ofPatient(patientId: string) {
    if (!(await this.tenant.db.patient.findUnique({ where: { id: patientId }, select: { id: true } }))) throw new NotFoundException('المريض غير موجود');
    return this.tenant.db.xRay.findMany({ where: { patientId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: LIST });
  }

  async fileOf(id: string) {
    const x = await this.tenant.db.xRay.findUnique({ where: { id }, select: { file: true, mime: true } });
    const path = x ? this.storage.pathOf(x.file) : null;
    if (!x || !path) throw new NotFoundException('الصورة غير موجودة');
    return { path, mime: x.mime };
  }

  /** The owner, or the doctor who added it, can remove an image (for example one added to the wrong treatment). */
  async remove(user: AuthUser, id: string) {
    const x = await this.tenant.db.xRay.findUnique({ where: { id }, select: { file: true, uploadedByUserId: true, treatmentId: true } });
    if (!x) throw new NotFoundException('الصورة غير موجودة');
    if (user.role !== 'OWNER' && x.uploadedByUserId !== user.id) throw new ForbiddenException('يمكنك حذف الأشعة التي أضفتها أنت فقط');
    const clinicId = user.clinicId!;
    await this.prisma.$transaction(async (tx) => {
      await tx.xRay.deleteMany({ where: { id, clinicId } });
      await tx.auditLog.create({ data: { clinicId, actorUserId: user.id, action: 'XRAY_DELETED', entityType: 'XRay', entityId: id, before: { treatmentId: x.treatmentId } } });
    });
    await this.storage.remove(x.file);
    return { ok: true };
  }
}
