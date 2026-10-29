# AGENTS.md (apps/api)

Follow the root AGENTS.md. API specifics:
- NestJS 12, ESM: relative imports must end with `.js`.
- The Prisma client is generated into src/generated/prisma and is not committed. After schema changes run `pnpm --filter api exec prisma generate --no-hints`. Always pass --no-hints, otherwise Prisma installs AI skill folders into the repo.
- All database access goes through PrismaService (src/database).
- Observability service integration is not enabled. Do not add it unless the owner asks.
- Clinic data (patients, appointments, payments, ...) is read and written ONLY through `TenantPrismaService.db` (src/tenant). It adds the clinic filter automatically. Never pass `clinicId` yourself and never use `$queryRaw` on clinic tables.
- The raw `PrismaService` is only for login/tokens (src/auth) and the platform panel.
- When creating rows, use scalar ids (`patientId: ...`), not relation `connect`. Before linking to another record by id, load it through `tenant.db` first so a foreign clinic's id is rejected.
- Adding a model with a `clinicId` column requires adding it to TENANT_MODELS in src/tenant/tenant-scope.ts (a test fails if you forget).
