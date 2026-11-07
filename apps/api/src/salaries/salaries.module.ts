import { Module } from '@nestjs/common';
import { SalariesController } from './salaries.controller.js';
import { SalariesService } from './salaries.service.js';

@Module({ controllers: [SalariesController], providers: [SalariesService] })
export class SalariesModule {}
