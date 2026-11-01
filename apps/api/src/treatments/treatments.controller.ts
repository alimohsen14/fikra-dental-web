import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { RequiresPayments, Roles } from '../auth/roles.decorator.js';
import { TreatmentTypesService } from './treatment-types.service.js';
import { TreatmentsService } from './treatments.service.js';
import {
  cancelTreatmentSchema,
  completeSessionSchema,
  createPaymentSchema,
  createTreatmentSchema,
  createTypeSchema,
  idSchema,
  listTreatmentsSchema,
  updateTreatmentSchema,
  updateTypeSchema,
  voidPaymentSchema,
} from './treatments.dto.js';

// Doctors write treatments (their own patients). A secretary only gets in with the payments key, to see and record payments.
@Roles('OWNER', 'DOCTOR', 'SECRETARY')
@Controller()
export class TreatmentsController {
  constructor(
    private readonly treatments: TreatmentsService,
    private readonly types: TreatmentTypesService,
  ) {}

  // ---- treatment types (the clinic's own list)
  @Roles('OWNER', 'DOCTOR')
  @Get('treatment-types')
  listTypes() {
    return this.types.list();
  }

  @Roles('OWNER', 'DOCTOR')
  @Post('treatment-types')
  createType(@Body() body: unknown) {
    return this.types.create(parseBody(createTypeSchema, body).name);
  }

  @Roles('OWNER')
  @Patch('treatment-types/:id')
  updateType(@Param('id') id: string, @Body() body: unknown) {
    return this.types.update(parseBody(idSchema, id), parseBody(updateTypeSchema, body));
  }

  // ---- treatments
  @Get('treatments')
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.treatments.list(user, parseBody(listTreatmentsSchema, query));
  }

  @Roles('OWNER', 'DOCTOR')
  @Post('treatments')
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.treatments.create(user, parseBody(createTreatmentSchema, body));
  }

  @Get('treatments/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.treatments.get(user, parseBody(idSchema, id));
  }

  @Roles('OWNER', 'DOCTOR')
  @Patch('treatments/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.treatments.update(user, parseBody(idSchema, id), parseBody(updateTreatmentSchema, body));
  }

  @Roles('OWNER', 'DOCTOR')
  @Post('treatments/:id/sessions/:number/complete')
  @HttpCode(200)
  completeSession(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('number', ParseIntPipe) number: number, @Body() body: unknown) {
    return this.treatments.completeSession(user, parseBody(idSchema, id), number, parseBody(completeSessionSchema, body ?? {}).notes);
  }

  @Roles('OWNER', 'DOCTOR')
  @Post('treatments/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.treatments.cancel(user, parseBody(idSchema, id), parseBody(cancelTreatmentSchema, body ?? {}).reason);
  }

  // ---- money
  @RequiresPayments()
  @Post('treatments/:id/payments')
  addPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.treatments.addPayment(user, parseBody(idSchema, id), parseBody(createPaymentSchema, body));
  }

  @Roles('OWNER')
  @Post('payments/:id/void')
  @HttpCode(200)
  voidPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.treatments.voidPayment(user, parseBody(idSchema, id), parseBody(voidPaymentSchema, body).reason);
  }

  @RequiresPayments()
  @Get('patients/:id/finance')
  finance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.treatments.patientFinance(user, parseBody(idSchema, id));
  }
}
