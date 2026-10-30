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
- Two database roles: the owner role (DATABASE_URL) is for login, tokens and the platform panel; `fikra_app` (TENANT_DATABASE_URL) is used only by TenantPrismaService and is restricted by PostgreSQL Row Level Security. After creating the role run once: `ALTER ROLE fikra_app PASSWORD '...'`. Never commit that password.
- Every new table with a `clinicId` column needs, in its migration: ENABLE ROW LEVEL SECURITY, a `tenant_isolation` policy, and explicit GRANTs to fikra_app (no DELETE on payments, patients, doctors, users). A test in test/rls.e2e-spec.ts fails if one is missing.
