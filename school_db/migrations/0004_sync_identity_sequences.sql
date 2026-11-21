-- =====================================================================
-- 0004 — Resynchronise identity sequences
--
-- Every table's id comes from an identity sequence. Migrating data in with explicit
-- ids (a CSV import, a pg_restore of a data-only dump, a manual INSERT to fix a row)
-- does NOT advance that sequence, so the next normal INSERT tries an id that already
-- exists and fails with "duplicate key value violates unique constraint ..._pkey".
--
-- The failure is confusing whenever it appears — the first receipt after a restore,
-- the first invoice of a new month — and it looks like a code bug rather than an
-- import artefact. This migration moves each sequence past the highest id in use.
--
-- Safe and idempotent: it only ever moves a sequence FORWARD to max(id). Running it
-- on a healthy database changes nothing.
-- =====================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
    r          RECORD;
    seq        TEXT;
    max_id     BIGINT;
    last_value BIGINT;
    bumped     INT := 0;
BEGIN
    FOR r IN
        SELECT c.relname AS tbl
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = c.oid AND a.attname = 'id' AND a.attnum > 0)
         ORDER BY c.relname
    LOOP
        seq := pg_get_serial_sequence('public.' || quote_ident(r.tbl), 'id');
        CONTINUE WHEN seq IS NULL;                 -- no identity/sequence on this table

        EXECUTE format('SELECT COALESCE(max(id), 0) FROM %I', r.tbl) INTO max_id;
        EXECUTE format('SELECT last_value FROM %s', seq) INTO last_value;

        IF max_id > 0 AND max_id >= last_value THEN
            -- next nextval() will be max_id + 1
            PERFORM setval(seq, max_id, true);
            bumped := bumped + 1;
            RAISE NOTICE 'resynced %.id sequence to %', r.tbl, max_id;
        END IF;
    END LOOP;

    IF bumped = 0 THEN
        RAISE NOTICE 'all identity sequences are already ahead of the data';
    END IF;
END $$;
