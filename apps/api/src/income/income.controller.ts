import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { myIncomeMonthsQuerySchema, myIncomeQuerySchema } from './income.dto.js';
import { IncomeService } from './income.service.js';

// Doctors (and an owner who also treats patients) see their OWN income only. Never anyone else's.
@Roles('DOCTOR', 'OWNER')
@Controller('my-income')
export class IncomeController {
  constructor(private readonly income: IncomeService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const query = parseBody(myIncomeQuerySchema, q);
    return this.income.mine(user, query.period, query.date);
  }

  @Get('months')
  months(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    return this.income.months(user, parseBody(myIncomeMonthsQuerySchema, q).year);
  }
}
