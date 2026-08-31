# India Compliance Toolkit

A Node.js API that works out which Indian statutory obligations apply to a company, turns them into a dated calendar, assigns them as tasks, collects the evidence, chases the deadlines by email, and scores how well the company is keeping up.

Built for **Pvt Ltd, LLP, OPC, Public Ltd, Section 8, Partnership and Proprietorship** entities across **MCA/RoC, GST, Income Tax, MSME and Labour**.

```
                        Web / Mobile
                             │
                       API Gateway  (Express, JWT)
                             │
              ┌──────────────┴──────────────┐
              │                             │
       Compliance API                  AI Copilot
              │                             │
              ▼                             ▼
      Compliance Engine            Retrieval over rule catalog
              │                             │
        Rules Engine  ◄────────── 53 rules, each with its statute
              │
     ┌────────┼────────┬─────────┬─────────┐
     ▼        ▼        ▼         ▼         ▼
    MCA      GST     MSME    Income Tax  Labour
     └────────┴────────┴─────────┴─────────┘
                       ▼
              Compliance DB (Supabase Postgres / Prisma)
                       │
        ┌──────────────┼──────────────┬──────────────┐
        ▼              ▼              ▼              ▼
      Tasks        Documents        Audit         Score
        │              │
        ▼              ▼
  Notifications   Supabase Storage
```

---

## Quick start

```bash
cp .env.example .env          # fill in the Supabase connection strings
npm install                   # API
npm run web:install           # web dashboard
npm run prisma:migrate        # creates the schema
npm run seed                  # demo org, two companies, a year of history

npm run dev:all               # API on :4000, dashboard on :5173
```

Open **http://localhost:5173** and sign in with `owner@demo.test` / `DemoPassword1`.

Run them separately with `npm run dev` (API) and `npm run dev:web` (dashboard).
The API on its own is a JSON service — `http://localhost:4000/` serves a route index, and
everything under `/api/v1` needs a bearer token.

```bash
npm test              # 60 unit tests over the engine
npm run typecheck
npm run rules:list    # print the whole rule catalog with its statutory references
npm run rules:list GST
```

### Database

Point `DATABASE_URL` at the Supabase **pooled** connection (port 6543, `?pgbouncer=true&connection_limit=1`) and `DIRECT_URL` at the **direct** one (port 5432). Prisma runs migrations over the direct connection and everything else over the pooler.

No Supabase project yet? `docker compose up -d` starts Postgres 17 on port 5433, and `.env.example` already carries a matching URL you can uncomment.

### Storage and email

Both degrade gracefully so nothing blocks a first run:

| | configured | not configured |
|---|---|---|
| **Evidence files** | Supabase Storage, 5-minute signed URLs | local disk under `./storage`, streamed through the API |
| **Reminders** | SMTP | logged to the console with the full digest body |

Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, and `SMTP_HOST`, to switch each one on. `GET /ready` reports which driver is live.

---

## Web dashboard

`web/` is a Vite + React + TypeScript SPA. In development Vite proxies `/api` to
port 4000, so the browser stays on one origin and there is no CORS preflight.

| Page | What it does |
|---|---|
| **Dashboard** | Score with band, overdue / due-soon / evidence tiles, calendar breakdown by status and severity, per-authority table, overdue and next-30-days lists |
| **Calendar** | Every obligation grouped by month. Filters for authority, status, severity, date range and free text, all held in the URL so a filtered view can be shared |
| **Tasks** | Open work per owner, inline assignee and status changes, overdue-only filter |
| **Documents** | Evidence repository with coverage meter, upload, download and delete |
| **Companies** | Entity profiles, identifiers and flags, "which rules apply?" drawer, re-run engine, plus the onboarding form |
| **Copilot** | Ask a question, get an answer with cited rules tagged *Applies to you* or *Not applicable* |
| **Rule catalog** | All 53 rules, expandable to show conditions, exemptions, evidence and penalty |

The **item drawer** is where the work happens — open any calendar row for the
statute, a **Why this applies** trace with a tick or cross against each
condition, the penalty for missing it, the linked task with assignee and
checklist, evidence upload, and buttons to complete or waive the period.

The pre-onboarding rule is surfaced rather than hidden: the overdue tile reads
*"129 predate onboarding — unscored, need review"* and a banner links straight to
the filtered list.

