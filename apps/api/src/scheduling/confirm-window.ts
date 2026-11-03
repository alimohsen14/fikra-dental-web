import { getConfirmWindowHours } from '../config/env.js';

const HOUR = 3_600_000;

/** True when the visit is close enough that no confirmation message is worth sending: it is confirmed straight away. */
export function bookedInsideWindow(startsAt: Date, now: Date = new Date()): boolean {
  const hours = getConfirmWindowHours();
  return hours > 0 && startsAt.getTime() - now.getTime() < hours * HOUR;
}

/** When the confirmation message goes out for a waiting appointment. */
export function messageDueAt(startsAt: Date): Date | null {
  const hours = getConfirmWindowHours();
  return hours > 0 ? new Date(startsAt.getTime() - hours * HOUR) : null;
}
