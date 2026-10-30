import type { Role } from '../generated/prisma/client.js';
import type { SubscriptionWarning } from './clinic-access.js';

// What we put inside the access token. clinicId comes from here and nowhere else.
export interface AccessTokenPayload {
  sub: string;
  role: Role;
  clinicId: string | null;
  // true while the user must change the temporary password
  mcp: boolean;
}

// What guards attach to request.user after loading the user from the DB.
export interface AuthUser {
  id: string;
  role: Role;
  clinicId: string | null;
  fullName: string;
  canManagePayments: boolean;
  mustChangePassword: boolean;
  // Only filled for the clinic OWNER, while the subscription is in its grace days.
  subscriptionWarning: SubscriptionWarning | null;
}
