-- =====================================================================
-- 0005 — Index the query paths the API actually uses
--
-- Three missing indexes, each tied to a specific query in school_backend.
-- Every one was reproduced by EXPLAIN before being added and re-checked after.
--
-- (1) students (first_name, last_name)  — the student list
--     `students.repository.list()` orders by s.first_name, s.last_name. The only
--     name index is (last_name, first_name), so the ordering cannot come from it and
--     Postgres sorts EVERY student row to return one page: measured 600 students ->
--     Seq Scan + Sort of 600 rows, and the cost is linear in the roll. With the
--     matching index the same page is a 50-row Index Scan that stops early, so page 1
--     no longer gets slower as the school grows.
--
--     NB the sort is (first_name, last_name), not the more usual (last_name,
--     first_name) — the index has to match the ORDER BY as written or it is dead
--     weight. Cheap school fix is upstream, but keep the two in step.
--
-- (2) invoice_items (invoice_id)  — invoice detail and invoice cancellation
--     `fees.repository.getInvoice()` aggregates every line of one invoice from
--     invoice_items. There is NO index on invoice_id at all (only the primary key),
--     so each invoice view scanned the whole table: measured 3,600 rows -> Seq Scan
--     3,600 rows, i.e. cost grows with the number of invoice lines in the school,
--     not with the size of the invoice. Also makes the FK on invoice_id checkable
--     without a scan when the parent invoice is touched.
--
-- (3) events (start_at)  — the public website events calendar
--     `public.service.events()` filters on start_at / end_at and orders by start_at.
--     The events table had no index other than its primary key, so every call to the
--     public events endpoint sorted the whole table. This is on the UNAUTHENTICATED
--     website route, i.e. the one index most exposed to being hammered.
--
-- Deliberately NOT added: an index on every foreign key. 98 of 140 FKs here have no
-- covering index, but a SQLite-era habit of indexing all of them would add ~98
-- indexes to a school database — write cost on every insert, and a planner with more
-- to choose from — for columns like `created_by` that are never filtered on. The
-- three above are the ones the code demonstrably filters, joins or orders by.
--
-- Safe on a live database: CREATE INDEX only reads, and each one is IF NOT EXISTS so
-- re-running is a no-op. These tables are small enough that the write lock taken
-- during creation is not worth the CONCURRENTLY complication (which also cannot run
-- inside the migration transaction).
-- =====================================================================

\set ON_ERROR_STOP on

CREATE INDEX IF NOT EXISTS idx_students_first_last ON students (first_name, last_name);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id);

CREATE INDEX IF NOT EXISTS idx_events_start_at ON events (start_at);

COMMENT ON INDEX idx_students_first_last     IS 'Student list ORDER BY first_name, last_name — must match students.repository.list().';
COMMENT ON INDEX idx_invoice_items_invoice   IS 'Invoice detail: aggregate one invoice''s lines without scanning all invoice_items.';
COMMENT ON INDEX idx_events_start_at         IS 'Public events calendar: date-range filter and ORDER BY start_at.';
