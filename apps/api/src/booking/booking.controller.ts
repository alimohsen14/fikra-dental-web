import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Public } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { idSchema } from '../scheduling/scheduling.dto.js';
import { bookSchema, daysQuerySchema, incomingSchema, registerSchema, rescheduleSchema, slotsQuerySchema, tokenSchema } from './booking.dto.js';
import { BookingService } from './booking.service.js';

/** The page the patient opens from WhatsApp. No login: the token in the link is the key, and it carries the verified phone. */
@Public()
@Controller('public/book/:token')
export class PublicBookingController {
  constructor(private readonly booking: BookingService) {}

  @Get()
  overview(@Param('token') token: string) {
    return this.booking.overview(parseBody(tokenSchema, token));
  }

  @Post('register')
  register(@Param('token') token: string, @Body() body: unknown) {
    return this.booking.register(parseBody(tokenSchema, token), parseBody(registerSchema, body));
  }

  @Get('days')
  days(@Param('token') token: string, @Query() q: unknown) {
    const query = parseBody(daysQuerySchema, q);
    return this.booking.days(parseBody(tokenSchema, token), query.doctorId, query.appointmentId);
  }

  @Get('slots')
  slots(@Param('token') token: string, @Query() q: unknown) {
    const query = parseBody(slotsQuerySchema, q);
    return this.booking.slots(parseBody(tokenSchema, token), query.doctorId, query.date, query.appointmentId);
  }

  @Post('appointments')
  book(@Param('token') token: string, @Body() body: unknown) {
    return this.booking.book(parseBody(tokenSchema, token), parseBody(bookSchema, body));
  }

  @Patch('appointments/:id')
  reschedule(@Param('token') token: string, @Param('id') id: string, @Body() body: unknown) {
    return this.booking.reschedule(parseBody(tokenSchema, token), parseBody(idSchema, id), parseBody(rescheduleSchema, body));
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  cancel(@Param('token') token: string, @Param('id') id: string) {
    return this.booking.cancel(parseBody(tokenSchema, token), parseBody(idSchema, id));
  }
}

/** Test mode only: pretends a patient wrote to the clinic's WhatsApp number. The real provider calls handleIncoming from its webhook instead. */
@Roles('OWNER', 'DOCTOR', 'SECRETARY')
@Controller('whatsapp')
export class SimulateIncomingController {
  constructor(private readonly booking: BookingService) {}

  @Post('simulate-incoming')
  @HttpCode(200)
  async simulate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.booking.simulateIncoming(user.clinicId!, parseBody(incomingSchema, body).phone);
  }
}
