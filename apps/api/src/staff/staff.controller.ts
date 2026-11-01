import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { createStaffSchema, idSchema, updateStaffSchema } from './staff.dto.js';
import { StaffService } from './staff.service.js';

// The owner manages their own clinic's team. The clinic always comes from the token.
@Roles('OWNER')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.staff.list(user.clinicId!);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.staff.create(user.clinicId!, user.id, parseBody(createStaffSchema, body));
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.staff.update(user.clinicId!, user.id, parseBody(idSchema, id), parseBody(updateStaffSchema, body));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.staff.setActive(user.clinicId!, user.id, parseBody(idSchema, id), false);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.staff.setActive(user.clinicId!, user.id, parseBody(idSchema, id), true);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.staff.resetPassword(user.clinicId!, user.id, parseBody(idSchema, id));
  }
}
