import { Body, Controller, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { updateClinicSchema } from './clinic.dto.js';
import { ClinicService } from './clinic.service.js';

// The owner edits their own clinic's identity. The clinic comes from the logged-in user, never from the request.
@Roles('OWNER')
@Controller('clinic')
export class ClinicController {
  constructor(private readonly clinics: ClinicService) {}

  @Patch('settings')
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.clinics.update(user.clinicId!, user.id, parseBody(updateClinicSchema, body), 'CLINIC_SETTINGS_UPDATED');
  }
}
