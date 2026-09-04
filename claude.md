# Complaudi (India Compliance Toolkit) - Project Documentation & AI Guidelines

This file serves as a reference for AI coding assistants (like Claude/Cursor) to understand the project architecture, tech stack, and development conventions.

## 1. Project Overview
Complaudi is a Node.js-based API and React dashboard that automates Indian statutory obligations for various entities (Pvt Ltd, LLP, OPC, etc.). It calculates compliance calendars, assigns tasks, collects evidence, and tracks compliance scores across MCA, GST, Income Tax, MSME, and Labour laws.

## 2. Tech Stack & Architecture
The project is organized into two main parts: an Express API backend and a Vite+React frontend SPA. Both are started together via `npm run dev`.

### Backend (Root)
- **Runtime:** Node.js (v20+)
- **Server:** Express with `pino-http` for logging.
- **Database & ORM:** PostgreSQL (via Supabase), accessed via **Prisma** (`@prisma/client`), with `DATABASE_URL` (pooler, port 6543) for runtime and `DIRECT_URL` (port 5432) for migrations.
- **Storage:** Supabase Storage (service-role key) for evidence files, with local-disk fallback.
- **Validation:** Zod.
- **Auth:** Custom JWT-based authentication (access/refresh token pairs stored securely). Note: the app runs its own JWT auth, NOT Supabase Auth.
- **Other:** `node-cron` for scheduling, `nodemailer` for emails, `pdf-lib`/`pdfjs-dist` for evidence inspection.

### Frontend (`/web`)
- **Framework:** React 18 with TypeScript.
- **Build Tool:** Vite 8 (dev server on **port 5173**, `strictPort: true` + `host: true`).
- **Routing:** React Router v7.
- **Styling:** Vanilla CSS (`styles.css`), focusing on native custom properties (CSS variables). *Do not use Tailwind CSS.*
- **State/Data Fetching:** Custom hooks inside `src/api` for API requests.
- **Dev proxy:** `vite.config.ts` proxies `/api` to `http://localhost:4000` to keep a single origin.

## 3. Directory Structure

### Backend (`/src`)
- `engine/`: The core business logic. **Pure and unit-testable.** Never import Prisma or Express here.
  - `types.ts`, `conditions.ts`, `schedule.ts`, `evaluator.ts`, `generator.ts`, `score.ts`, `gate.ts`, `cli.ts`, `index.ts`.
  - `catalog/`: The 53 declarative rules organized by authority (`mca.ts`, `gst.ts`, `incomeTax.ts`, `msme.ts`, `labour.ts`).
- `modules/`: API route handlers and controllers.
  - Features: `auth`, `companies`, `compliance`, `tasks`, `documents`, `notifications`, `dashboard`, `audit`, `copilot`, `lookup`, `internal`.
- `lib/`: Utilities for dates (Indian FY), identifiers (GSTIN/PAN/CIN validation), storage, mailer, jwt, prisma, errors, pagination, access control, boolish, async, company document import, file inspection, MCA master data.
- `middleware/`: Express middlewares for auth, validation, and error handling.
- `jobs/`: Scheduled background jobs (e.g., nightly sweeps) — `daily.ts`, `runner.ts`, `scheduler.ts`.
- `config/`: `env.ts` — environment variable validation (Zod), process refuses to start on invalid values.

### Frontend (`/web/src`)
- `api/`: API client utilities and typing (`client.ts`, `types.ts`, `useResource.ts`).
- `auth/`: AuthContext and CompanyContext providers.
- `components/`: UI primitives, layout, drawer components, etc.
- `pages/`: Page-level components corresponding to routes (Dashboard, Calendar, Tasks, Companies, Rules, Documents, Team, Copilot, Login, Register, etc.).

## 4. Core Concepts & Development Rules

### The Compliance Engine
- Rules are declarative. Each rule defines `applicableWhen` conditions using named predicates (e.g., `hasGstRegistration()`) so that reasons are auditable and easily traced.
- **Never mix database logic with the engine.** The engine relies on projected objects (`ComplianceContext`), not direct DB reads.
- **Scheduling** uses the Indian Financial Year (April 1 to March 31).

