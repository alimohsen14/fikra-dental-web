import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';

const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
const TAKEN = 'هذا النوع موجود من قبل';
const SELECT = { id: true, name: true, isActive: true, parentId: true } as const;

/** Two levels only: a type (crown) and its sub-types (zirconia, porcelain...). */
@Injectable()
export class TreatmentTypesService {
  constructor(private readonly tenant: TenantPrismaService) {}

  list() {
    return this.tenant.db.treatmentType.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], select: SELECT });
  }

  /** Top-level names are checked here (a normal unique index treats NULL parents as different). */
  private async nameTaken(name: string, parentId: string | null, exceptId?: string) {
    const found = await this.tenant.db.treatmentType.findFirst({ where: { name, parentId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    return found !== null;
  }

  async create(name: string, parentId: string | undefined) {
    if (parentId) {
      const parent = await this.tenant.db.treatmentType.findUnique({ where: { id: parentId }, select: { parentId: true } });
      if (!parent) throw new NotFoundException('النوع الأساسي غير موجود');
      if (parent.parentId) throw new BadRequestException('الأنواع الفرعية مستوى واحد فقط');
    }
    if (await this.nameTaken(name, parentId ?? null)) throw new ConflictException(TAKEN);
    try {
      return await this.tenant.db.treatmentType.create({ data: { name, parentId: parentId ?? null } as never, select: SELECT });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(TAKEN);
      throw e;
    }
  }

  async update(id: string, dto: { name?: string | undefined; isActive?: boolean | undefined }) {
    const found = await this.tenant.db.treatmentType.findUnique({ where: { id }, select: { parentId: true } });
    if (!found) throw new NotFoundException('نوع العلاج غير موجود');
    if (dto.name !== undefined && (await this.nameTaken(dto.name, found.parentId, id))) throw new ConflictException(TAKEN);
    try {
      return await this.tenant.db.treatmentType.update({
        where: { id },
        data: { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
        select: SELECT,
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(TAKEN);
      throw e;
    }
  }
}
