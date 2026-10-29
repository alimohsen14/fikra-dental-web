import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth.types.js';
import { tenantStorage } from './tenant-context.js';

/** Runs after the guards (so request.user exists) and keeps the clinic for the whole request. */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const store = { clinicId: req.user?.clinicId ?? null };
    // The handler runs when the observable is subscribed, so the subscribe call itself must be
    // inside run(); otherwise the clinic would be lost.
    return new Observable((subscriber) =>
      tenantStorage.run(store, () => next.handle().subscribe(subscriber)),
    );
  }
}
