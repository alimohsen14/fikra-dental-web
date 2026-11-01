import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { AppointmentsService } from './appointments.service.js';
import { cancelAppointmentSchema, createAppointmentSchema, idSchema, listAppointmentsSchema, updateAppointmentSchema } from './scheduling.dto.js';

// Owner and secretary use every doctor's calendar. A doctor sees and books only their own.
@Roles('OWNER', 'DOCTOR', 'SECRETARY')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.appointments.create(user, parseBody(createAppointmentSchema, body));
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.appointments.list(user, parseBody(listAppointmentsSchema, query));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appointments.get(user, parseBody(idSchema, id));
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.appointments.update(user, parseBody(idSchema, id), parseBody(updateAppointmentSchema, body));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appointments.confirm(user, parseBody(idSchema, id));
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appointments.complete(user, parseBody(idSchema, id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.appointments.cancel(user, parseBody(idSchema, id), parseBody(cancelAppointmentSchema, body ?? {}).reason);
  }
}
