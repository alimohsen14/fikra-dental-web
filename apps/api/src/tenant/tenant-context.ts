import { AsyncLocalStorage } from 'node:async_hooks';

// Holds "which clinic is this request for" for the whole life of one request,
// so any code (even deep inside a service) can read it without passing it around.
export interface TenantStore {
  clinicId: string | null; // null = not a clinic user (public route or PLATFORM_ADMIN)
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function getTenantClinicId(): string | null {
  return tenantStorage.getStore()?.clinicId ?? null;
}
