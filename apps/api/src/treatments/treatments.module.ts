import { Module } from '@nestjs/common';
import { TreatmentTypesService } from './treatment-types.service.js';
import { TreatmentsController } from './treatments.controller.js';
import { TreatmentsService } from './treatments.service.js';

@Module({ controllers: [TreatmentsController], providers: [TreatmentsService, TreatmentTypesService] })
export class TreatmentsModule {}
