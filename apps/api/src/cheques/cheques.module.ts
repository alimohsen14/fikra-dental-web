import { Module } from '@nestjs/common';
import { ChequesController } from './cheques.controller.js';
import { ChequesService } from './cheques.service.js';
import { ChequeStorage } from './cheques.storage.js';

@Module({ controllers: [ChequesController], providers: [ChequesService, ChequeStorage] })
export class ChequesModule {}
