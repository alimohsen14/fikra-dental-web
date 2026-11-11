import { Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { readBody } from '../clinic/logo.js';
import { idSchema } from '../treatments/treatments.dto.js';
import { XRAY_MAX_BYTES, XraysService } from './xrays.service.js';

const noteQuery = z.object({ note: z.string().trim().max(200).optional() }).strict();

@Controller()
export class XraysController {
  constructor(private readonly xrays: XraysService) {}

  // The image is the raw request body (like the clinic logo); the optional note travels in the address.
  @Roles('OWNER', 'DOCTOR')
  @Post('treatments/:id/xrays')
  async add(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() q: unknown, @Req() req: Request) {
    const treatmentId = parseBody(idSchema, id);
    const note = parseBody(noteQuery, q ?? {}).note || null;
    return this.xrays.add(user, treatmentId, await readBody(req, XRAY_MAX_BYTES, 'الصورة كبيرة، الحد الأقصى 10 ميجابايت'), note);
  }

  @Roles('OWNER', 'DOCTOR', 'SECRETARY')
  @Get('treatments/:id/xrays')
  ofTreatment(@Param('id') id: string) {
    return this.xrays.ofTreatment(parseBody(idSchema, id));
  }

  @Roles('OWNER', 'DOCTOR', 'SECRETARY')
  @Get('patients/:id/xrays')
  ofPatient(@Param('id') id: string) {
    return this.xrays.ofPatient(parseBody(idSchema, id));
  }

  // Patient data: needs a login of the same clinic, never cached by shared caches.
  @Roles('OWNER', 'DOCTOR', 'SECRETARY')
  @Get('xrays/:id/file')
  async file(@Param('id') id: string, @Res() res: Response) {
    const { path, mime } = await this.xrays.fileOf(parseBody(idSchema, id));
    res.set({ 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
    res.sendFile(path, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }

  @Roles('OWNER', 'DOCTOR')
  @Delete('xrays/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.xrays.remove(user, parseBody(idSchema, id));
  }
}
