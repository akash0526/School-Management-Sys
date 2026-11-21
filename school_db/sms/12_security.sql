-- =====================================================================
-- File 12: Security hardening
--   1. audit_trigger v2: never copies secrets (password / token / key hashes)
--      into audit_logs, and works for tables without an "id" column.
--   2. Audit coverage for security-sensitive tables (accounts, roles,
--      staff bank data, discounts, guardian links, API keys, settings...).
--   3. security_events: login / lockout / password / role / API-key events.
--   4. audit_logs + security_events are APPEND-ONLY (trigger-enforced).
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Audit trigger v2
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_redact(j JSONB)
RETURNS JSONB AS $$
    SELECT j - 'password_hash' - 'refresh_token_hash' - 'api_key_hash';
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS trigger AS $$
DECLARE
    v_user BIGINT := NULLIF(current_setting('app.user_id', TRUE), '')::BIGINT;
    v_old  JSONB;
    v_new  JSONB;
    v_row  JSONB;
    v_id   TEXT;
BEGIN
    IF TG_OP IN ('UPDATE','DELETE') THEN v_old := audit_redact(to_jsonb(OLD)); END IF;
    IF TG_OP IN ('UPDATE','INSERT') THEN v_new := audit_redact(to_jsonb(NEW)); END IF;

    -- Password changes are always recorded as a marker (never the hash) ...
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'users'
       AND to_jsonb(OLD)->>'password_hash' IS DISTINCT FROM to_jsonb(NEW)->>'password_hash' THEN
        v_new := v_new || '{"password_changed": true}';
    END IF;
    -- ... while an UPDATE that only touched bookkeeping columns (last_login_at) is not worth a row.
    IF TG_OP = 'UPDATE'
       AND (v_old - 'updated_at' - 'last_login_at') = (v_new - 'updated_at' - 'last_login_at') THEN
        RETURN NEW;
    END IF;

    v_row := COALESCE(v_new, v_old);
    -- record id: "id" column, else a composite key such as user_id/role_id
    v_id := COALESCE(
        v_row->>'id',
        NULLIF(concat_ws('/',
            v_row->>'user_id', v_row->>'role_id', v_row->>'permission_id',
            v_row->>'student_id', v_row->>'guardian_id', v_row->>'receipt_id', v_row->>'invoice_id', v_row->>'key'), ''));

    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_user, TG_OP, TG_TABLE_NAME, v_id, v_old, v_new);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 2. Audit coverage for security-sensitive tables
