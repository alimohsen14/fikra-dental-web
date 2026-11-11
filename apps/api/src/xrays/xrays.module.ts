import { Module } from '@nestjs/common';
import { XraysController } from './xrays.controller.js';
import { XraysService } from './xrays.service.js';
import { XrayStorage } from './xrays.storage.js';

@Module({ controllers: [XraysController], providers: [XraysService, XrayStorage] })
export class XraysModule {}