Auth is a JWT pair in `localStorage`. Access tokens live 15 minutes, so the API
client refreshes once on a 401 and replays the request; concurrent 401s share a
single refresh promise, so a page with six panels cannot fire six rotations and
invalidate its own token.

```bash
npm --prefix web run build       # tsc -b && vite build
npm --prefix web run typecheck
```

---

## The compliance engine

Everything else in the system is plumbing around this.

### A rule

Each obligation is a declarative object carrying its own applicability logic, schedule and statutory citation:

```ts
{
  code: 'GST_GSTR9C',
  title: 'File GST reconciliation statement (GSTR-9C)',
  authority: 'GST',
  form: 'GSTR-9C',
  legalReference: 'Section 44 proviso, CGST Act 2017 read with Rule 80(3)',
  severity: 'HIGH',
  penalty: 'General penalty of up to ₹25,000 under s.125 of the CGST Act.',
  evidenceRequired: ['GSTR-9C acknowledgement (ARN)', 'Audited financial statements', …],
  applicableWhen: [hasGstRegistration(), turnoverAtLeast(5 * CRORE)],
  occurrences: annual({ month: 12, day: 31 }),
}
```

`applicableWhen` and `excludeWhen` are arrays of **named** predicates, not anonymous booleans. That is the whole point: every decision produces a readable trace.

```
GET /api/v1/compliance/companies/:id/explain/MCA_MGT7

{
  "applicable": false,
  "reasons": [
    { "label": "Entity is a Private Limited Company or …", "passed": true,  "negated": false },
    { "label": "Is not a small company (files the full annual return, MGT-7)",
      "passed": false, "negated": false }
  ]
}
```

A compliance tool that says *"you must file GSTR-9C"* without saying *"because your turnover crossed ₹5 crore"* is not auditable, and the user cannot tell a real obligation from a bad assumption. Traces are also persisted to `compliance_applicabilities` on every sync.

### Scheduling

`occurrences(financialYear, context)` expands a rule into dated obligations. The awkward parts of Indian statutory timing are solved once, in `src/engine/schedule.ts`:

| builder | used for |
|---|---|
| `annual({ month, day, anchor })` | fixed dates, inside the FY (`within`) or after it closes (`after`) |
| `annualFromAgm({ offsetDays, fallback })` | AOC-4 (+30), MGT-7 (+60), ADT-1 (+15) — falls back to the statutory outer limit until an AGM date is recorded |
| `monthly({ day, lagMonths })` | GSTR-1, GSTR-3B, PF, ESI |
| `quarterly({ due })` | TDS returns, whose lags are *not* uniform (31 Jul / 31 Oct / 31 Jan / **31 May**) |
| `halfYearly({ due })` | MSME-1 (31 Oct and 30 Apr) |
| `fixedDatesInFy([…])` | advance-tax instalments |
| `oneTimeFromIncorporation({ withinDays })` | INC-20A |
| `perGstin(inner)` | fans returns across every active GSTIN |

Dates are UTC-midnight calendar dates, matching Postgres `date` columns, so the server's timezone never enters the arithmetic. The Indian financial year (1 April – 31 March) is modelled explicitly: an annual filing *for* FY2025-26 is due *in* October 2026, and the two are never conflated.

### Coverage — 53 rules

**MCA / RoC** — AOC-4, AOC-4 (OPC 180-day variant), MGT-7, MGT-7A, ADT-1, DIR-3 KYC, DPT-3, MSME-1, CSR-2, INC-20A, AGM, board meetings (quarterly, or half-yearly for small companies and OPCs), MBP-1/DIR-8. **LLP** — Form 11, Form 8, audit threshold.

**GST** — GSTR-1 (monthly and QRMP), IFF, GSTR-3B (monthly and QRMP), PMT-06, CMP-08, GSTR-4, GSTR-9, GSTR-9C, GSTR-7, GSTR-8, GSTR-2B reconciliation, e-invoicing readiness.

**Income Tax** — advance tax, TDS deposit, 24Q/26Q/27Q, Form 16, Form 16A, tax audit (3CA/3CB-3CD), Form 3CEB, ITR (audited / non-audited / transfer-pricing variants), Form 61A.

**MSME** — Udyam annual update, the 45-day payment rule under s.15 MSMED read with s.43B(h), vendor declarations, Udyam registration prompt.

**Labour** — EPF ECR, ESI, professional tax, POSH internal committee, POSH annual report, bonus Form D, Shops & Establishments renewal.