### The Completion Gate (`PATCH /compliance/items/:id/status`)
Obligations cannot be marked complete blindly. The gateway ensures:
1. The associated task is assigned and marked `DONE`.
2. The checklist is fully complete.
3. Appropriate evidence (files) is uploaded (based on `REQUIRED`, `ATTEST`, or `NONE` levels).
4. Signatories are provided if the rule dictates it.

### Database Operations (Prisma & Supabase)
- **DATABASE_URL**: Must use the pooled connection (port `6543`) with `?pgbouncer=true` for normal application queries.
- **DIRECT_URL**: Must use the direct connection/session pooler (port `5432`) specifically for Prisma migrations (`npx prisma migrate dev`).
- **Active Supabase project ref:** `ciulqktarpydorkkfmqh` (region `ap-south-1`).
- Always use `npm run prisma:migrate` for schema changes.
- `.env` is gitignored (holds the Supabase service_role key and JWT signing secrets); `.env.example` is the committed template.

### Storage
- Both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set to use Supabase Storage; if either is missing it falls back to local disk (`./storage`) with a boot warning.
- Bucket: `compliance-evidence` (private, 25 MB limit). Create with `npm run supabase:bootstrap`.
- The service_role key bypasses RLS and must never reach the browser bundle.

### Authentication & Access Control
- Access control is strictly **company-scoped**. Users have roles (`SUPER_ADMIN`, `ADMIN`, `CA`, `COMPANY_OWNER`, `VIEWER`) *per company*.
- The `SUPER_ADMIN` role applies to the whole organization.
- Do not trust JWT claims for authorization limits; roles must be fetched from the DB per request to ensure real-time revocation.

### AI Copilot
The AI copilot relies on `retrieveRules()` to perform text search over the rule catalog and formulates answers deterministically based on whether a rule applies to the active company context.

## 5. Scripts Reference
- `npm run dev`: Starts both backend (port 4000) and frontend (port 5173) with a startup banner showing both URLs. Uses `concurrently` for `dev:api` + `dev:web`.
- `npm run dev:api`: Runs the API with `tsx watch src/index.ts`.
- `npm run dev:web`: Runs the Vite frontend dev server.
- `npm run build` / `npm start`: Compile and run the API in production.
- `npm run prisma:migrate`: Apply database schema changes.
- `npm run prisma:deploy`: Apply migrations in production.
- `npm test`: Run backend unit tests using Vitest (crucial for engine validations).
- `npm run seed`: Seed demo organizations and companies.
- `npm run supabase:bootstrap`: Create the Supabase storage bucket.
- `npm run migrate:prod` / `migrate:prod:check`: Production migration helpers.

## 6. Environment Variables (`.env`)
Key variables (see `.env.example` for full annotated list):
- `NODE_ENV`, `PORT` (default 4000), `LOG_LEVEL`, `APP_BASE_URL`, `CORS_ORIGINS`.
- `DATABASE_URL`, `DIRECT_URL` (Supabase pooler/direct connection strings).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `LOCAL_STORAGE_DIR`.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (+ TTLs), `BCRYPT_ROUNDS`.
- `SMTP_*`, `MAIL_FROM` (SMTP unset → console mailer in dev).
- `SERVE_WEB`, `WEB_DIST_DIR`, `ENABLE_CRON`, `REMINDER_CRON`, `TIMEZONE`, `REMINDER_OFFSET_DAYS`.

## 7. AI Instructions
When modifying this codebase:
- Respect the separation of concerns: keep the `engine` pure.
- When creating UI components in React, use Vanilla CSS matching the design tokens in `web/src/styles.css`.
- Ensure robust identifier validations (GSTIN/CIN checks) when modifying onboarding forms.
- For backend logic, maintain the idempotency of the sync and scheduled sweep operations.
- Never commit secrets: `.env` must stay gitignored; use `.env.example` for templated values.
- After editing, run `npm run typecheck` and relevant tests (`npm test`) to verify.
