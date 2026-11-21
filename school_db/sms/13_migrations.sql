-- =====================================================================
-- File 13: Schema migrations
--
-- The schema files (00–12) describe the CURRENT shape of the database, which is
-- what you get on a fresh `install.sql`. A school that has been running for a
-- term cannot be rebuilt from them without losing its data, so every change to a
-- live database is applied by a numbered migration instead.
--
-- This table records which migrations a database has seen. A migration runs at
-- most once, in name order, inside a transaction, and its checksum is recorded so
-- that editing a migration after it has shipped is detected rather than silently
-- skipped.
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT PRIMARY KEY,               -- file name, e.g. 0002_unique_invoice_per_period.sql
    checksum    TEXT NOT NULL,                  -- sha256 of the file as applied
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms INT NOT NULL DEFAULT 0,
    applied_by  TEXT NOT NULL DEFAULT current_user
);

COMMENT ON TABLE schema_migrations IS
    'Applied schema migrations. Written by school_backend/scripts/db-migrate.ts — do not edit by hand.';

-- The migration ledger is infrastructure, not school data: the app role may read it,
-- but only the migration owner writes it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM PUBLIC;
