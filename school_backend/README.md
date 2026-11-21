# School Management System — Backend API

Node.js 20 + TypeScript + Express 5 + PostgreSQL (`~/school_db`).
Single school, Nepal context (NEB grading, BS calendar, eSewa/Khalti).

```
✔ 83 source files · 9 modules · typecheck clean
✔ 49 unit + integration tests   (npm test)
✔ 103-step end-to-end workflow  (npm run test:e2e)
```

---

## 1. Architecture

### Each module has its own folder and its own 3 layers

```
src/modules/<module>/
├── api/                ← LAYER 1: HTTP only
│   ├── *.schemas.ts       zod validation (strict: unknown fields rejected)
│   ├── *.controller.ts    parse request → call service → send JSON
│   └── *.routes.ts        URLs + permission guards
├── business/           ← LAYER 2: rules (no SQL, no Express)
│   ├── *.ports.ts         interfaces this module NEEDS (repository + other modules)
│   └── *.service.ts       the rules: who may do what, validation, workflows
├── data/               ← LAYER 3: SQL only (no rules)
│   └── *.repository.ts    implements the repository port with `pg`
└── index.ts            ← the module's ONLY public surface (factory function)
```

Dependency direction is one-way: **api → business ← data**. The business layer
defines interfaces (`ports.ts`); the data layer implements them. Business code never
imports `pg` or `express`, so the database or the web framework can change without touching rules.

### Modules never import each other

They talk through tiny **ports**, wired in a single place, `src/container.ts`:

```
auth ──accounts──▶ students, staff          (create login accounts)
students, staff ──resolveIdentity──▶ auth   (who is this user? parent/teacher/student)
academic ──lookup──▶ enrollment, attendance, exams
students ──access──▶ attendance, exams, fees ("may this user see this student?")
students ──lookup──▶ enrollment
```

**To replace a module**, write a new one that satisfies the same ports and change one line in `container.ts`.
**To add a module** (library, transport, payroll, hostel…):

1. Copy the folder shape above into `src/modules/library/`.
2. In `business/library.ports.ts`, declare what you need (e.g. `StudentAccess`).
3. Export `createLibraryModule(deps)` from `index.ts`, returning `{ routes: [{ path: '/library', router }] }`.
4. Register it in `src/container.ts`. Done — no other file changes.

Cross-module side effects use the **event bus** (`src/shared/events/eventBus.ts`):
`student.created`, `attendance.absent`, `results.published`, `receipt.created`,
`receipt.cancelled`, `inquiry.received`. A future `notifications` module can subscribe
(e.g. SMS to parents on absence) without changing the publishers. It is in-process now
and can be swapped for Redis/RabbitMQ behind the same interface.

### Shared foundation (`src/shared`)

| File | Purpose |
|---|---|
| `db/database.ts` | pg pool, `transaction(actorUserId, fn)` — sets `app.user_id` so DB audit triggers record who changed what. DATE stays `YYYY-MM-DD` (no TZ shift). |
| `db/sql.ts` | `buildInsert/buildUpdate` from whitelisted column maps, snake→camel |
| `auth/*` | `AuthUser`, `requirePermission(...)`, JWT guard |
| `http/*` | common zod types, error handler, rate limiter, request id |
| `errors.ts` | `AppError` + PostgreSQL error mapping (unique → 409, FK → 409, trigger → 400) |
| `time.ts` | `todayInNepal()` (Asia/Kathmandu) |

---

## 2. Security

