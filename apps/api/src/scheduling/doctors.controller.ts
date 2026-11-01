import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { DoctorsService } from './doctors.service.js';
import { idSchema, workingPeriodsSchema } from './scheduling.dto.js';

@Roles('OWNER', 'DOCTOR', 'SECRETARY')
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.doctors.list(user);
  }

  // Only the owner decides when each doctor works.
  @Roles('OWNER')
  @Put(':id/working-periods')
  setWorkingPeriods(@Param('id') id: string, @Body() body: unknown) {
    return this.doctors.setWorkingPeriods(parseBody(idSchema, id), parseBody(workingPeriodsSchema, body));
  }
}
