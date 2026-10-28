# AGENTS.md (apps/api)

Follow the root AGENTS.md. API specifics:
- NestJS 12, ESM: relative imports must end with `.js`.
- The Prisma client is generated into src/generated/prisma and is not committed. After schema changes run `pnpm --filter api exec prisma generate --no-hints`. Always pass --no-hints, otherwise Prisma installs AI skill folders into the repo.
- All database access goes through PrismaService (src/database).
- Observability service integration is not enabled. Do not add it unless the owner asks.