| Area | What is done |
|---|---|
| Passwords | bcrypt (cost ≥ 12 in production). **Policy** (`auth/business/passwordPolicy.ts`): ≥ 10 chars (admins ≥ 12), ≤ 72 bytes, a letter + a digit (any script — Devanagari letters and digits count), not on the common/Nepal-specific list and not a common word dressed up with digits/symbols (`Password@123`, `Nepal2083!`, `School#1`…), not containing the username. New/reset accounts must change password before using anything else. Wrong-current-password attempts on change-password are throttled (5 / 15 min) |
| Login | Per-IP and per-username rate limits + lockout throttle; same error for wrong user/password |
| Tokens | 15-min HS256 access JWT (issuer + audience checked, max 1 h enforced at startup) · 7-day **rotating** refresh token in `httpOnly`, `SameSite=Strict` cookie, stored hashed; **reuse of an old refresh token revokes all sessions** |
| Revocation | Every access token carries its session id (`sid`) and the auth guard checks the session is still alive (15 s cache, dropped instantly on local revocation). **Logout, password change/reset, role change, deactivation and stolen-token detection cut off live access tokens immediately** — not 15 minutes later |
| Leavers | Marking staff **resigned / retired / terminated** or a student **transferred / left / graduated / dropped** deactivates their login and ends its sessions in the same transaction (same anti-escalation rule — you can't switch off an account more powerful than yours). Guardian logins stay (dues/statements). Re-activation is a deliberate admin action (`PATCH /users/:id {isActive:true}`) |
| CSRF | `/auth/refresh` and `/auth/logout` (the only cookie-authenticated routes) reject requests whose `Origin` is not in `CORS_ORIGINS` |
| Anti-escalation | Granting roles: you must already hold **every permission** of the roles you grant; only a super_admin can grant super_admin. Managing accounts (reset password, deactivate, change roles): the target's permissions must be a subset of yours — a `users.manage` admin cannot take over the principal's or a super_admin's account. Non-super admins cannot change their own roles |
| Authorization | Permission codes from DB roles (`requirePermission`) **plus** ownership rules in the business layer: parents see only their children, students only themselves, teachers only sections/subjects they teach |
| Data minimisation | Staff bank / citizenship / PAN / DOB are hidden unless `staff.manage` or self. Public API reads only `public_*` views; DOB never returned. The internal session id is never sent to clients |
| Input | Every body/query/param validated with **strict** zod schemas (zod ≥ 4.6.7 — GHSA-mrhx-c7xc-m3w5 fixed); JSON arrays > 1000 items refused at parse time; free-form `customFields` limited to 30 keys × 500 chars; photo URLs must be `http(s)`; 1 MB body limit; parameterised SQL only; `%`/`_` in search terms are matched literally; column whitelists for dynamic updates |
| Money integrity | DB triggers block over-allocation, over-payment, cross-student allocation; app writes ledger entries in the same transaction |
| Website API | `X-API-Key` (SHA-256 hashed in `api_clients`), per-key **scopes**, optional IP allow-list, rate limits, results lookup brute-force throttle (5 failures / 15 min per symbol no.). Keys can be **revoked or rotated** (`npm run manage-api-key`) |
| HTTP | helmet: `CSP default-src 'none'; frame-ancestors 'none'`, HSTS, nosniff, `Referrer-Policy: no-referrer`, CORP same-site · `Cache-Control: no-store` on all private API responses · CORS allow-list with credentials · request ids · no stack traces/SQL in responses (DB errors map to 400/409/503: too-long value, out-of-range number, concurrent-update retry, query timeout) · logs never contain tokens/cookies/keys/passwords |
| Monitoring | `security_events` table (append-only): login success/failure, lockouts, logout, password change (and failed attempts) / reset, account created / deactivated / reactivated, role changes, **blocked escalation attempts**, refresh-token reuse (critical), rejected/IP-blocked API keys (fingerprint only, never the key), result-lookup throttling. Every 403 is also logged. Admins read it at `GET /users/security-events?type=&severity=&userId=&since=` |
| Audit | `audit_logs` is **append-only** (even for the DB superuser) and covers accounts, roles, permissions, API clients and settings. Secrets are redacted: password/refresh/API-key hashes are never stored — a password change appears as `"password_changed": true` |
| DB | App connects as `school_app`: DML only, cannot create/drop/alter tables, cannot UPDATE/DELETE/TRUNCATE the audit or security logs. `DB_SSL=true` for TLS to a remote database |
| Startup checks | The server **refuses to start** with: a placeholder or low-entropy `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL` > 1 h; and in production (the default `NODE_ENV`): `COOKIE_SECURE=false`, non-`https` or `*` CORS origins, `BCRYPT_ROUNDS` < 12, or a non-local DB without `DB_SSL` |

### Operating it
```bash
npm run manage-api-key -- --name public-website --revoke   # website key leaked → cut it off now
npm run manage-api-key -- --name public-website --rotate   # issue a new key (old one stops working)
```
```sql
-- what happened recently? (or GET /api/v1/users/security-events?severity=critical)
SELECT occurred_at, event_type, severity, username, host(ip_address), details
  FROM security_events WHERE occurred_at > now() - interval '1 day' ORDER BY occurred_at DESC;
```
Things to watch: `refresh_reuse` (a token was stolen — that user's sessions were already killed; reset their
password), bursts of `login_failed` / `account_locked` from one IP, any `privilege_escalation_blocked`, and
`api_key_rejected` with a fingerprint matching a real key.

---

## 3. Endpoints (all under `/api/v1`)

Auth: `Authorization: Bearer <accessToken>` except `/public/*` (API key) and `/auth/login|refresh`.

**auth** — `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` · `POST /auth/change-password`
**users** (users.manage) — `GET/POST /users` · `PATCH /users/:id` · `PUT /users/:id/roles` · `POST /users/:id/reset-password` · `GET /users/roles`

**students** — `GET/POST /students` · `GET /students/mine` (parent → children, student → self) · `GET/PATCH /students/:id` · `POST /students/:id/status` · `POST /students/:id/account` · `GET/POST /students/:id/guardians` · `DELETE /students/:id/guardians/:guardianId`
**guardians** — `GET/POST /guardians` (list items include `children[]` and `userId`) · `GET/PATCH /guardians/:id` · `POST /guardians/:id/account`. `GET /students/:id/guardians` also returns each guardian's `userId` (has a parent login).

**staff** — `GET/POST /staff` · `GET /staff/me` · `GET/PATCH /staff/:id` · `POST /staff/:id/account` · `GET/POST /staff/departments`

**academic** — `/academic/years` (+ `/:id/set-current`, `/:id/terms`) · `/academic/classes` · `/academic/streams` · `/academic/rooms` · `/academic/sections` · `/academic/subjects` · `/academic/class-subjects` · `/academic/teacher-assignments` · `/academic/calendar`

**enrollments** — `GET/POST /enrollments` · `POST /enrollments/promote` · `POST /enrollments/sections/:sectionId/assign-roll-numbers` · `GET/PATCH /enrollments/:id` · `PUT /enrollments/:id/subjects`

**attendance** — `PUT/GET /attendance/sections/:sectionId` (bulk mark / roster) · `GET /attendance/students/:studentId[?from&to]` · `GET /attendance/students/:studentId/summary` · `PUT/GET /attendance/staff`

**exams** — `GET/POST /exams` · `GET/PATCH /exams/:id` · `GET/POST /exams/:id/schedules` (with components TH/IN/PR) · `GET/PUT /exams/components/:componentId/marks` · `GET /exams/students/:studentId/results` (exam history; parents/students: own, published only) · `POST /exams/:id/verify` · `POST /exams/:id/process` · `POST /exams/:id/publish` · `GET /exams/:id/results` · `GET /exams/:id/report-cards/:studentId`

**fees** — `GET/POST /fees/types` · `GET/POST /fees/structures` · `GET/POST /fees/discounts` · `POST /fees/invoices/generate` · `GET /fees/invoices` · `GET /fees/invoices/:id` · `POST /fees/invoices/:id/cancel` · `POST /fees/receipts` · `GET /fees/receipts/:id` · `POST /fees/receipts/:id/cancel` · `GET /fees/students/:studentId/statement` · `GET /fees/students/:studentId/invoices` · `GET /fees/summary` (fees.view — outstanding, overdue, collected today / last 30 days)

**school** — `GET /school/branding` (no auth: name, Nepali name, logo URL, `configured`; plus `demoAccounts` only in a demo DB) · `GET /school/logo` (no auth, cached, `?v=` busts) · `GET /school/profile` (any login) · `PUT /school/profile` · `PUT /school/logo {dataUrl}` (PNG/JPEG/WebP ≤ 300 KB, magic bytes checked; SVG refused) · `DELETE /school/logo` — writes need `settings.manage`.

**public** (website server, `X-API-Key`) — `GET /public/school` · `GET /public/notices[?updatedSince]` · `GET /public/notices/:id` · `GET /public/events[?from&to]` · `GET /public/staff` · `GET /public/classes` · `POST /public/inquiries` (idempotent by `externalRef`) · `POST /public/results/lookup` `{ symbolNo | admissionNo, dob }`

`GET /health` — liveness + DB check (no auth).

### Key business rules
- **Attendance**: no future dates; holidays need `attendance.mark_any` + `allowHoliday`; teachers mark only sections they teach / class-teach; re-marking updates (upsert).
- **Marks**: `marks.enter` = only your assigned subject+section; editing clears verification; locked after publish.
- **Results**: NEB letter grading — each component graded separately; < pass marks (35% theory) = NG; GPA = Σ(credit hrs × GP) / Σ credit hrs; any NG/ABS ⇒ no GPA; ranks 1, 2, 2, 4. Processing refuses if marks are missing (unless `force` → treated absent). Parents/students see report cards only after publish; withheld results are hidden.
- **Fees**: invoice numbers from `invoice_no_seq` (`INV-2083-000001`); bulk generation is atomic and idempotent per billing period; discounts (percent/fixed, per fee type or all) applied per line; stream-specific fees override general ones; payments auto-allocate oldest-first, remainder kept as advance credit; explicit allocations may name each invoice only once; digital payments need a reference no.; cancelling a receipt reverses the ledger.

---

## 4. Run it

```bash
# 1. database (once)
cd ~/school_db && psql -U postgres -c "CREATE DATABASE school_sms" && psql -U postgres -d school_sms -f sms/install.sql

# 2. app DB user — least privilege (DML only; audit/security logs are insert-only)
psql -U postgres -d school_sms -c "CREATE ROLE school_app LOGIN PASSWORD 'a-long-random-password'"
psql -U postgres -d school_sms -c "GRANT CONNECT ON DATABASE school_sms TO school_app"
psql -U postgres -d school_sms -f sms/12_security.sql   # (re)applies grants now that the role exists — idempotent

# 3. app
cd ~/school_backend
npm install
cp .env.example .env            # set DATABASE_URL, CORS_ORIGINS, and JWT_ACCESS_SECRET:
                                #   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
                                # (server refuses to start with the placeholder; use NODE_ENV=development locally)
npm run create-admin -- --username admin --password 'a-long-strong-password'   # ≥ 12 chars, policy-checked
npm run create-api-key -- --name public-website \
   --scopes school.read,notices.read,events.read,staff.read,inquiries.create,results.lookup
npm run dev                     # http://0.0.0.0:4000
# then sign in to the web app → School settings: name, address, PAN, logo

# production (NODE_ENV defaults to production; startup checks enforce HTTPS-only settings)
npm run build && npm start
```

### Demo school or empty school (switchable)

Both commands **delete the whole `school_sms` database** and rebuild it (they ask for confirmation; `--yes` skips it).
`PSQL` is how to reach Postgres as its owner — e.g. `PSQL="sudo -u postgres psql"` or `PSQL="psql -U postgres -h db"`.
Stop the API first (or restart it afterwards), then re-create the website key with `npm run create-api-key`.

```bash
# A realistic demo: "Himalayan Model Secondary School", 120 students, 22 staff, 16 sections,
# attendance since Baisakh, a published First Terminal, a scheduled Second Terminal, 960 invoices, 638 receipts.
PSQL="sudo -u postgres psql" npm run db:demo -- --yes
#   every demo account uses password Demo@School2083 (override with DEMO_PASSWORD=...):
#   admin · principal · office · accountant · teacher · parent · student
#   the sign-in page lists them as one-click buttons (only in a demo DB)

# A clean school for real use: schema + reference data (NEB grading, classes, roles, fee types) + ONE super admin.
PSQL="sudo -u postgres psql" npm run db:reset -- --yes --admin-user admin --admin-pass 'a-long-strong-password'
```

- **Never load demo data into a live school.** Demo accounts share a published password. `db-reset.sh` refuses to run when
  `NODE_ENV=production` unless you add `--i-know-this-is-production`.
- The demo is deterministic (fixed random seed), so screenshots and training material stay valid after a rebuild.
- Demo data is created through the same services the API uses (no hand-written SQL), so it obeys every business rule.

### Tests
```bash
npm test            # 114 tests: unit (NEB grading, fees, school profile & logo validation, password policy, anti-escalation, leavers, session gate, startup checks, DB-error mapping)
                    # + integration (headers, CORS, CSRF origin check, forged/revoked/legacy tokens, huge-array DoS)
npm run test:e2e    # needs running server: API_URL, ADMIN_USER, ADMIN_PASS, API_KEY env vars
                    # it adds test records — run it on an empty DB (npm run db:reset), not on real data
npm run typecheck
```

The e2e script walks a whole term: setup → staff → students/guardians → enrollment → teacher & parent
first login → attendance → exam, marks, results, report card → invoices, discounts, payments,
cancellation → website API (notices, inquiries, results lookup, brute-force throttle) → refresh-token theft
detection → immediate revocation (logout, admin reset, stolen token) → a teacher resigns and loses access — 124 checks, and checks every
permission boundary on the way (teacher can't enter marks for other subjects, parent can't see other
children, teacher can't collect fees, etc.).

---

## 5. Production notes / known limits

- `API_RATE_LIMIT_PER_MIN` (default 600) is the per-IP limit for authenticated API calls. A whole school behind one
  NAT'd router shares an IP — raise it if the office reports "Too many requests".

- **Multiple instances**: login throttle, rate limits and the results-lookup throttle are in-memory.
  Behind a load balancer use a Redis store (`rate-limit-redis`) — interfaces are already isolated.
  The session cache is per-process too: a revocation made on another instance takes effect within 15 s.
- Login lockout is per username (5 failures → 15 min), so someone who knows a username can keep that
  account locked out. This is the usual trade-off against password guessing; watch `account_locked` events.
- Run behind nginx with HTTPS; set `TRUST_PROXY=1`, `COOKIE_SECURE=true` (enforced in production).
- `security_events` / `audit_logs` grow forever by design (append-only). Archive old rows yearly with a
  maintenance job that temporarily disables the append-only trigger as the DB owner.
- After deploying this version every user must sign in again once (old tokens have no session id).
- Exam class rank (`rank_in_class`) is complete only when processing the whole exam (no `sectionId`).
- Events `attendance.absent` / `results.published` have no subscribers yet (future notifications module: SMS via Sparrow/Aakash SMS).
- Online payment gateways (eSewa/Khalti verification callbacks → `online_payments`) are not implemented yet; receipts with method `esewa`/`khalti` are recorded manually with the gateway reference.
- Not yet built (same pattern): payroll, library, transport, hostel, timetable, homework, notices admin, leave requests, admissions workflow, expenses, reports/exports, BS date conversion helpers for the frontend.
