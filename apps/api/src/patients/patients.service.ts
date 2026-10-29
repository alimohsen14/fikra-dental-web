import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePhone } from '../common/phone.js';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import type { CreatePatientDto, ListPatientsQuery, UpdatePatientDto } from './patients.dto.js';

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;
  return new Date(value + 'T00:00:00Z');
}

function phoneOrThrow(input: string): string {
  const phone = normalizePhone(input);
  if (!phone) throw new BadRequestException('رقم الهاتف غير صالح');
  return phone;
}

@Injectable()
export class PatientsService {
  constructor(private readonly tenant: TenantPrismaService) {}

  async create(dto: CreatePatientDto) {
    const phone = phoneOrThrow(dto.phone);
    // Families share phones, so a duplicate is a warning, never a block.
    const sharedPhone = await this.tenant.db.patient.findMany({
      where: { phone, archivedAt: null },
      select: { id: true, fullName: true },
      take: 5,
    });
    try {
      const patient = await this.tenant.db.patient.create({
        data: { ...dto, phone, birthDate: toDate(dto.birthDate) ?? null } as never,
      });
      return { patient, sharedPhoneWith: sharedPhone };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('رقم الهوية مسجل لمريض آخر في العيادة');
      throw e;
    }
  }

  async list(query: ListPatientsQuery) {
    const { q, page, pageSize } = query;
    const digits = q?.replace(/\D/g, '') ?? '';
    const where = {
      archivedAt: query.archived === 'true' ? { not: null } : null,
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' as const } },
              { nationalId: { startsWith: q } },
              ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.tenant.db.patient.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.tenant.db.patient.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string) {
    const patient = await this.tenant.db.patient.findUnique({ where: { id } });
    if (!patient) throw new NotFoundException('المريض غير موجود');
    return patient;
  }

  async update(id: string, dto: UpdatePatientDto) {
    await this.get(id);
    const data = {
      ...dto,
      ...(dto.phone !== undefined ? { phone: phoneOrThrow(dto.phone) } : {}),
      ...(dto.birthDate !== undefined ? { birthDate: toDate(dto.birthDate) } : {}),
    };
    try {
      return await this.tenant.db.patient.update({ where: { id }, data: data as never });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('رقم الهوية مسجل لمريض آخر في العيادة');
      throw e;
    }
  }

  /** Patients are never hard-deleted: archiving hides them from the normal list. */
  async setArchived(id: string, archived: boolean) {
    await this.get(id);
    return this.tenant.db.patient.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    });
  }
}
