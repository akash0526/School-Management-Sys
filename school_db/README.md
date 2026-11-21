# School Database: Structure and Skeleton

**Engine:** PostgreSQL 15+ (tested on PostgreSQL 17) · **Setup:** single school · **Architecture:** two separate databases connected by a REST API

```
school_db/
├── README.md                         ← this file
├── sms/                              ← DATABASE 1: school_sms (private)
│   ├── install.sql                   ← runs all files below in order
│   ├── 00_setup.sql                  extensions + helper functions
│   ├── 01_settings_auth.sql          users, roles, permissions, API clients
│   ├── 02_people.sql                 students, guardians, staff
│   ├── 03_academic.sql               years, classes, sections, subjects
│   ├── 04_enrollment.sql             enrollments (central table)
│   ├── 05_timetable_attendance.sql   timetable, attendance, leave
│   ├── 06_exams.sql                  exams, marks, grading, results
│   ├── 07_fees_accounts.sql          fees, invoices, receipts, ledger, expenses
│   ├── 08_payroll.sql                salaries, payslips
│   ├── 09_library_transport.sql      library, transport
│   ├── 10_communication_admissions.sql notices, events, SMS, homework, admissions
│   ├── 11_audit_views.sql            audit log + public API views
│   ├── 12_security.sql               audit coverage, append-only logs, grants
│   ├── 13_migrations.sql             the schema_migrations ledger
│   ├── 98_triggers.sql               auto updated_at triggers
│   └── 99_seed.sql                   starter data (classes, NEB grades, roles...)
├── migrations/                       ← numbered upgrades for LIVE databases
│   ├── 0001_unique_invoice_per_period.sql
│   ├── 0002_token_lookup_indexes.sql
│   ├── 0003_optional_subject_must_be_optional.sql
│   ├── 0004_sync_identity_sequences.sql
│   ├── 0005_query_path_indexes.sql
│   └── 0006_audit_log_retention.sql
├── tests/test_constraints.sql        must-fail assertions (npm run db:test)
└── website/                          ← DATABASE 2: school_website (public)
    └── schema.sql
```

## Installation

**New installation** (empty database):

```bash
# Database 1 — School Management System
createdb school_sms
psql -d school_sms -f school_db/sms/install.sql     # works from any folder
cd school_backend && npm run db:migrate             # records the shipped migrations

# Database 2 — Public Website
createdb school_website
psql -d school_website -f school_db/website/schema.sql
```

**Upgrading an existing school** — never re-run `install.sql` on a live database, and
never `db:reset` (it drops everything). Apply the migrations instead:

```bash
cd school_backend
npm run db:migrate:status     # what is applied, what is pending
npm run db:migrate -- --backup --dry-run    # see the plan, take a dump
npm run db:migrate -- --backup              # apply (one transaction per file)
```

Each migration runs once, in name order, inside its own transaction: it either applies
completely or leaves the database untouched. The ledger records a checksum, so editing an
already-applied migration is reported as an error instead of silently diverging. The API
also warns at startup when the database is behind the code.

Some migrations cannot guess: `0001` refuses to create its unique index if duplicate
invoices already exist, prints every duplicate group, and changes nothing. Read the
report, decide which invoice to cancel, then re-run — or re-run with
`-v allow_duplicates=1` to cancel all but the oldest automatically.

### Keeping the database from growing without bound

`0006_audit_log_retention.sql` gives `audit_logs` a retention window. It is worth a
paragraph because it contradicts something the schema otherwise promises.

`12_security.sql` makes `audit_logs` append-only with a trigger, so a compromised
application account cannot erase evidence of what it did. That also meant *nobody*
could ever delete anything: the table grows forever, one row per mark, per invoice and
per ledger entry. A school of 600 students writes ~1,500 rows a year from invoicing
alone, and a single exam marking season adds tens of thousands. Left alone the table
becomes the largest thing in the database and the slowest part of every restore.

The migration keeps the guard but gives it one declared way out. The trigger still
raises for every ordinary `DELETE`; it stands aside only when the session has run
`SET app.audit_retention = 'on'`, and only for `DELETE` — never for `UPDATE`, so history
cannot be rewritten, only aged out.

```sql
SELECT purge_audit_logs();          -- preview the configured window
SELECT purge_audit_logs(365);       -- preview a specific window
SELECT purge_audit_logs(365, false);-- delete rows older than a year
```

