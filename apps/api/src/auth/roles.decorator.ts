import { SetMetadata } from '@nestjs/common';
import type { Role } from '../generated/prisma/client.js';

export const ROLES_KEY = 'roles';
export const ANY_ROLE_KEY = 'anyRole';
export const PAYMENTS_KEY = 'requiresPayments';

/** Only these roles may call the route. Example: @Roles('OWNER', 'DOCTOR') */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
/** Any logged-in user (e.g. change-password). Use rarely, on purpose. */
export const AnyRole = () => SetMetadata(ANY_ROLE_KEY, true);
/** Add on top of @Roles for money routes: needs OWNER or the canManagePayments permission. */
export const RequiresPayments = () => SetMetadata(PAYMENTS_KEY, true);
