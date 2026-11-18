import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { RequiresPayments, Roles } from '../auth/roles.decorator.js';
import { readBody } from '../clinic/logo.js';
import { idSchema } from '../treatments/treatments.dto.js';
import { cashChequeSchema, createChequeSchema, createOutgoingChequeSchema, endorseChequesSchema, listChequesSchema, returnChequeSchema, updateChequeSchema } from './cheques.dto.js';
import { CHEQUE_MAX_BYTES, ChequesService } from './cheques.service.js';

// A cheque is a kind of payment: the same people (owner, or the payments key; a doctor only on their own treatments).
@Roles('OWNER', 'DOCTOR', 'SECRETARY')
@RequiresPayments()
@Controller()
export class ChequesController {
  constructor(private readonly cheques: ChequesService) {}

  @Post('treatments/:id/cheques')
  create(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.cheques.createIncoming(user, parseBody(idSchema, id), parseBody(createChequeSchema, body));
  }

  // The owner's side: paying a bill with a cheque (a new one we write, or cheques patients gave us handed over).
  @Roles('OWNER')
  @Post('expenses/:id/cheques')
  issue(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.cheques.issueForExpense(user, parseBody(idSchema, id), parseBody(createOutgoingChequeSchema, body));
  }

  @Roles('OWNER')
  @Post('expenses/:id/hand-over-cheques')
  @HttpCode(200)
  handOver(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.cheques.handOverForExpense(user, parseBody(idSchema, id), parseBody(endorseChequesSchema, body));
  }

  @Get('cheques')
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.cheques.list(user, parseBody(listChequesSchema, query));
  }

  @Get('cheques/summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.cheques.summary(user);
  }

  @Get('cheques/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cheques.get(user, parseBody(idSchema, id));
  }

  @Patch('cheques/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.cheques.update(user, parseBody(idSchema, id), parseBody(updateChequeSchema, body));
  }

  @Post('cheques/:id/cash')
  @HttpCode(200)
  cash(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.cheques.cash(user, parseBody(idSchema, id), parseBody(cashChequeSchema, body ?? {}).cashedAt);
  }

  @Post('cheques/:id/return')
  @HttpCode(200)
  returnCheque(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.cheques.returnCheque(user, parseBody(idSchema, id), parseBody(returnChequeSchema, body ?? {}).reason);
  }

  @Post('cheques/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cheques.cancel(user, parseBody(idSchema, id));
  }

  // The photo is the raw request body (like x-rays and the clinic logo).
  @Post('cheques/:id/image')
  @HttpCode(200)
  async setImage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.cheques.setImage(user, parseBody(idSchema, id), await readBody(req, CHEQUE_MAX_BYTES, 'الصورة كبيرة، الحد الأقصى 10 ميجابايت'));
  }

  // Financial data: needs a login of the same clinic, never cached by shared caches.
  @Get('cheques/:id/image')
  async image(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { path, mime } = await this.cheques.imageOf(user, parseBody(idSchema, id));
    res.set({ 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
    res.sendFile(path, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
}
