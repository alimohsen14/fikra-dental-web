import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';

const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
const TAKEN = 'هذا النوع موجود من قبل';

@Injectable()
export class TreatmentTypesService {
  constructor(private readonly tenant: TenantPrismaService) {}

  list() {
    return this.tenant.db.treatmentType.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, isActive: true } });
  }

  async create(name: string) {
    try {
      return await this.tenant.db.treatmentType.create({ data: { name } as never, select: { id: true, name: true, isActive: true } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(TAKEN);
      throw e;
    }
  }

  async update(id: string, dto: { name?: string | undefined; isActive?: boolean | undefined }) {
    const found = await this.tenant.db.treatmentType.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('نوع العلاج غير موجود');
    try {
      return await this.tenant.db.treatmentType.update({
        where: { id },
        data: { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
        select: { id: true, name: true, isActive: true },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(TAKEN);
      throw e;
    }
  }
}
