-- =====================================================================
-- Install the full SMS schema in order.
--   createdb school_sms
--   psql -d school_sms -f install.sql      (works from any directory)
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;
\ir 00_setup.sql
\ir 01_settings_auth.sql
\ir 02_people.sql
\ir 03_academic.sql
\ir 04_enrollment.sql
\ir 05_timetable_attendance.sql
\ir 06_exams.sql
\ir 07_fees_accounts.sql
\ir 08_payroll.sql
\ir 09_library_transport.sql
\ir 10_communication_admissions.sql
\ir 11_audit_views.sql
\ir 13_migrations.sql
\ir 98_triggers.sql
\ir 99_seed.sql
-- 12 runs after the seed: audit coverage, append-only logs, least-privilege grants.
-- It must run AFTER 13, because it grants SELECT on the migration ledger.
\ir 12_security.sql
COMMIT;
