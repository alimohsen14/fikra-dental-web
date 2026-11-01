import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { DoctorsController } from './doctors.controller.js';
import { DoctorsService } from './doctors.service.js';

@Module({
  controllers: [DoctorsController, AppointmentsController],
  providers: [DoctorsService, AppointmentsService],
})
export class SchedulingModule {}
