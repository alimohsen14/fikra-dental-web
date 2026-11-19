import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { adminUpdateClinicSchema } from '../clinic/clinic.dto.js';
import { ClinicService } from '../clinic/clinic.service.js';
import { readBody } from '../clinic/logo.js';
import {
  addPaymentSchema,
  auditQuerySchema,
  cashQuerySchema,
  createClinicSchema,
  idSchema,
  listClinicsSchema,
  listSubscriptionChequesSchema,
  renewSchema,
  returnSubscriptionChequeSchema,
  statusChangeSchema,
  updateSubscriptionChequeSchema,
  voidPaymentSchema,
  whatsappSchema,
} from './admin.dto.js';
import { AdminChequesService } from './admin-cheques.service.js';
import { AdminService } from './admin.service.js';

// The platform panel. Only PLATFORM_ADMIN (you). Clinic users get 403 on every route here.
@Roles('PLATFORM_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly clinics: ClinicService,
    private readonly cheques: AdminChequesService,
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
    return this.clinics.update(parseBody(idSchema, id), actor.id, parseBody(adminUpdateClinicSchema, body), 'CLINIC_UPDATED');
  }

  @Get('clinics/:id/whatsapp')
  whatsapp(@Param('id') id: string) {
    return this.admin.getWhatsapp(parseBody(idSchema, id));
  }

  @Put('clinics/:id/whatsapp')
  setWhatsapp(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.setWhatsapp(actor.id, parseBody(idSchema, id), parseBody(whatsappSchema, body));
  }

  @Delete('clinics/:id/whatsapp')
  removeWhatsapp(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.admin.removeWhatsapp(actor.id, parseBody(idSchema, id));
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

  // ---- cheques clinics paid with (incoming only) and the platform's cash page
  @Get('cheques')
  listCheques(@Query() query: unknown) {
    return this.cheques.list(parseBody(listSubscriptionChequesSchema, query));
  }

  @Get('cheques/:id')
  getCheque(@Param('id') id: string) {
    return this.cheques.get(parseBody(idSchema, id));
  }

  @Patch('cheques/:id')
  updateCheque(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.cheques.update(actor.id, parseBody(idSchema, id), parseBody(updateSubscriptionChequeSchema, body));
  }

  @Post('cheques/:id/cash')
  @HttpCode(200)
  cashCheque(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.cheques.cash(actor.id, parseBody(idSchema, id));
  }

  @Post('cheques/:id/return')
  @HttpCode(200)
  returnCheque(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.cheques.giveBack(actor.id, parseBody(idSchema, id), parseBody(returnSubscriptionChequeSchema, body));
  }

  @Post('cheques/:id/image')
  @HttpCode(200)
  async chequeImage(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.cheques.setImage(actor.id, parseBody(idSchema, id), await readBody(req, 10 * 1024 * 1024, 'الصورة كبيرة، الحد الأقصى 10 ميجابايت'));
  }

  @Get('cheques/:id/image')
  async chequeImageFile(@Param('id') id: string, @Res() res: Response) {
    const { path, mime } = await this.cheques.imageOf(parseBody(idSchema, id));
    res.set({ 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
    res.sendFile(path, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }

  @Get('cash')
  cashPage(@Query() query: unknown) {
    return this.cheques.cashPage(parseBody(cashQuerySchema, query));
  }

  @Get('audit')
  audit(@Query() query: unknown) {
    return this.admin.listAudit(parseBody(auditQuerySchema, query));
  }
}
