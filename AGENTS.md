# Fikra Dental Web - Agent Instructions

Multi-tenant web system for dental clinics. Many clinics share one platform; each clinic sees only its own data. Arabic (RTL) UI by default. Full product spec: docs/ (read it before building any feature). If this file and the spec disagree, ask the owner.

## Stack
- Monorepo (pnpm workspaces): apps/api, apps/web, packages/shared (shared types and constants, e.g. roles, appointment statuses).
- API: NestJS 12 (ESM) + TypeScript, tests with Vitest, lint with Oxlint.
- DB: PostgreSQL 16 via Docker Compose (`docker compose up -d`, port 5432). ORM: Prisma (added in phase 1; check current Prisma docs for ESM setup before configuring).
- Web: React + Vite + TypeScript, Oxlint. Tailwind and routing are added later.
- Files (X-rays, phase 8): S3-compatible private object storage. Production: DigitalOcean Spaces.
- WhatsApp: WhatsApp Cloud API (Meta), one number per clinic. Fixed templates only. NO AI chatbot.

## Commands
- `pnpm install` (from repo root)
- `pnpm --filter api start:dev` / `pnpm --filter web dev`
- Check apps/*/package.json for test, lint and build scripts.

## Non-negotiable rules
1. Tenant isolation: every tenant table has `clinicId`. `clinicId` comes from the authenticated token, never from request input. Apply it centrally (Prisma extension or guard), not by hand per query. Add PostgreSQL Row Level Security as a second layer. Every feature needs a test proving clinic A cannot read or write clinic B's data.
2. Roles: PLATFORM_ADMIN, OWNER, DOCTOR, SECRETARY, plus a separate "can manage payments" permission. PLATFORM_ADMIN never sees patient data. Check permissions on the server, never only in the UI. Patient records are shared by the whole clinic: owner, doctors and secretaries all see all patients of their clinic (name and phone are required, because WhatsApp depends on them). Secretaries see patients and appointments but no money.
3. Money: integers in the smallest currency unit (or Decimal). Never float. Default currency ILS, set per clinic. Balances and debts are computed from payments, never stored.
4. Payments are never deleted. A wrong payment is voided with a written reason (owner only) and stays visible. A payment cannot exceed the remaining balance. Log financial edits in an audit log.
5. Never hard-delete patients, doctors or staff that have appointments, treatments or payments. Archive them.
6. Time: store UTC, display Asia/Hebron. Reminders depend on exact times.
7. Phones: normalize to international format. Default +970, also support +972. Duplicate numbers warn but do not block (families share phones). National ID is optional; if present it is unique per clinic.
8. Secrets: never commit .env or real keys. Only .env.example with dummy values. WhatsApp tokens are stored encrypted on the server and never reach the frontend.

## Domain rules
- Appointment statuses: pending, confirmed, completed, cancelled. Every new appointment starts pending. NEVER auto-cancel or auto-delete an appointment. "Overdue" (unconfirmed and in the past) is a derived flag, not a status.
- Prevent double booking per doctor at the database level.
- Messages: if the appointment is more than 48h away, send a booking message now and a confirm message (yes/no buttons) 24h before. If 48h or less, send only the confirm message immediately. Log every message. Ignore a late "yes" for a cancelled appointment. Reschedule recomputes pending messages.
- Treatment = one treatment type + one or more teeth + notes + ONE total cost + ONE session count. No per-tooth price. Several types in one visit = several treatments.
- A treatment closes only when it is fully paid AND all its sessions are completed.
- Self-booking via WhatsApp (phase 9): personal one-time link tied to the sender's number; new-patient data lives in a temporary booking request and becomes a patient only when the appointment is confirmed.

## Working agreement
- Work phase by phase (see spec). Finish and verify one phase before the next. Keep commits small and meaningful.
- Explain what you are building and where each file goes. The owner is learning the codebase and must be able to follow it.
- Do not invent features or change decisions. If something is unclear or marked pending in the spec, ask.
- Say why before adding a dependency. Do not add services or tools not in the stack above.
- Do not touch secrets, production settings or deployment unless asked.
