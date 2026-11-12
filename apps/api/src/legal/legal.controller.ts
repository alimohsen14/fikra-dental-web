import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { TERMS } from './terms.js';

@Controller('legal')
export class LegalController {
  /** Public: shown on the acceptance screen, and linked from the login page. */
  @Public()
  @Get('terms')
  terms() {
    return TERMS;
  }
}
