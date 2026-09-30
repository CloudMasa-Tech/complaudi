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
  - `predicates.ts`: the closed vocabulary of conditions a regulatory overlay may name.
  - `overlay.ts`: pure, data-only amendments applied on top of the static catalog.
  - `catalog/`: The 53 declarative rules organized by authority (`mca.ts`, `gst.ts`, `incomeTax.ts`, `msme.ts`, `labour.ts`).
- `modules/`: API route handlers and controllers.
  - Features: `auth`, `companies`, `compliance`, `tasks`, `documents`, `notifications`, `dashboard`, `audit`, `copilot`, `lookup`, `internal`, `regulatory`.
- `lib/`: Utilities for dates (Indian FY), identifiers (GSTIN/PAN/CIN validation), storage, mailer, jwt, prisma, errors, pagination, access control, boolish, async, company document import, file inspection, MCA master data, Claude API access (`claude.ts`).
- `middleware/`: Express middlewares for auth, validation, and error handling.
- `jobs/`: Scheduled background jobs — `daily.ts`, `runner.ts`, `scheduler.ts`. Two jobs: `daily-compliance` and `regulatory-watch`.
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

### The Regulatory Watch (Claude-driven rule updates)
A scheduled job reads what MCA, CBIC, CBDT, EPFO, ESIC, the MSME ministry and DPIIT
have published and files what it finds into a review queue. The pipeline is
strictly one-directional and human-gated:

`RegulatoryUpdate` (what was published) → `RuleChangeProposal` (a drafted change,
PENDING) → an admin with `rules.amend` approves → `RuleOverlay` (ACTIVE) →
`refreshOverlays()` pushes it into the engine → `effectiveRules()` applies it.

Rules governing this layer:
- **Claude never writes executable code.** Rules in `catalog/` are TypeScript with
  closures; an overlay is *data only*. A change that cannot be expressed as data
  is stored as `CODE_CHANGE_REQUIRED` for an engineer, never approximated.
- **Applicability is a closed vocabulary.** `engine/predicates.ts` is the only
  set of conditions an overlay may name, validated on write and again on
  approval. Adding one means writing the condition in `conditions.ts`, testing
  it, then exposing it — never the reverse.
- **`allRules` is the static catalog; `effectiveRules()` is what companies owe.**
  Anything deciding a real obligation goes through the effective view
  (`getEffectiveRule`, `effectiveRules`, `evaluateAll`). Tests assert against the
  static catalog. Do not reintroduce `allRules` into a runtime path.
- **The engine still imports no Prisma.** `engine/overlay.ts` holds one mutable
  registry filled by `regulatory.service.ts`; the engine never reads the database.
- Two Claude passes, in `lib/claude.ts`: `research()` (web_search/web_fetch,
  restricted to statutory domains in `ALLOWED_DOMAINS`) and `extract()` (no
  tools, JSON-schema output, cached prefix). Model defaults to `claude-opus-5`.
- Gated on `ANTHROPIC_API_KEY` + `REGULATORY_WATCH_ENABLED`. Unset, the feature
  is inert and everything else is unaffected.
- Job: `regulatory-watch`, separate from `daily-compliance` so a failed or
  expensive sweep can never take the nightly compliance run down.
- API: `/api/v1/regulatory` — reading needs `rules.read`, deciding needs
  `rules.amend` (SUPER_ADMIN only).

### Database Operations (Prisma & Supabase)
- **DATABASE_URL**: Must use the pooled connection (port `6543`) with `?pgbouncer=true` for normal application queries.
- **DIRECT_URL**: Must use the direct connection/session pooler (port `5432`) specifically for Prisma migrations (`npx prisma migrate dev`).
- **Active Supabase project ref:** `ciulqktarpydorkkfmqh` (region `ap-south-1`).
- Always use `npm run prisma:migrate` for schema changes.
- **Every new table needs `ENABLE ROW LEVEL SECURITY` in its own migration.**
  Prisma creates tables with RLS off, and Supabase grants `anon` and
  `authenticated` full DML on everything in `public`, so RLS is the only thing
  between a new table and the internet — the anon key is published in the
  browser bundle by design. The convention here is RLS on with *no* policies:
  that denies every anon request, and the API reaches the data with the
  service-role key, which bypasses RLS. Check with:
  `SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;`
  — it must return no rows. The regulatory-watch tables shipped without it.
