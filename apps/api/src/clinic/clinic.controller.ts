import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, Public } from '../auth/auth.decorators.js';
import { parseBody } from '../auth/auth.dto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Roles } from '../auth/roles.decorator.js';
import { updateClinicSchema } from './clinic.dto.js';
import { ClinicService } from './clinic.service.js';
import { LOGO_MAX_BYTES, MIME_BY_EXT, readBody } from './logo.js';
import { LogoStorage } from './logo.storage.js';

// The owner edits their own clinic's identity. The clinic comes from the logged-in user, never from the request.
@Roles('OWNER')
@Controller('clinic')
export class ClinicController {
  constructor(
    private readonly clinics: ClinicService,
    private readonly logos: LogoStorage,
  ) {}

  @Patch('settings')
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.clinics.update(user.clinicId!, user.id, parseBody(updateClinicSchema, body), 'CLINIC_SETTINGS_UPDATED');
  }

  // The body is the raw image (Content-Type: image/png | image/jpeg | image/webp), max 512 KB.
  @Put('logo')
  @HttpCode(200)
  async uploadLogo(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.clinics.setLogo(user.clinicId!, user.id, await readBody(req, LOGO_MAX_BYTES));
  }

  @Delete('logo')
  removeLogo(@CurrentUser() user: AuthUser) {
    return this.clinics.removeLogo(user.clinicId!, user.id);
  }

  // Logos are not secret (they show on the login-free pages), and the names are unguessable.
  @Public()
  @Get('logo/:file')
  serveLogo(@Param('file') file: string, @Res() res: Response) {
    const path = this.logos.pathOf(file);
    if (!path) throw new NotFoundException();
    const ext = file.slice(file.lastIndexOf('.') + 1) as keyof typeof MIME_BY_EXT;
    res.set({
      'Content-Type': MIME_BY_EXT[ext],
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin', // the web app is on another origin
      'Cache-Control': 'public, max-age=31536000, immutable', // a new upload gets a new name
    });
    res.sendFile(path, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
}
