import { Module } from '@nestjs/common';
import { ClinicController } from './clinic.controller.js';
import { ClinicService } from './clinic.service.js';
import { LogoStorage } from './logo.storage.js';

@Module({
  controllers: [ClinicController],
  providers: [ClinicService, LogoStorage],
  exports: [ClinicService],
})
export class ClinicModule {}