- `.env` is gitignored (holds the Supabase service_role key and JWT signing secrets); `.env.example` is the committed template.

### Billing (Razorpay)
- Two purchasable terms, defined in `src/modules/billing/plans.ts`: **1 year
  ₹1,999** and **3 years ₹4,999**, each **+ 18% GST added on top** (₹2,358.82
  and ₹5,898.82 charged). Prices live in code, not env, and the file is mirrored
  verbatim into `supabase/functions/_shared/plans.ts`; `tests/plans.test.ts`
  fails if the two drift.
- **A payment is credited only by the server's own evidence.** With credentials
  configured that means a valid HMAC over `order_id|payment_id` *and* Razorpay
  reporting the payment `captured` against that same order. Nothing in the
  request body may influence the decision — an earlier version treated the
  client-supplied string `rzp_mock_signature` as proof of a simulated payment
  and credited it, which handed out free subscriptions.
- Simulated billing (no credentials) is server-gated and default-deny:
  `!isProd && !razorpayEnabled` on Express, `ALLOW_SIMULATED_BILLING=true` on
  the edge functions. Never infer it from a request.
- The entitlement term is read from `Payment.periodDays`, recorded when the
  order was created — never from config, or a 3-year purchase credits 1 year.
- `Payment` stores the invoice split (`baseAmountPaise`, `taxPercent`,
  `taxAmountPaise`) as charged. Do not re-derive it from a rounded total.

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

### Mobile, PWA and the native shells
One codebase serves all three targets — there is no second frontend.

- **Responsive**: below 820px the sidebar is an off-canvas drawer (`.sidebar.is-open`
  + `.nav-scrim`), not a stacked block. Safe-area insets are honoured, which
  needs `viewport-fit=cover` on the viewport meta or `env(safe-area-inset-*)`
  resolves to 0. Inputs are 16px on mobile because anything smaller makes iOS
  Safari zoom the page on focus and never zoom back.
- **PWA**: `web/public/manifest.webmanifest` + `web/public/sw.js`, registered in
  `main.tsx` in production only. **The service worker never caches API
  responses** — a cache is per-origin, not per-user, so caching them would serve
  one user's compliance data to the next person signing in on a shared device.
  Only the shell is cached.
- **Native**: Capacitor. `npm run android` / `npm run ios` build and open the
  IDE; `npm run build:native` pins `VITE_API_MODE=SUPABASE` and syncs. That mode
  matters: inside the shell the webview origin has no server behind it, so a
  relative `/api/v1/...` resolves to nothing and only absolute URLs work.
- `appId` is `in.cloudmasa.complaudi` and is permanent once published.
- Building Android needs the Android SDK; iOS needs full Xcode.

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
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`, `REGULATORY_WATCH_ENABLED`, `REGULATORY_WATCH_CRON`, `REGULATORY_WATCH_LOOKBACK_DAYS`, `REGULATORY_WATCH_MAX_UPDATES`.
- `SERVE_WEB`, `WEB_DIST_DIR`, `ENABLE_CRON`, `REMINDER_CRON`, `TIMEZONE`, `REMINDER_OFFSET_DAYS`.

## 7. AI Instructions
When modifying this codebase:
- Respect the separation of concerns: keep the `engine` pure.
- When creating UI components in React, use Vanilla CSS matching the design tokens in `web/src/styles.css`.
- Ensure robust identifier validations (GSTIN/CIN checks) when modifying onboarding forms.
- For backend logic, maintain the idempotency of the sync and scheduled sweep operations.
- Never commit secrets: `.env` must stay gitignored; use `.env.example` for templated values.
- After editing, run `npm run typecheck` and relevant tests (`npm test`) to verify.
