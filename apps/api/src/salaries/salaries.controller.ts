import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { adjustSchema, idSchema, monthQuerySchema, salaryPaymentSchema, setSalarySchema, voidSchema } from './salaries.dto.js';
import { SalariesService } from './salaries.service.js';

// Only the clinic owner sees or changes salaries.
@Roles('OWNER')
@Controller()
export class SalariesController {
  constructor(private readonly salaries: SalariesService) {}

  @Get('salaries')
  month(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    return this.salaries.month(user, parseBody(monthQuerySchema, q).month);
  }

  @Patch('salaries/staff/:userId')
  setSalary(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Body() body: unknown) {
    return this.salaries.setSalary(user, parseBody(idSchema, userId), parseBody(setSalarySchema, body).monthlySalary);
  }

  @Patch('salaries/:id')
  adjust(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.salaries.adjust(user, parseBody(idSchema, id), parseBody(adjustSchema, body));
  }

  @Post('salaries/:id/payments')
  addPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.salaries.addPayment(user, parseBody(idSchema, id), parseBody(salaryPaymentSchema, body));
  }

  @Post('salary-payments/:id/void')
  @HttpCode(200)
  voidPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.salaries.voidPayment(user, parseBody(idSchema, id), parseBody(voidSchema, body).reason);
  }
}
