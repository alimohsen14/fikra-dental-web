import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { parseBody } from '../auth/auth.dto.js';
import { Roles } from '../auth/roles.decorator.js';
import {
  createPatientSchema,
  idSchema,
  listPatientsSchema,
  updatePatientSchema,
} from './patients.dto.js';
import { PatientsService } from './patients.service.js';

// Patient records are shared by the whole clinic: owner, doctors and secretaries see all of them.
@Roles('OWNER', 'DOCTOR', 'SECRETARY')
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.patients.create(parseBody(createPatientSchema, body));
  }

  @Get()
  list(@Query() query: unknown) {
    return this.patients.list(parseBody(listPatientsSchema, query));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.patients.get(parseBody(idSchema, id));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.patients.update(parseBody(idSchema, id), parseBody(updatePatientSchema, body));
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string) {
    return this.patients.setArchived(parseBody(idSchema, id), true);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  unarchive(@Param('id') id: string) {
    return this.patients.setArchived(parseBody(idSchema, id), false);
  }
}
