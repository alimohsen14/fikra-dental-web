import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TEMP_PASSWORD_TTL_DAYS } from '../auth/auth.constants.js';
import { PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateStaffDto, UpdateStaffDto } from './staff.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const SELECT = {
  id: true,
  username: true,
  fullName: true,
  phone: true,
  role: true,
  isActive: true,
  canManagePayments: true,
  mustChangePassword: true,
  createdAt: true,
  doctor: { select: { id: true, specialty: true, isActive: true } },
} as const;

const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

// Accounts live in the auth tables, so this service uses the raw client. SAFETY RULE: every query below
// carries the clinicId that came from the logged-in owner's token, never from the request.
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  list(clinicId: string) {
    return this.prisma.user.findMany({ where: { clinicId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: SELECT });
  }

  private async mustFind(clinicId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, clinicId }, select: SELECT });
    if (!user) throw new NotFoundException('الموظف غير موجود');
    return user;
  }

  /** The owner's own account is managed elsewhere (settings, change-password). */
  private editable(actorId: string, user: { id: string; role: string }) {
    if (user.role === 'OWNER') throw new BadRequestException('حساب المالك ما بينعدل من هون');
    if (user.id === actorId) throw new BadRequestException('ما بتقدر تعدل حسابك من هون');
  }

  async create(clinicId: string, actorId: string, dto: CreateStaffDto) {
    if (await this.prisma.user.findUnique({ where: { username: dto.username }, select: { id: true } })) {
      throw new ConflictException('اسم المستخدم مستخدم من قبل');
    }
    const temporaryPassword = this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const temporaryPasswordExpiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_DAYS * DAY_MS);
    try {
      const staff = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            clinicId,
            username: dto.username,
            passwordHash,
            fullName: dto.fullName,
            phone: dto.phone ?? null,
            role: dto.role,
            canManagePayments: dto.canManagePayments ?? false,
            mustChangePassword: true,
            temporaryPasswordExpiresAt,
          },
        });
        if (dto.role === 'DOCTOR') {
          await tx.doctor.create({ data: { clinicId, userId: user.id, fullName: dto.fullName, specialty: dto.specialty ?? null, phone: dto.phone ?? null } });
        }
        await tx.auditLog.create({
          data: { clinicId, actorUserId: actorId, action: 'STAFF_CREATED', entityType: 'User', entityId: user.id, after: { username: user.username, role: dto.role } },
        });
        return tx.user.findUniqueOrThrow({ where: { id: user.id }, select: SELECT });
      });
      return { staff, temporaryPassword, temporaryPasswordExpiresAt }; // shown once, never stored in plain text
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('اسم المستخدم مستخدم من قبل');
      throw e;
    }
  }

  async update(clinicId: string, actorId: string, id: string, dto: UpdateStaffDto) {
    const user = await this.mustFind(clinicId, id);
    this.editable(actorId, user);
    if (dto.specialty !== undefined && !user.doctor) throw new BadRequestException('التخصص للدكاترة بس');
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.canManagePayments !== undefined ? { canManagePayments: dto.canManagePayments } : {}),
        },
      });
      if (user.doctor) {
        await tx.doctor.update({
          where: { id: user.doctor.id },
          data: {
            ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
            ...(dto.specialty !== undefined ? { specialty: dto.specialty } : {}),
          },
        });
      }
      await tx.auditLog.create({
        data: { clinicId, actorUserId: actorId, action: 'STAFF_UPDATED', entityType: 'User', entityId: id, after: { fields: Object.keys(dto) } },
      });
      return tx.user.findUniqueOrThrow({ where: { id }, select: SELECT });
    });
  }

  /**
   * Stops (or restores) an account. Nothing is deleted. A stopped doctor disappears from booking, but
   * existing appointments are never cancelled automatically: the reply says how many are still ahead.
   */
  async setActive(clinicId: string, actorId: string, id: string, active: boolean) {
    const user = await this.mustFind(clinicId, id);
    this.editable(actorId, user);
    const staff = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: active } });
      if (user.doctor) await tx.doctor.update({ where: { id: user.doctor.id }, data: { isActive: active } });
      if (!active) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: { clinicId, actorUserId: actorId, action: active ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED', entityType: 'User', entityId: id },
      });
      return tx.user.findUniqueOrThrow({ where: { id }, select: SELECT });
    });
    const upcomingAppointments = !active && user.doctor
      ? await this.prisma.appointment.count({ where: { clinicId, doctorId: user.doctor.id, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gte: new Date() } } })
      : 0;
    return { staff, upcomingAppointments };
  }

  /** New temporary password (forgot password). Old sessions end and a lockout is cleared. Shown ONCE. */
  async resetPassword(clinicId: string, actorId: string, id: string) {
    const user = await this.mustFind(clinicId, id);
    this.editable(actorId, user);
    const temporaryPassword = this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const temporaryPasswordExpiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_DAYS * DAY_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true, temporaryPasswordExpiresAt, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { clinicId, actorUserId: actorId, action: 'STAFF_PASSWORD_RESET', entityType: 'User', entityId: id } });
    });
    return { staff: user, temporaryPassword, temporaryPasswordExpiresAt };
  }
}