-- ---------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users', 'user_roles', 'role_permissions', 'roles', 'api_clients', 'settings',
        'staff', 'guardians', 'student_guardians', 'enrollments',
        'exams', 'fee_structures', 'fee_types', 'student_discounts', 'payment_allocations'
    ] LOOP
        IF to_regclass(t) IS NOT NULL THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$I', t);
            EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I
                            FOR EACH ROW EXECUTE FUNCTION audit_trigger()', t);
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. Security events (authentication & account administration)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_type   VARCHAR(40) NOT NULL,          -- login_success, login_failed, account_locked, refresh_reuse, ...
    severity     VARCHAR(8)  NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
    actor_user_id  BIGINT,                      -- who did it (NULL for anonymous)
    target_user_id BIGINT,                      -- whose account was affected
    username     CITEXT,                        -- as typed at login (may not exist)
    ip_address   INET,
    user_agent   VARCHAR(500),
    details      JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_security_events_time   ON security_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_security_events_type   ON security_events (event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_security_events_target ON security_events (target_user_id, occurred_at);

-- ---------------------------------------------------------------------
-- 4. Append-only logs: nobody (except a superuser who drops the trigger)
--    can edit or delete audit history.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_log_tampering()
RETURNS trigger AS $$
BEGIN
    -- audit_logs has a retention policy (see 0006_audit_log_retention.sql). The guard
    -- still refuses every ordinary DELETE; it only stands aside when the caller has
    -- explicitly declared intent for this transaction. `IS NOT DISTINCT FROM` means an
    -- unset / empty / NULL setting can never enable the bypass by accident.
    IF TG_OP = 'DELETE'
       AND TG_TABLE_NAME = 'audit_logs'
       AND current_setting('app.audit_retention', TRUE) IS NOT DISTINCT FROM 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION forbid_log_tampering();
DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION forbid_log_tampering();

DROP TRIGGER IF EXISTS trg_security_events_append_only ON security_events;
CREATE TRIGGER trg_security_events_append_only BEFORE UPDATE OR DELETE ON security_events
FOR EACH ROW EXECUTE FUNCTION forbid_log_tampering();
DROP TRIGGER IF EXISTS trg_security_events_no_truncate ON security_events;
CREATE TRIGGER trg_security_events_no_truncate BEFORE TRUNCATE ON security_events
FOR EACH STATEMENT EXECUTE FUNCTION forbid_log_tampering();

-- ---------------------------------------------------------------------
-- 4b. Retention for audit_logs (kept forever would grow without bound: a
--     marking season writes an audit row per mark per component).
--     security_events is deliberately NOT purged — those are authentication
--     records, small in volume and the first thing an investigation needs.
-- ---------------------------------------------------------------------
INSERT INTO settings (key, value)
VALUES ('audit_log_retention_days', '730'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION purge_audit_logs(p_days INT DEFAULT NULL)
RETURNS BIGINT AS $$
DECLARE
    v_days     INT;
    v_cutoff   TIMESTAMPTZ;
    v_eligible BIGINT;
    v_deleted  BIGINT := 0;
BEGIN
    v_days := COALESCE(p_days, (SELECT (value #>> '{}')::INT FROM settings WHERE key = 'audit_log_retention_days'));
    IF v_days IS NULL OR v_days <= 0 THEN
        RAISE NOTICE 'audit retention is disabled (window = %); nothing purged', v_days;
        RETURN 0;
    END IF;
    IF v_days < 30 THEN
        RAISE EXCEPTION 'refusing to purge audit_logs with a % day window (minimum 30)', v_days;
    END IF;

    v_cutoff := now() - make_interval(days => v_days);
    SELECT count(*) INTO v_eligible FROM audit_logs WHERE created_at < v_cutoff;

    -- no argument = dry run: report what is eligible, delete nothing
    IF p_days IS NULL THEN
        RAISE NOTICE '% audit_logs row(s) older than % (cutoff %) are eligible', v_eligible, v_days, v_cutoff;
        RETURN v_eligible;
    END IF;
    IF v_eligible = 0 THEN
        RAISE NOTICE 'no audit_logs rows older than %', v_cutoff;
        RETURN 0;
    END IF;

    PERFORM set_config('app.audit_retention', 'on', true);   -- local to this transaction
    DELETE FROM audit_logs WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE 'purged % audit_logs row(s) older than %', v_deleted, v_cutoff;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 5. Application DB role (least privilege). Run as superuser.
--    The app may read/write business data but may NOT alter schema,
--    nor modify/delete audit history.
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'school_app') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO school_app';
        EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO school_app';
        EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, security_events FROM school_app';
        -- the app may not run the retention purge either: that would be a way around the
        -- append-only guard it is not allowed to lift
        EXECUTE 'REVOKE EXECUTE ON FUNCTION purge_audit_logs(INT) FROM school_app';
        -- the migration ledger is read-only for the app: it must be able to report whether
        -- the schema is behind the code, but only a migration may write to it
        EXECUTE 'GRANT SELECT ON schema_migrations TO school_app';
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM school_app';
        EXECUTE 'REVOKE CREATE ON SCHEMA public FROM school_app';
        EXECUTE 'REVOKE CREATE ON SCHEMA public FROM PUBLIC';

        -- Tables created LATER must also be reachable, otherwise every new table silently
        -- locks the app out until this script is re-run by hand.
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public
                 GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO school_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public
                 GRANT USAGE, SELECT ON SEQUENCES TO school_app';
    END IF;
END $$;
