-- =====================================================================
-- 0001 — One live invoice per student per billing period
--
-- Before this, two cashiers (or a double-click, or two API requests) could create
-- two invoices for the same student and the same period, so the family was billed
-- twice. The index makes the second insert fail at the database.
--
-- A migration, not a schema edit, because a running school already has data: if it
-- already contains duplicates the index cannot be created until they are resolved.
-- This file therefore REFUSES to guess. It reports every duplicate group and stops,
-- and the operator decides which invoice to cancel (or re-runs with
--      -v allow_duplicates=1
-- to cancel the newest duplicate automatically, keeping the oldest).
--
-- Cancelled invoices keep their period, so a cancelled and re-issued bill is fine.
-- =====================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
    v_dupes  BIGINT;
    v_rows   TEXT;
BEGIN
    SELECT count(*), string_agg(dup, E'\n    ')
      INTO v_dupes, v_rows
      FROM (
        SELECT format('enrollment %s, period %L: %s live invoices (ids %s)',
                      enrollment_id, billing_period, count(*), string_agg(id::text, ', ' ORDER BY id)) AS dup
          FROM invoices
         WHERE status <> 'cancelled' AND billing_period IS NOT NULL
         GROUP BY enrollment_id, billing_period
        HAVING count(*) > 1
      ) d;

    IF v_dupes > 0 THEN
        IF coalesce(current_setting('sms.allow_duplicates', true), '') = '1' THEN
            RAISE WARNING 'Found % duplicate invoice group(s); cancelling all but the oldest in each.', v_dupes;

            -- Keep the lowest id (the first bill issued) and cancel the rest. The
            -- cancellation is what an accountant would do, and it is reversible by
            -- hand if the operator disagrees. Paying receipts are untouched.
            WITH ranked AS (
                SELECT id,
                       row_number() OVER (PARTITION BY enrollment_id, billing_period ORDER BY id) AS rn
                  FROM invoices
                 WHERE status <> 'cancelled' AND billing_period IS NOT NULL
            )
            UPDATE invoices i
               SET status = 'cancelled',
                   notes = concat_ws(E'\n', i.notes,
                           '[migration 0001] cancelled duplicate of the earliest invoice for this period')
              FROM ranked r
             WHERE r.id = i.id AND r.rn > 1;
        ELSE
            RAISE EXCEPTION
                E'Cannot enforce one live invoice per period: % duplicate group(s) already exist:%\n    %\n'
                'Nothing was changed. Resolve them first (cancel the duplicate invoices), or re-run with'
                ' -v allow_duplicates=1 to cancel all but the oldest automatically.',
                v_dupes, E'\n', v_rows;
        END IF;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_enrollment_period
    ON invoices (enrollment_id, billing_period)
    WHERE status <> 'cancelled' AND billing_period IS NOT NULL;

COMMENT ON INDEX uq_invoice_enrollment_period IS
    'One live invoice per enrollment per billing period (cancelled invoices are excluded so a period can be re-issued).';
