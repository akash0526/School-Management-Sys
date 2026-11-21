-- =====================================================================
-- SCHOOL MANAGEMENT SYSTEM (SMS) DATABASE
-- File 00: Setup — extensions & shared helper functions
-- Engine : PostgreSQL 15+  (uses NULLS NOT DISTINCT)
-- Usage  : createdb school_sms && psql -d school_sms -f install.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive text (emails, usernames)
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), hashing helpers
CREATE EXTENSION IF NOT EXISTS btree_gist; -- exclusion constraints (no overlapping ranges)

-- ---------------------------------------------------------------------
-- Auto-update "updated_at" on every UPDATE.
-- Attached automatically to every table with an updated_at column
-- by the DO-block in 98_triggers.sql.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
