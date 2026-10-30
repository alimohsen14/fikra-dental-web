// Decides whether a clinic's users may use the system right now.
// Nothing here is stored: the state is calculated from the clinic status and the subscription
// end date every time, so it can never get out of date.

export const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionWarning {
  endsAt: string; // when the subscription ended
  graceDaysLeft: number; // days left before logins are blocked
}

export type ClinicAccess =
  | { allowed: true; warning: SubscriptionWarning | null }
  | { allowed: false; reason: 'CLINIC_SUSPENDED' | 'SUBSCRIPTION_EXPIRED' };

export interface ClinicAccessInput {
  status: 'ACTIVE' | 'SUSPENDED';
  subscriptionEndsAt: Date | null; // null = no end date set
}

/** Pass null for users without a clinic (PLATFORM_ADMIN): always allowed. */
export function checkClinicAccess(clinic: ClinicAccessInput | null, now = new Date()): ClinicAccess {
  if (!clinic) return { allowed: true, warning: null };
  if (clinic.status === 'SUSPENDED') return { allowed: false, reason: 'CLINIC_SUSPENDED' };

  const ends = clinic.subscriptionEndsAt;
  if (!ends || now <= ends) return { allowed: true, warning: null };

  const lockAt = new Date(ends.getTime() + GRACE_DAYS * DAY_MS);
  if (now > lockAt) return { allowed: false, reason: 'SUBSCRIPTION_EXPIRED' };

  return {
    allowed: true,
    warning: {
      endsAt: ends.toISOString(),
      graceDaysLeft: Math.ceil((lockAt.getTime() - now.getTime()) / DAY_MS),
    },
  };
}

export const ACCESS_DENIED_MESSAGES = {
  CLINIC_SUSPENDED: 'العيادة موقوفة، تواصل مع الدعم',
  SUBSCRIPTION_EXPIRED: 'انتهى اشتراك العيادة، تواصل مع الدعم لتجديده',
} as const;