The second argument is dry-run-ness, and it defaults to *preview*: a call with no
explicit `false` reports and stops. (Keying that off "was the window NULL" was a bug —
`purge_audit_logs(365)` counted the *configured* 730-day window and under-reported.)

The window lives in `settings.audit_log_retention_days` (default 730 days, two academic
years) so a school can change it without a code deploy; `0` disables purging. A window
under 30 days is refused outright — a mistyped `purge_audit_logs(7)` should not shred a
term's history. `security_events` is deliberately **not** purged: those are
authentication records, small in volume, and the first thing an investigation needs.

The app role cannot run the purge (the migration revokes it), because the app role also
cannot delete from `audit_logs` — letting it call the function would be a way around
the guard.

#### Scheduling it

`npm run db:retention` wraps the function so nobody has to remember the SQL:

```bash
npm run db:retention                 # dry run — what WOULD be purged, deletes nothing
npm run db:retention -- --apply      # actually purge
npm run db:retention -- --days 365   # preview a different window
```

**The dry run is the default on purpose.** This is the one operation that destroys audit
history, so the thing scheduled unattended should be the read-only one — someone
experimenting with a cron entry cannot lose data, they get a log line saying "would have
purged N rows". Flip `--apply` once you have seen that line. The script exits non-zero on
failure, so a scheduler can alert.

```cron
# 03:15 on the first of each month, as the database owner
15 3 1 * *  cd /srv/school/school_backend && npm run db:retention -- --apply >> /var/log/school-retention.log 2>&1
```

### Indexes

`0005_query_path_indexes.sql` adds the three indexes the API's queries actually need:
the student list's `ORDER BY first_name, last_name` (it previously sorted every student
to return one page), `invoice_items.invoice_id` (invoice detail previously scanned all
invoice lines in the school), and `events.start_at` (the unauthenticated public events
calendar). It deliberately does **not** index all 98 unindexed foreign keys — that would
add ~98 indexes to every school database, slowing every insert, for columns like
`created_by` that are never filtered.

The constraint suite asserts these objects exist: a missing index breaks nothing
visibly, so without an assertion it would only show up as a slow school years later.

**Adding a change**: edit the numbered files in `sms/` for fresh installs *and* add a
migration for databases already running. Both are required; the constraint suite and CI
(which replays every migration) catch the common mistakes.

---

## Architecture

```
   Visitors                                     Staff / Students / Parents
      │                                                    │
      ▼                                                    ▼
┌──────────────────────┐   REST API (API key)   ┌──────────────────────────┐
│ www.school.edu.np    │ ─────────────────────▶ │ portal.school.edu.np     │
│ Website app          │ ◀───────────────────── │ SMS app + REST API       │
└─────────┬────────────┘                        └────────────┬─────────────┘
          │                                                  │
   ┌──────▼─────────┐                              ┌─────────▼──────────┐
   │ school_website │  22 tables                   │ school_sms         │  80 tables
   │ (public data)  │                              │ (private data)     │  6 views
   └────────────────┘                              └────────────────────┘
```

---

## Database 1: `school_sms` (80 tables)

### Module map

