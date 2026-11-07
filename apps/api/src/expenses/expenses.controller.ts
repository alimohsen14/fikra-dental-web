import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import {
  createCategorySchema,
  createExpenseSchema,
  createSupplierSchema,
  expensePaymentSchema,
  idSchema,
  listExpensesQuerySchema,
  monthsQuerySchema,
  summaryQuerySchema,
  updateCategorySchema,
  updateExpenseSchema,
  updateSupplierSchema,
  voidSchema,
} from './expenses.dto.js';
import { ExpensesService } from './expenses.service.js';

// Only the clinic owner sees or changes anything about expenses.
@Roles('OWNER')
@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  // ---- categories
  @Get('expense-categories')
  categories() {
    return this.expenses.categories();
  }

  @Post('expense-categories')
  createCategory(@Body() body: unknown) {
    return this.expenses.createCategory(parseBody(createCategorySchema, body).name);
  }

  @Post('expense-categories/defaults')
  @HttpCode(200)
  defaults(@CurrentUser() user: AuthUser) {
    return this.expenses.addDefaultCategories(user.clinicId!);
  }

  @Patch('expense-categories/:id')
  updateCategory(@Param('id') id: string, @Body() body: unknown) {
    return this.expenses.updateCategory(parseBody(idSchema, id), parseBody(updateCategorySchema, body));
  }

  // ---- suppliers
  @Get('suppliers')
  suppliers() {
    return this.expenses.suppliers();
  }

  @Post('suppliers')
  createSupplier(@Body() body: unknown) {
    return this.expenses.createSupplier(parseBody(createSupplierSchema, body));
  }

  @Patch('suppliers/:id')
  updateSupplier(@Param('id') id: string, @Body() body: unknown) {
    return this.expenses.updateSupplier(parseBody(idSchema, id), parseBody(updateSupplierSchema, body));
  }

  // ---- bills
  @Get('expenses')
  list(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    return this.expenses.list(user, parseBody(listExpensesQuerySchema, q));
  }

  @Get('expenses/summary')
  summary(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const query = parseBody(summaryQuerySchema, q);
    return this.expenses.summary(user, query.period, query.date);
  }

  @Get('expenses/months')
  months(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const query = parseBody(monthsQuerySchema, q);
    return this.expenses.months(user, query.year ? { year: query.year } : { count: query.count ?? 12 });
  }

  @Get('expenses/:id')
  get(@Param('id') id: string) {
    return this.expenses.get(parseBody(idSchema, id));
  }

  @Post('expenses')
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.expenses.create(user, parseBody(createExpenseSchema, body));
  }

  @Patch('expenses/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.expenses.update(user, parseBody(idSchema, id), parseBody(updateExpenseSchema, body));
  }

  @Post('expenses/:id/void')
  @HttpCode(200)
  void(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.expenses.void(user, parseBody(idSchema, id), parseBody(voidSchema, body).reason);
  }

  @Post('expenses/:id/payments')
  addPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.expenses.addPayment(user, parseBody(idSchema, id), parseBody(expensePaymentSchema, body));
  }

  @Post('expense-payments/:id/void')
  @HttpCode(200)
  voidPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.expenses.voidPayment(user, parseBody(idSchema, id), parseBody(voidSchema, body).reason);
  }
}
