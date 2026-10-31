import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { updateClinicSchema } from '../clinic/clinic.dto.js';
import { ClinicService } from '../clinic/clinic.service.js';
import {
  addPaymentSchema,
  auditQuerySchema,
  createClinicSchema,
  idSchema,
  listClinicsSchema,
  renewSchema,
  statusChangeSchema,
  voidPaymentSchema,
} from './admin.dto.js';
import { AdminService } from './admin.service.js';

// The platform panel. Only PLATFORM_ADMIN (you). Clinic users get 403 on every route here.
@Roles('PLATFORM_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly clinics: ClinicService,
  ) {}

  @Post('clinics')
  create(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.admin.createClinic(actor.id, parseBody(createClinicSchema, body));
  }

  @Get('clinics')
  list(@Query() query: unknown) {
    return this.admin.listClinics(parseBody(listClinicsSchema, query));
  }

  @Get('clinics/:id')
  get(@Param('id') id: string) {
    return this.admin.getClinic(parseBody(idSchema, id));
  }

  @Patch('clinics/:id')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.clinics.update(parseBody(idSchema, id), actor.id, parseBody(updateClinicSchema, body), 'CLINIC_UPDATED');
  }

  @Post('clinics/:id/suspend')
  @HttpCode(200)
  suspend(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.setStatus(actor.id, parseBody(idSchema, id), 'SUSPENDED', parseBody(statusChangeSchema, body ?? {}));
  }

  @Post('clinics/:id/activate')
  @HttpCode(200)
  activate(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.setStatus(actor.id, parseBody(idSchema, id), 'ACTIVE', parseBody(statusChangeSchema, body ?? {}));
  }

  @Post('clinics/:id/renew')
  @HttpCode(200)
  renew(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.renew(actor.id, parseBody(idSchema, id), parseBody(renewSchema, body));
  }

  @Post('clinics/:id/reset-owner-password')
  @HttpCode(200)
  resetOwnerPassword(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.admin.resetOwnerPassword(actor.id, parseBody(idSchema, id));
  }

  @Get('clinics/:id/billing')
  billing(@Param('id') id: string) {
    return this.admin.getBilling(parseBody(idSchema, id));
  }

  @Post('clinics/:id/payments')
  addPayment(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.addPayment(actor.id, parseBody(idSchema, id), parseBody(addPaymentSchema, body));
  }

  @Post('clinics/:id/payments/:paymentId/void')
  @HttpCode(200)
  voidPayment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
  ) {
    return this.admin.voidPayment(
      actor.id,
      parseBody(idSchema, id),
      parseBody(idSchema, paymentId),
      parseBody(voidPaymentSchema, body),
    );
  }

  @Get('audit')
  audit(@Query() query: unknown) {
    return this.admin.listAudit(parseBody(auditQuerySchema, query));
  }
}
