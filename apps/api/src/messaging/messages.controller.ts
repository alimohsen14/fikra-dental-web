import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { getConfirmWindowHours } from '../config/env.js';
import { MessagesService } from './messages.service.js';

const idSchema = z.uuid();
const replySchema = z.object({ answer: z.enum(['YES', 'NO']) }).strict();

@Roles('OWNER', 'DOCTOR', 'SECRETARY')
@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  /** The screens use this to show the test-mode buttons and the window. */
  @Get('whatsapp/status')
  status() {
    return { provider: this.messages.provider.name, testMode: this.messages.provider.name === 'dummy', windowHours: getConfirmWindowHours() };
  }

  @Post('appointments/:id/message/send-now')
  @HttpCode(200)
  sendNow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.sendNow(user, parseBody(idSchema, id));
  }

  @Post('appointments/:id/message/reply')
  @HttpCode(200)
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.messages.testReply(user, parseBody(idSchema, id), parseBody(replySchema, body).answer);
  }
}
