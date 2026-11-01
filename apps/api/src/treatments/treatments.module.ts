import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { TreatmentTypesService } from './treatment-types.service.js';
import { TreatmentsController } from './treatments.controller.js';
import { TreatmentsService } from './treatments.service.js';

@Module({ imports: [SchedulingModule], controllers: [TreatmentsController], providers: [TreatmentsService, TreatmentTypesService] })
export class TreatmentsModule {}