Thresholds and carve-outs the engine actually models:

- Small company (₹4 crore capital / ₹40 crore turnover) → **MGT-7A instead of MGT-7**, and half-yearly instead of quarterly board meetings
- s.44AB tax audit at ₹1 crore, relaxed to **₹10 crore** when cash receipts and payments are within 5%
- GSTR-9 above ₹2 crore, GSTR-9C above ₹5 crore, e-invoicing above ₹5 crore
- QRMP GSTR-3B on the **22nd for Group X states, 24th for Group Y** (Notification 29/2021)
- March TDS deposit relaxed from the 7th to **30 April**
- Transfer pricing moves the return from 31 October to **30 November**
- EPF from 20 employees; ESI from 10, **but 20 in Maharashtra and Chandigarh**
- Professional tax only in the states that levy it

### The completion gate

Nothing here reaches MCA, GSTN or the Income Tax Department — see
[Known limits](#notes-and-limitations). "Completed" is therefore a *claim*, and
the gate decides what has to be true before that claim is accepted.

**1. The work is owned, worked through, and finished.** A gated obligation
cannot be closed while its task is unassigned, while checklist items are
outstanding, or while the task itself is not yet `DONE`. The checklist is seeded
from the rule's own `evidenceRequired`, so it is the work, not decoration.

Crucially, **marking the task `DONE` does not file the obligation.** The task is
the *work*; the obligation is the *filing*. Conflating them let someone close a
statutory filing by flipping a dropdown on the task board. The enforced order is:

```
assign it → work the checklist → attach what it produced → mark the task Done
                                                                    ↓
                                              then, separately, Mark completed
```

Reopening the task reopens the obligation, so a filing can never read
`COMPLETED` while the work behind it has been pulled back open.

**2. Evidence, at a level each rule declares.**

| Level | To close it out | Rules |
|---|---|---|
| `REQUIRED` | A document must be attached. A declaration will **not** substitute — the filing produces an artefact and the artefact is the point. | 36 |
| `ATTEST` | A document, or a typed declaration stored against the user's name and written to the audit log. | 14 |
| `NONE` | Nothing to prove — an internal reminder. Ownership and checklist are not policed either. | 3 |

**3. A named signatory, where a human signs the document.** 15 rules — the AGM,
board minutes, AOC-4, MGT-7, audit reports, the POSH committee order — carry
`signatoryRequired`. Software cannot verify a scanned wet-ink signature, so the
control is an accountable person on the record instead. Where the PDF *does*
carry a digital signature it is detected, the signer read out of the PKCS#7
certificate, and both stored — but a DSC is never assumed, because most minutes
are signed on paper.

Every blocker is reported at once rather than one at a time:

```
PATCH /compliance/items/:id/status  {"status":"COMPLETED"}
→ 422  "4 things still stand in the way of closing this out."
       ✕ UNASSIGNED            Assign this to someone first — a filing nobody owns is a filing nobody makes.
       ✕ CHECKLIST_INCOMPLETE  3 of 3 checklist items still outstanding.
       ✕ EVIDENCE_REQUIRED     This filing produces a document — attach it before closing the obligation out.
       ✕ TASK_NOT_DONE         The task is still todo. Move it to Done once the work is finished.
```

They are listed in the order the work actually happens, so the list reads as a
sequence rather than a pile.

The gate is a pure function (`src/engine/gate.ts`) wrapped by one guard
(`assertCompletionAllowed`). There is now exactly **one** way to file an
obligation — `PATCH /compliance/items/:id/status` — and it always goes through
the gate.

Waiving is deliberately **not** gated: there you are asserting the obligation
does not apply this period, and the reason field already captures that.
Declarations and signatories are cleared when an item is reopened, so a stale
claim never outlives the completion it was made for.

### Upload inspection

An evidence gate is only as good as the evidence, so uploads are inspected
before anything is stored (`src/lib/fileInspection.ts`):

- **Magic bytes over declared type** — a PNG renamed `.pdf` is refused, whatever
  the client claims the MIME type is
- **Structural validity** — a PDF must parse and have at least one page; a
  corrupt or password-protected file is refused with the reason
- **A floor on size** to catch placeholders. Deliberately low (512 bytes): PDFs
  compress well and a genuine one-page acknowledgement can be under 2 KB, so for
  a PDF the real test is structural, not weight
- **Digital signature detection** — `/ByteRange` plus a `/SubFilter` naming the
  scheme, with the signer's common name read from the PKCS#7 blob where it
  parses. Page count, detected type, signature status and signer are stored on
  the document and shown in the UI

These catch the careless cases. They cannot establish that a document is
genuinely *this* company's AGM minutes — that is what the named signatory and,
ultimately, a human reviewer are for.

### Score### Score

```
score = 100 × (weighted obligations met on time) / (weighted obligations that fell due)
```

Severity weights CRITICAL 10, HIGH 6, MEDIUM 3, LOW 1. A late filing keeps half credit. Bands: A ≥ 90, B ≥ 75, C ≥ 60, else D.

Three categories are deliberately **excluded** rather than counted as failures:

- **Not yet due** — otherwise a company could raise its score by generating more future calendar entries.
- **Waived** — explicitly marked not applicable this period, with a reason.
- **Predating onboarding and never touched** — the calendar is back-filled ~13 months on onboarding, so a brand-new account inherits a year of already-overdue entries. The tool has no idea whether those were filed on paper long before signup, and scoring the account at zero for them would be wrong. They are surfaced separately as `preOnboarding`, still visible in the calendar, and score normally the moment someone marks them completed or waived. The reminder sweep skips them for the same reason.

---

## Sync and reconciliation

`POST /api/v1/compliance/companies/:id/sync` re-runs the engine and reconciles the stored calendar. It also runs automatically whenever the profile changes — adding a GSTIN, crossing a turnover threshold, recording an AGM date.

Reconciliation rules, in order of precedence:

1. Anything **completed or waived** is never touched.
2. Anything in the **past** is never deleted — it is the compliance history.
3. **Future** obligations that no longer apply are withdrawn, unless evidence is already attached.
4. Descriptive fields and due dates are refreshed in place, so entering an AGM date moves AOC-4 without losing the task, its assignee or its documents.

Idempotency comes from a unique `(companyId, ruleCode, periodKey)`, so syncing repeatedly is free.

Observed behaviour:

```
turnover ₹3.2 crore → ₹9 crore   +3 items  (GSTR-9C, e-invoicing readiness)
turnover ₹9 crore → ₹3.2 crore    3 future items withdrawn, past ones kept
AGM recorded 2026-08-20           AOC-4 2026-10-30 → 2026-09-19
                                  MGT-7A 2026-11-28 → 2026-10-19
                                  ADT-1  2026-10-14 → 2026-09-04
```

---

## API

All routes are under `/api/v1` and, except `/auth/register` and `/auth/login`, require `Authorization: Bearer <accessToken>`. **Every query is scoped by organization** — an id from another tenant returns 404, not 403, so ids cannot be probed.

### Auth
```
POST   /auth/register-trial        public self-service enrolment (14-day trial)
POST   /auth/register              create org + SUPER_ADMIN
POST   /auth/login
POST   /auth/refresh               rotates; the presented token is revoked
POST   /auth/logout | /logout-all
POST   /auth/change-password       your own, proving the current one
GET    /auth/me | /auth/users
POST   /auth/users                 ADMIN+
```
Access tokens live 15 minutes; refresh tokens are stored **hashed**, so a database leak cannot be replayed.

**Password resets end every session.** Refresh tokens are revoked and
`passwordChangedAt` makes access tokens minted beforehand invalid on their next
request — a reset that leaves the old session working is not a reset. The new
password is returned once, never stored in the clear, and never written to the
audit log; the log records that a reset happened and who did it, which is the
part that matters later.

**The role is read from the database on every request, not from the token.** A
role can change while a token is still valid, and trusting the claim cuts both
ways: someone promoted to super admin was locked out until their token expired,
because the promotion had cleared the per-company grants their stale claim still
depended on — and someone demoted kept their old powers for the rest of the
token's life. One indexed lookup per request buys neither being possible, and
deactivating an account now takes effect on the next request rather than in
fifteen minutes. Login is rate-limited to 20 attempts per 15 minutes and compares against a dummy hash for unknown emails so response timing does not leak whether an account exists.

### Self-service trial

`/register` is public. Someone enrols with their name, work email, mobile
number, a password and their company; the CIN is optional and, when given,
settles the entity type, state and listing status, so the form stops asking for
them.

Signing up creates the organisation, the person, their company **and runs the
engine**, so the first screen has their own obligations on it rather than an
empty state.

They are a `VIEWER` on their own company for 14 days: the trial is for seeing
what applies, not for running the filings. Attempting one is refused with
*"A viewer cannot work on filings here."*

`Organization.trialEndsAt` is null for a full account, so nothing that already
exists acquires an expiry. Once it passes, `requireAuth` refuses every request
with a `TRIAL_EXPIRED` code — except `/auth/me`, `/auth/logout` and
`/auth/change-password`, which stay open so the front end can render an
explanation rather than a wall of failures. **Signing in still works and nothing
is deleted**; the account simply cannot be opened until it is upgraded, at which
point the role widens and the calendar it already has is kept.

### Roles and access

Access is per *company*, not per organisation. A client's own login sees its
entity and nothing else; a practitioner sees the clients they have been given.

| Role | Sees | Can |
|---|---|---|
| `SUPER_ADMIN` | **every company** in the organisation | everything, including managing people, grants and the audit log |
| `ADMIN` | only granted companies | onboard, edit, archive, re-run the engine, work filings |
| `CA` | only granted companies | edit profiles, re-run the engine, work filings, upload evidence |
| `COMPANY_OWNER` | only granted companies | complete filings and upload evidence — not reshape the profile |
| `VIEWER` | only granted companies | read only |

**Only the super admin sees the whole organisation.** Admins are powerful but
still onboarded onto designated companies like everyone else. Two consequences
follow: the audit log is super-admin only, because it spans the organisation and
a scoped role reading it would see past its own grants; and a scoped user who
onboards a company is granted it automatically, or they would create something
they could not then open.

**The grant is authoritative.** A person's role on a company decides both what
they can see there *and* what they may do there. Their base role is only the
default applied to new grants — the same practitioner can be a CA on one client
and a viewer on the next:

```
base role VIEWER, granted Kaveri as CA and Sundar as VIEWER

Kaveri  move a task  -> 200      edit profile -> 200
Sundar  move a task  -> 403      edit profile -> 403
        "A viewer cannot work on filings here."
```

Two things are kept deliberately separate:

- **Scope** — which companies exist for you at all, enforced in the query via
  `companyScope(actor)` rather than by filtering results afterwards. A company
  you hold no grant for returns **404, not 403**, so an id cannot be probed to
  learn whether it exists.
- **Capability** — what you may do with one you can see. A capability list
  (`src/lib/access.ts`), not a role ranking: a ranking invites
  "greater than MEMBER" checks that silently widen a new role the moment it is
  inserted into the order.

Company-scoped routes carry **no capability guard at the route**. The base role
is not the authority once a grant exists, and the company is not known until the
service resolves it, so authorisation happens there via `assertCan(actor,
companyId, capability)`. Only the three actions with no company in hand —
onboarding, managing people, reading the audit log — are gated on the base role
at the route.

Each company in `GET /companies` carries `myRole` and `myCapabilities`, so the
front end gates buttons per company rather than per session.

**Tenant isolation is unchanged and never crossed.** A `SUPER_ADMIN` is the top
of *their* organisation, not of the installation.

```
GET  /auth/users                  people, roles and their grants
POST /auth/users                  create with a role and initial grants (SUPER_ADMIN)
PATCH /auth/users/:id             change role, deactivate  (SUPER_ADMIN)
PUT  /auth/users/:id/access       replace which companies they may see (SUPER_ADMIN)
POST /auth/users/:id/reset-password   set a new password, returned once (SUPER_ADMIN)
```

Promotion to an organisation-wide role clears the now-meaningless per-company
grants, and the last active super admin cannot be demoted or deactivated —
otherwise nobody could grant access again.

### Companies — onboarding
```
GET    /companies?search=&entityType=&includeInactive=
POST   /companies                  company + directors + GSTINs + Udyam, then builds the calendar
GET    /companies/:id
PATCH  /companies/:id              re-runs the engine
DELETE /companies/:id              archive — reversible (ADMIN+)
POST   /companies/:id/restore      un-archive (ADMIN+)
GET    /companies/:id/deletion-impact     what a permanent delete would destroy (OWNER)
POST   /companies/:id/permanent-delete    irreversible, echoes the legal name (OWNER)

POST|PATCH|DELETE  /companies/:id/directors[/:childId]
POST|PATCH|DELETE  /companies/:id/gst-registrations[/:childId]
PUT|DELETE         /companies/:id/msme-registration
```

Identifiers are validated properly, not just shape-checked. GSTIN goes through its **mod-36 check digit**, its state code must resolve, and the PAN embedded in characters 3–12 must match the company's own PAN:

```json
{ "error": { "code": "BAD_REQUEST", "details": [
  { "gstin": "33AAACB1234C1Z9",
    "problems": ["GSTIN check digit does not match — the number appears to be mistyped"] }]}}
```

The state code is derived from the GSTIN when you do not supply one. CIN, LLPIN, PAN, TAN, DIN and Udyam numbers are format-checked, and an LLP without an LLPIN or a Companies Act entity without a CIN is rejected.

### Identifier derivation

Typing a CIN fills in what the identifier itself encodes — no MCA service is
contacted, because there isn't one wired in:

```
U 72900 TN 2020 PTC 138472
│ │     │  │    │   └────── registration number
│ │     │  │    └────────── ownership class  → entity type
│ │     │  └─────────────── year             → incorporation year
│ │     └────────────────── state            → state, and with it the professional-tax and ESI thresholds
│ └──────────────────────── activity code    → broad industry
└────────────────────────── L listed / U unlisted → the isListed flag
```

`GET /api/v1/lookup/cin/:cin` returns the decode plus a `suggested` block the
form applies, and a `notAvailable` list naming what it *cannot* give you —
legal name, exact incorporation date, directors, paid-up capital — with the
reason for each. Fields the identifier actually settles are overwritten; the
industry is a broad division, so it only fills a blank.

It refuses to guess where the code is genuinely ambiguous: a government company
(`SGC`, `GOI`) may be private or public, so `entityType` comes back `null`
rather than wrong. CIN state codes that differ from the GST ones are translated
(`OR` → `OD`).

`/lookup/pan/:pan` reads the holder type from the PAN's fourth character
(`C` company, `F` firm or LLP, `P` individual…), and `/lookup/gstin/:gstin`
verifies the check digit and returns the state and embedded PAN.

The endpoint lives on the server rather than in the browser so that the day a
real source is wired in — a GSP for GSTIN, an MCA feed for CIN — the response
can be enriched without the front end changing shape.

**Removing a company has two levels.** *Archive* is the default: the company
drops out of every org-wide view — calendar, tasks, documents, dashboard and
score — but keeps its filing history and can be restored. *Permanent delete* is
OWNER-only, shows exactly what it will destroy (obligations, tasks, evidence
files, score history), and requires the legal name typed back. Stored files are
removed from the bucket first, so nothing is orphaned.

The audit log hangs off the organization rather than the company, so the record
of a deletion outlives the company. A rejected attempt is logged separately as
`company.permanent_delete_rejected` — somebody trying to destroy a compliance
history is worth seeing, and logging it as a deletion would make the trail claim
something that never happened.

Role gating: `MEMBER` can edit, `ADMIN` can archive and restore, only `OWNER`
can permanently delete.

### Compliance
```
GET   /compliance/calendar?companyId=&authority=&status=&severity=&from=&to=&search=
GET   /compliance/calendar/by-month?companyId=&from=&to=
GET   /compliance/items/:id
PATCH /compliance/items/:id/status         complete / waive with a reason
POST  /compliance/companies/:id/sync
GET   /compliance/companies/:id/applicability
GET   /compliance/companies/:id/explain/:ruleCode
```

### Tasks
```
GET   /tasks?companyId=&status=&assigneeId=&unassignedOnly=&overdueOnly=&from=&to=
GET   /tasks/mine
GET   /tasks/workload                      open work per assignee
GET   /tasks/:id
PATCH /tasks/:id                           status, assignee, notes, checklist
POST  /tasks/:id/checklist/:entryId
POST  /tasks/bulk-assign
```
Tasks are 1:1 with calendar items and their state is kept in step: marking a task `DONE` completes the obligation; reopening it puts the obligation back with a freshly derived `UPCOMING` / `DUE` / `OVERDUE`. The checklist is seeded from the rule's `evidenceRequired`.

### Documents
```
GET    /documents?companyId=&complianceItemId=&taskId=&search=
POST   /documents                          multipart: file + companyId [+ complianceItemId] [+ taskId] [+ label]
GET    /documents/:id/download             302 to a signed URL, or streamed
DELETE /documents/:id
GET    /documents/coverage/:companyId      which obligations still lack evidence
```
25 MB limit, allow-listed MIME types, SHA-256 content hashing that **deduplicates re-uploads of the same file against the same item**, tenant-namespaced storage keys, and orphan cleanup if the metadata write fails after the object lands.

### Notifications
```
GET  /notifications?unreadOnly=
POST /notifications/read | /read-all
POST /notifications/sweep                  ADMIN+; the nightly job calls the same code
```
The sweep reminds at 30 / 15 / 7 / 3 / 1 / 0 days before, then nudges at 1, 3, 7, 14 and 30 days overdue. Recipients are the task's assignee, or every OWNER and ADMIN when nobody has picked it up. A unique `(item, user, kind)` makes it **idempotent** — running it twice in a day sends nothing the second time — and each person receives **one digest**, not one email per obligation.

### Dashboard, audit, copilot
```
GET  /dashboard/overview?companyId=        score, status/severity counts, per-authority breakdown,
                                           overdue list, next 30 days, task counts, evidence coverage
GET  /dashboard/score?companyId=
GET  /dashboard/score/:id/history
POST /dashboard/score/:id/snapshot

GET  /audit?entityType=&entityId=&action=&actorId=&from=&to=      ADMIN+

POST /copilot/ask         { question, companyId? }
GET  /copilot/search?q=
GET  /rules?authority=    the whole catalog
GET  /rules/:code
```

---

## AI Copilot

The rule catalog **is** the knowledge base — every rule carries its statutory reference, penalty and evidence list, so any answer traces back to a section number. `retrieveRules()` scores the question against weighted fields (form name and title outrank body text) with synonym expansion for how people actually type: `roc`→`mca`, `pf`→`epf`/`ecr`, `itr`→`income tax return`.

The shipped `RuleGroundedCopilot` composes answers deterministically, with no API key and no hallucination surface. When the closest match to a question does *not* apply, that is the answer, and it leads:

```
Q: Do I need to deduct provident fund for my employees?

For Kaveri Foods Private Limited — private limited, turnover ₹3.20 crore,
14 employees, registered in KA, 1 GST registration(s), Udyam registered:

File the EPF electronic challan-cum-return and remit contributions (ECR)
does not apply to Kaveri Foods Private Limited.
  • Not met: Has 20 or more employees

Related obligations that do apply:

• Remit ESI contributions
  Regulation 31, Employees' State Insurance (General) Regulations 1950 — critical priority.
  Next due 2026-09-15 (currently upcoming).
  If missed: Interest at 12% per annum plus damages of 5% to 25% per annum, and possible
  prosecution under s.85.
```

To put an LLM behind it, implement one method and register it — the grounding object, and therefore the citations, stay exactly as they are:

```ts
setCopilotProvider({
  name: 'claude',
  async answer({ question, retrieved, company, citations }) { … },
});
```

---

## Layout

```
src/
  engine/                 no Prisma, no Express — pure and unit-testable
    types.ts              Rule, Condition, Occurrence, ComplianceContext
    conditions.ts         named predicates: entityIs, turnoverAtLeast, …
    schedule.ts           annual / monthly / quarterly / perGstin builders
    evaluator.ts          applicability + reason traces
    generator.ts          expands rules into dated obligations
    score.ts              weighted scoring
    catalog/              mca · gst · incomeTax · msme · labour
  modules/                auth · companies · compliance · tasks · documents
                          notifications · dashboard · audit · copilot
  lib/                    dates (Indian FY) · india (GSTIN/PAN/CIN) · storage
                          mailer · jwt · prisma · errors · logger
  middleware/             auth · validate · error
  jobs/scheduler.ts       nightly: refresh statuses → send reminders → snapshot scores
prisma/                   schema · migrations · seed
tests/                    60 tests

web/src/
  api/                    client (token refresh, uploads, downloads) · types · useResource
  auth/                   AuthContext (session restore) · CompanyContext (selected entity)
  components/             Layout · ItemDrawer · ui primitives and formatters
  pages/                  Dashboard · Calendar · Tasks · Documents · Companies
                          CompanyNew · Copilot · Rules · Login
  styles.css              design tokens, light and dark
```

The engine never imports Prisma or Express. `buildContext()` projects a persisted company onto a plain object, so rules are testable without a database and the storage layer can change without touching the catalog.

## Tests

```
tests/dates.test.ts                 financial years, quarters, month-end clamping
tests/india.test.ts                 GSTIN check digit, PAN extraction, CIN parsing
tests/engine.applicability.test.ts  entity types, thresholds, headcount, reason traces
tests/engine.duedates.test.ts       every due date above, asserted for FY2025-26
tests/score.test.ts                 weighting, late credit, waivers, pre-onboarding
```

The due-date suite is the one that matters. It pins each statutory date against a known financial year, so a refactor of the schedule builders cannot quietly move AOC-4 by a month:

```ts
expect(dueDates('MCA_AOC4')).toEqual(['2026-10-30']);
expect(dueDates('MCA_AOC4_OPC', opc)).toEqual(['2026-09-27']);   // 180 days from FY end
expect(dueDates('IT_TDS_RETURN')).toEqual(
  ['2025-07-31', '2025-10-31', '2026-01-31', '2026-05-31']);      // note the Q4 outlier
expect(dueDates('GST_GSTR3B_QRMP', tamilNadu)).toEqual([…'-07-22'…]);  // Group X
expect(dueDates('GST_GSTR3B_QRMP', delhi)).toEqual([…'-07-24'…]);      // Group Y
```

## What was verified

The engine is covered by 60 unit tests. The API and the dashboard were exercised
end to end against Postgres:

- Auth — refresh rotation, reuse of a rotated token rejected, cross-tenant reads 404
- Onboarding — 31 rules applicable / 22 not, 271 calendar items, state derived from the GSTIN
- GSTIN check digit rejected a mistyped number; an LLP without an LLPIN was rejected
- Task ↔ item state sync, including reopening reverting the obligation to overdue
- SHA-256 upload dedup; reminder sweep idempotent (6 created, 0 on the second run)
- Turnover ₹3.2 cr → ₹9 cr added GSTR-9C and e-invoicing; reverting withdrew the 3
  future items and kept the past ones
- Recording an AGM moved AOC-4, MGT-7A and ADT-1 by the right offsets
- Every dashboard page rendered in headless Chrome with **zero console errors**, and
  every endpoint the UI calls returns the shape its TypeScript types expect

## Operations

The daily job — refresh statuses → send reminders → snapshot scores, in that order
so reminders and scores both see an up-to-date view of what is overdue — runs
**outside** the application in production. `ENABLE_CRON` is off by default,
because every replica of an in-process cron would fire it and every recipient
would get duplicate emails.

Three ways to trigger it, all guarded by the same claim on `job_runs` so they
cannot double-run:

```bash
node dist/jobs/daily.js                    # scheduled container (recommended)
POST /internal/jobs/daily-compliance       # HTTP trigger, x-job-secret header
```

...or Supabase `pg_cron` + `pg_net` calling that endpoint. `GET /internal/jobs`
returns the run history and `staleHours` — alert on it, because a cron that
quietly stops firing is the failure nobody notices for a month.

**[DEPLOYMENT.md](DEPLOYMENT.md) is the full production runbook**: Supabase
connection strings (and why the pooled one needs `?pgbouncer=true`), storage
bucket setup, migration strategy, the Dockerfile, all three scheduler options
with working config, and a pre-launch checklist.

`GET /health` is liveness; `GET /ready` checks the database and reports the active storage and mail drivers. Logs are structured (pino) with `authorization`, `cookie`, `password` and `token` redacted. Every mutation writes an `AuditLog` row with actor, IP, user agent and before/after state; audit writes never fail the user's action.

## Notes and limitations

- Due dates are the statutory ones. **They are not adjusted for weekends, public holidays or CBIC/MCA extension notifications** — those are announced ad hoc and would need a feed. Treat a due date as the outer limit and file earlier.
- Professional tax, Shops & Establishments and Labour Welfare Fund dates and slabs are **state-specific**; the rules carry a representative date and say so in their description. Confirm yours.
- ADT-1 is generated annually, but a five-year auditor appointment only needs one filing — waive it in the intervening years.
- Form 61A is generated whenever turnover exceeds ₹1 crore, since whether reportable transactions occurred is a fact the profile does not capture. Waive it if none did.
- The engine reads the profile you give it. Turnover, headcount, cash-transaction ratio and the MSME-supplier flag all move real thresholds, so keeping them current is what keeps the calendar right.
- This produces reminders and working papers, not professional advice.
