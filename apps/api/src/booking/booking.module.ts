import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { PublicBookingController, SimulateIncomingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';

@Module({
  imports: [MessagingModule, PatientsModule, SchedulingModule],
  controllers: [PublicBookingController, SimulateIncomingController],
  providers: [BookingService],
})
export class BookingModule {}