| # | Module | Tables |
|---|---|---|
| 01 | **Settings & Auth** | `school_profile`, `settings`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_sessions`, `password_resets`, `api_clients` |
| 02 | **People** | `departments`, `students`, `guardians`, `student_guardians`, `staff`, `documents` |
| 03 | **Academic** | `academic_years`, `terms`, `school_calendar`, `classes`, `streams`, `rooms`, `sections`, `subjects`, `class_subjects`, `teacher_assignments` |
| 04 | **Enrollment** | `enrollments`, `student_subjects`, `student_status_history`, `transfer_certificates` |
| 05 | **Timetable & Attendance** | `periods`, `timetable_entries`, `student_attendance`, `staff_attendance`, `leave_types`, `leave_requests` |
| 06 | **Exams** | `grading_scales`, `grading_scale_items`, `exams`, `exam_schedules`, `assessment_components`, `marks`, `exam_component_results`, `exam_subject_results`, `exam_results` |
| 07 | **Fees & Accounts** | `fee_types`, `fee_structures`, `student_discounts`, `fine_rules`, `invoices`, `invoice_items`, `receipts`, `payment_allocations`, `online_payments`, `student_ledger`, `expense_categories`, `expenses` |
| 08 | **Payroll** | `salary_components`, `staff_salary_structures`, `payslips`, `payslip_items` |
| 09 | **Library & Transport** | `books`, `book_copies`, `book_issues`, `vehicles`, `transport_routes`, `route_stops`, `student_transport` |
| 10 | **Communication & Admissions** | `notices`, `notice_targets`, `events`, `notifications`, `sms_logs`, `assignments`, `assignment_submissions`, `admission_inquiries`, `admission_applications` |
| 11 | **Audit & Views** | `audit_logs`, `security_events` · views: `v_student_balances`, `v_current_enrollments`, `public_notices`, `public_events`, `public_staff`, `public_results` |

### Core relationships

```
users ──1:1── students ──< student_guardians >── guardians ──1:1── users
  │               │
  └──1:1── staff  │ 1:N
             │    ▼
             │  enrollments >── sections >── classes
             │    │   │            │  └──── academic_years ──< terms
             │    │   │            └─ stream (Gr 11-12)
             │    │   │
             │    │   ├──< student_subjects >── class_subjects >── subjects
             │    │   ├──< student_attendance
             │    │   ├──< marks >── assessment_components >── exam_schedules >── exams
             │    │   ├──< exam_results / exam_subject_results
             │    │   ├──< invoices ──< invoice_items >── fee_types
             │    │   └──< student_transport >── route_stops >── transport_routes
             │    │
             │  students ──< receipts ──< payment_allocations >── invoices
             │  students ──< student_ledger   (balance = Σdebit − Σcredit)
             │
             ├──< teacher_assignments >── sections + class_subjects
             ├──< timetable_entries
             ├──< staff_attendance
             └──< payslips ──< payslip_items
