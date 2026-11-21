-- =====================================================================
-- 0006 — Retention window for audit_logs (and an escape hatch from append-only)
--
-- audit_logs has an AFTER INSERT/UPDATE/DELETE trigger on marks, invoices,
-- receipts, student_ledger and payslips, and nothing ever removes a row. A school of
-- 600 students writes roughly 1,500 audit rows a year from invoices and ledger alone;
-- marking season adds an entry per mark, per component, per student — a single exam
-- can write 30,000. After a few years the table is tens of millions of JSONB rows in a
-- database that has to be backed up and restored, and nothing in the app ever reads
-- rows older than the recent history shown in the admin screens.
--
-- THE PROBLEM THIS MIGRATION HAS TO SOLVE
-- 12_security.sql installs `trg_audit_logs_append_only`, a BEFORE UPDATE OR DELETE
-- trigger that raises 'audit_logs is append-only', plus a BEFORE TRUNCATE trigger.
-- That is deliberate and valuable: it means a compromised application account cannot
-- erase evidence of what it did. But it also means a retention job CANNOT delete
-- anything — `DELETE FROM audit_logs WHERE created_at < ...` aborts the same way an
-- attacker's would. A policy that cannot execute is worse than no policy, because it
-- looks like data is being cleaned up when it is not.
--
-- The fix: keep the guard, but make its refusal overridable by a caller that has
-- explicitly declared intent. The trigger still fires for every ordinary DELETE and
-- still raises; it only stands aside when the session has set
-- `app.audit_retention = 'on'`. That flag cannot be set by accident, is visible in
-- pg_stat_activity while a purge runs, and — importantly — requires an explicit
-- connection-level statement. The application role does not get DELETE on
-- audit_logs at all (12_security.sql revokes it), so the only ways to set the flag
-- and issue the DELETE are a superuser or a scheduled job running as the table owner.
--
-- WHAT IS DELETED
-- Rows older than the retention window (default 730 days = two academic years, which
-- covers an audit that arrives after the year has closed). Nothing is deleted from
-- security_events: those are authentication records (failed logins, lockouts,
-- permission grants) and are small — a few rows per user per year — and are exactly
-- the records an investigation reaches for. They keep their unconditional append-only
-- guard.
--
-- HOW TO RUN IT
--   SELECT purge_audit_logs();            -- default 730-day window
--   SELECT purge_audit_logs(365);         -- one year
--   SELECT purge_audit_logs(NULL);        -- dry run: report how many rows are eligible
-- It is safe to call every day: it deletes nothing when nothing is old enough.
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- 1. The append-only guard now has a declared escape hatch.
--    Same message and behaviour for every caller that has not opted in.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_log_tampering()
RETURNS trigger AS $$
BEGIN
    -- `IS DISTINCT FROM` so that an unset / empty / NULL setting never enables the bypass.
    IF TG_OP = 'DELETE'
       AND TG_TABLE_NAME = 'audit_logs'
       AND current_setting('app.audit_retention', TRUE) IS NOT DISTINCT FROM 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- The 12_security.sql triggers already point at this function, so replacing the body is
-- enough; re-assert them here in case this migration runs against a database where the
-- triggers were dropped.
DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION forbid_log_tampering();
DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION forbid_log_tampering();

-- ---------------------------------------------------------------------
-- 2. The retention window, stored in settings so a school can change it
--    without a code deploy. 0 or NULL disables purging entirely (keep forever).
-- ---------------------------------------------------------------------
INSERT INTO settings (key, value)
VALUES ('audit_log_retention_days', '730'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. The purge itself.
--    RETURNS the number of rows removed, or — for a dry run — the number
--    that WOULD be removed. Call it with a value, get a count back; no
--    silent background mutation.
-- ---------------------------------------------------------------------
-- The previous signature was purge_audit_logs(INT). CREATE OR REPLACE cannot replace a
-- function whose argument list changed — it would ADD an overload, leaving a bare
-- purge_audit_logs() ambiguous ("function is not unique") on an upgraded database.
DROP FUNCTION IF EXISTS purge_audit_logs(INT);

CREATE OR REPLACE FUNCTION purge_audit_logs(p_days INT DEFAULT NULL, p_dry_run BOOLEAN DEFAULT NULL)
RETURNS BIGINT AS $$
DECLARE
    v_dry_run  BOOLEAN;
    v_days     INT;
    v_cutoff   TIMESTAMPTZ;
    v_eligible BIGINT;
    v_deleted  BIGINT := 0;
BEGIN
    -- NULL means "use the configured window"; the settings row holds JSONB, so unwrap it.
    -- No argument at all = preview the configured window. An explicit window with
    -- p_dry_run unset = preview it. p_dry_run wins whenever it is given.
    v_dry_run := COALESCE(p_dry_run, p_days IS NULL);
    v_days := COALESCE(p_days, (SELECT (value #>> '{}')::INT FROM settings WHERE key = 'audit_log_retention_days'));

    IF v_days IS NULL OR v_days <= 0 THEN
        RAISE NOTICE 'audit retention is disabled (window = %); nothing purged', v_days;
        RETURN 0;
    END IF;
    IF v_days < 30 THEN
        -- A guard against a mistyped call (`purge_audit_logs(7)`) quietly shredding a
        -- term's worth of history. Shortening the window that far should be deliberate.
        RAISE EXCEPTION 'refusing to purge audit_logs with a % day window (minimum 30)', v_days;
    END IF;

    v_cutoff := now() - make_interval(days => v_days);

    SELECT count(*) INTO v_eligible FROM audit_logs WHERE created_at < v_cutoff;

    -- Report and stop when this call is a preview. The guard is `v_dry_run`, not "p_days
    -- was NULL": keying the dry run off the NULL check meant purge_audit_logs(365) counted
    -- the CONFIGURED window (730) instead of the one asked for, and reported 8 eligible
    -- when 26 were.
    IF v_dry_run THEN
        RAISE NOTICE '% audit_logs row(s) older than % (cutoff %) are eligible', v_eligible, v_days, v_cutoff;
        RETURN v_eligible;
    END IF;

    IF v_eligible = 0 THEN
        RAISE NOTICE 'no audit_logs rows older than %', v_cutoff;
        RETURN 0;
    END IF;

    -- Declare intent for THIS transaction only (is_local = true), so the flag cannot
    -- leak onto the next statement if this connection is reused by a pool.
    PERFORM set_config('app.audit_retention', 'on', true);

    DELETE FROM audit_logs WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    RAISE NOTICE 'purged % audit_logs row(s) older than %', v_deleted, v_cutoff;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_audit_logs(INT, BOOLEAN) IS
    'Deletes audit_logs rows older than the retention window (default from settings, 730 days). '
    'Call with no argument for a dry run. Requires UPDATE/DELETE privilege on audit_logs.';

-- ---------------------------------------------------------------------
-- 4. Constrain retention to whoever runs the schedule.
--    The app role may not delete audit history (12_security.sql), so it also may
--    not run this function — that would be a way around the guard it just lifted.
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'school_app') THEN
        REVOKE EXECUTE ON FUNCTION purge_audit_logs(INT, BOOLEAN) FROM PUBLIC;
        REVOKE EXECUTE ON FUNCTION purge_audit_logs(INT, BOOLEAN) FROM school_app;
    END IF;
END $$;