```

### Design decisions

| Decision | Why |
|---|---|
| **`enrollments` is the central table** | Class and section change every year. Attendance, marks, invoices and transport all point to `enrollment_id`, so each student's history is kept. |
| **Sections belong to one academic year** | Grade 5 'A' in 2083 is a different row from Grade 5 'A' in 2084. A composite foreign key stops an enrollment pointing to a section from another year. |
| **`assessment_components`** | Theory, practical, internal and CAS are rows, not fixed columns, so NEB rule changes don't need schema changes. Each part has its own `credit_hours`, because NEB grades theory and internal separately. |
| **NG has no grade point** | `grade_point` is NULL for NG, and GPA is NULL if any subject is NG. `result_status` is `graded`, `not_graded`, `absent` or `withheld` (NEB has no "fail"). |
| **Parallel optional subjects** | The timetable allows two optional subjects (Opt. Maths and Computer) in the same section and period. Teacher and room clashes are still blocked. |
| **`student_ledger`** | Handles advance payments, partial payments and dues carried forward across years. |
| **Grading stored as data** | `grading_scale_items` is seeded with NEB letter grading. Verify it against the latest NEB directive. |
| **Dates stored in AD** | Convert to Bikram Sambat (BS) only for display in the app. |
| **`public_*` views** | The only data the website API should expose. They contain no phone numbers, addresses, salaries or fees. |
| **Audit triggers** | Every change to `students`, `marks`, `invoices`, `receipts`, `student_ledger` and `payslips` is logged with the user who made it. |

### Rules enforced by the database

These are asserted by `tests/test_constraints.sql` — run it with `npm run db:test` from
`school_backend/` (it creates and drops its own throwaway database). 42 must-be-rejected
statements plus trigger-computed invoice and grade checks. The suite fails loudly if a
statement it expects the database to reject is instead accepted, so a dropped constraint
cannot pass silently.

**Academic**
- ✅ One enrollment per student per academic year, a unique roll number per section, and a unique symbol number per year
- ✅ An enrollment, teacher assignment or timetable entry must use a section from the **same academic year**
- ✅ Academic years can't overlap, and only one can be current
- ✅ A chosen optional subject must be **optional** and belong to the student's own class, stream and year (a compulsory subject is never stored as a choice)
- ✅ No teacher or room clashes in a period (parallel optional subjects in one slot are allowed on purpose)

**Exams**
- ✅ Marks can't exceed the full marks
- ✅ Marks are only accepted from students in that paper's class, stream and year
- ✅ Marks for an optional subject are only accepted if the student chose it
- ✅ Absent ⇔ no marks (an absent student can't have marks, and every row without marks must be marked absent)
- ✅ Grade ranges in a grading scale can't overlap

**Fees**
- ✅ Invoice subtotal and discount are calculated automatically from invoice items, and the total is a generated column
- ✅ The invoice's paid amount and status (unpaid, partial, paid) update automatically from payments
- ✅ A receipt can't be allocated more than its amount
- ✅ An invoice can't be overpaid
- ✅ A receipt can't pay another student's invoice
- ✅ Cancelling a receipt automatically removes its amount from the invoices it paid
- ✅ Ledger entries are either debit or credit, never both

**General**
- ✅ One primary guardian per student, and a library copy can't be issued twice at once
- ✅ Date sanity checks (end ≥ start) on leave, exams, events, notices, discounts, library and transport
- ✅ `updated_at` is set automatically, and sensitive tables are audited

### Tips for the API code
```sql
-- In every write transaction, tell the audit trigger who the user is:
BEGIN;
SET LOCAL app.user_id = '42';
UPDATE marks SET marks_obtained = 65 WHERE id = 10;
COMMIT;
```

---

## Database 2: `school_website` (22 tables)

| Group | Tables |
|---|---|
| **Admin & Settings** | `admin_users`, `site_settings` |
| **Content** | `media`, `pages`, `post_categories`, `posts`, `menus`, `menu_items` |
| **Visual** | `sliders`, `gallery_albums`, `gallery_items`, `testimonials`, `faqs`, `downloads` |
| **Visitor submissions** | `admission_inquiries`, `contact_messages`, `newsletter_subscribers` |
| **Synced from SMS (read-only)** | `synced_notices`, `synced_events`, `synced_staff` |
| **System** | `sync_logs`, `result_lookup_attempts` |

> Exam results are **not** stored in the website database. The website calls the SMS API live and records attempts in `result_lookup_attempts` for rate limiting.

---

## API contract between the two systems

The website authenticates with an API key. Only a hash of the key is stored, in `api_clients.api_key_hash`; the key itself lives in a website environment variable.

| Method | SMS endpoint | Scope | Source in SMS | Website table |
|---|---|---|---|---|
| `GET`  | `/api/v1/public/notices?updated_since=` | `notices.read` | `public_notices` view | `synced_notices` |
| `GET`  | `/api/v1/public/events?updated_since=`  | `events.read`  | `public_events` view  | `synced_events` |
| `GET`  | `/api/v1/public/staff?updated_since=`   | `staff.read`   | `public_staff` view   | `synced_staff` |
| `POST` | `/api/v1/public/inquiries`              | `inquiries.create` | → `admission_inquiries` (`external_ref` = website id) | `admission_inquiries.sync_status` |
| `POST` | `/api/v1/public/results/lookup` `{symbol_no, dob, exam_id}` | `results.lookup` | `public_results` view | not stored |

**Sync flow:** a cron job on the website runs every 15 minutes. It sends `GET ...?updated_since=<max(sms_updated_at)>`, upserts the results by `sms_id`, then pushes any inquiries still marked `pending`. Each run is logged in `sync_logs`.

---

## The website API's database role (tested)
The commented block at the end of `11_audit_views.sql` creates a `website_api` role. It can:
- ✅ read `public_notices`, `public_events`, `public_staff` and `public_results`
- ✅ insert into `admission_inquiries`, limited to the inquiry form's columns
- ❌ gets "permission denied" on `students`, `invoices`, `marks`, staff data and inquiry phone numbers

## Left to the application (by design)
- When a receipt is cancelled, post a reversing `adjustment` entry in `student_ledger`.
- Calculate results (grade per part, then subject grade, then GPA) and store them in the result tables.
- Convert dates between BS and AD, and update `book_copies.status` when books are issued or returned.

## Changelog
**v2 (after review):** fixed `install.sql` paths (`\ir`); stopped academic years and grade ranges from overlapping; enforced section/year consistency for teacher assignments and timetable entries; allowed parallel optional subjects; added validation of optional subjects and of which students can receive marks; fixed the absent/marks rule; added credit hours per part and a new `exam_component_results` table; NG now has no grade point; added automatic invoice totals and status, payment allocation checks and receipt-cancellation handling; added a unique symbol number per year; hid grades of withheld results; added date sanity checks; changed staff leave types to Labour Act 2074 defaults; tested the `website_api` permissions.

## Next steps
1. Edit `sms/99_seed.sql` (academic year dates, periods, fee types) to match your school.
2. Choose your backend framework and generate models from this schema.
3. Build the API layer using the endpoints above.
4. Add BS ↔ AD date conversion in the application.
