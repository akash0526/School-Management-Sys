-- =====================================================================
-- File 07: Fees, invoices, receipts, online payments, student ledger,
--          expenses
-- Money columns: NUMERIC(12,2) — never use FLOAT for money.
-- =====================================================================

-- Race-free document numbers (two cashiers can never get the same number)
CREATE SEQUENCE invoice_no_seq START 1;
CREATE SEQUENCE receipt_no_seq START 1;

CREATE TABLE fee_types (
    id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           VARCHAR(20) NOT NULL UNIQUE,   -- TUITION, ADMISSION, EXAM, TRANSPORT, LAB ...
    name           VARCHAR(100) NOT NULL,
    is_refundable  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- How much each class pays for each fee type in a year
CREATE TABLE fee_structures (
    id                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    academic_year_id  INT NOT NULL REFERENCES academic_years(id),
    class_id          INT NOT NULL REFERENCES classes(id),
    stream_id         INT REFERENCES streams(id),
    fee_type_id       INT NOT NULL REFERENCES fee_types(id),
    amount            NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    frequency         VARCHAR(10) NOT NULL CHECK (frequency IN ('one_time','monthly','termly','yearly')),
    due_day           SMALLINT CHECK (due_day BETWEEN 1 AND 32),  -- day of (BS) month
    UNIQUE NULLS NOT DISTINCT (academic_year_id, class_id, stream_id, fee_type_id)
);

-- Scholarships, sibling discounts, staff-child discounts ...
CREATE TABLE student_discounts (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id   BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    fee_type_id     INT REFERENCES fee_types(id),           -- NULL = applies to all fee types
    discount_type   VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent','fixed')),
    value           NUMERIC(12,2) NOT NULL CHECK (value >= 0),
    reason          VARCHAR(50) NOT NULL,                   -- scholarship, sibling, staff_child, merit, need_based
    valid_from      DATE,
    valid_to        DATE,
    approved_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (discount_type <> 'percent' OR value <= 100),
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

-- Late-payment fine rules
CREATE TABLE fine_rules (
    id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fee_type_id  INT REFERENCES fee_types(id),              -- NULL = all
    grace_days   SMALLINT NOT NULL DEFAULT 0,
    fine_type    VARCHAR(10) NOT NULL CHECK (fine_type IN ('fixed','per_day','percent')),
    fine_value   NUMERIC(12,2) NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- Invoices (bills)
-- ---------------------------------------------------------------------
CREATE TABLE invoices (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_no      VARCHAR(30) NOT NULL UNIQUE,
    enrollment_id   BIGINT NOT NULL REFERENCES enrollments(id),
    billing_period  VARCHAR(30),                  -- '2083-Baisakh', 'First Term'
    issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date        DATE,
    -- subtotal / discount_total are maintained from invoice_items by trigger
    -- paid_amount is maintained from payment_allocations by trigger
    -- status (unpaid/partial/paid) is set automatically unless draft/cancelled
    subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
    fine_total      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fine_total >= 0),
    total_amount    NUMERIC(12,2) GENERATED ALWAYS AS (subtotal - discount_total + fine_total) STORED,
    paid_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    status          VARCHAR(10) NOT NULL DEFAULT 'unpaid'
                    CHECK (status IN ('draft','unpaid','partial','paid','cancelled')),
    notes           TEXT,
    created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (paid_amount >= 0 AND paid_amount <= subtotal - discount_total + fine_total)
);
CREATE INDEX idx_invoices_enrollment ON invoices (enrollment_id);
CREATE INDEX idx_invoices_status     ON invoices (status);

CREATE TABLE invoice_items (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id   BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    fee_type_id  INT NOT NULL REFERENCES fee_types(id),
    description  VARCHAR(150),
    amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    discount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
    net_amount   NUMERIC(12,2) GENERATED ALWAYS AS (amount - discount) STORED,
    CHECK (discount <= amount)
);

-- ---------------------------------------------------------------------
-- Receipts (money received) — one receipt can pay several invoices
-- ---------------------------------------------------------------------
CREATE TABLE receipts (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receipt_no       VARCHAR(30) NOT NULL UNIQUE,
    student_id       BIGINT NOT NULL REFERENCES students(id),
    amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    method           VARCHAR(15) NOT NULL
                     CHECK (method IN ('cash','bank_deposit','cheque','esewa','khalti','fonepay','connectips','other')),
    reference_no     VARCHAR(100),                -- cheque no / gateway txn id / bank voucher
    received_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    -- Cancelling a receipt automatically removes its amount from invoices (trigger).
    -- The app must ALSO post a reversing 'adjustment' entry in student_ledger.
    status           VARCHAR(10) NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','cancelled')),
    cancel_reason    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_receipts_student ON receipts (student_id);
CREATE INDEX idx_receipts_date    ON receipts (payment_date);

CREATE TABLE payment_allocations (
    receipt_id  BIGINT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    invoice_id  BIGINT NOT NULL REFERENCES invoices(id),
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    PRIMARY KEY (receipt_id, invoice_id)
);

-- Online payment attempts (eSewa / Khalti / Fonepay / ConnectIPS)
CREATE TABLE online_payments (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id       BIGINT NOT NULL REFERENCES students(id),
    invoice_id       BIGINT REFERENCES invoices(id),
    gateway          VARCHAR(15) NOT NULL CHECK (gateway IN ('esewa','khalti','fonepay','connectips')),
    gateway_txn_id   VARCHAR(100) UNIQUE,
    amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    status           VARCHAR(10) NOT NULL DEFAULT 'initiated'
                     CHECK (status IN ('initiated','success','failed','refunded')),
    raw_response     JSONB,                       -- full gateway response for disputes
    receipt_id       BIGINT REFERENCES receipts(id),   -- set after successful verification
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Fee integrity triggers
-- ---------------------------------------------------------------------

-- Invoice status follows the amounts (draft / cancelled are manual states)
CREATE OR REPLACE FUNCTION set_invoice_status()
RETURNS trigger AS $$
DECLARE
    v_total NUMERIC(12,2) := NEW.subtotal - NEW.discount_total + NEW.fine_total;
BEGIN
    IF NEW.status NOT IN ('draft','cancelled') THEN
        NEW.status := CASE
            WHEN NEW.paid_amount >= v_total THEN 'paid'      -- includes fully-discounted (total 0)
            WHEN NEW.paid_amount = 0        THEN 'unpaid'
            ELSE 'partial'
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_invoice_status
BEFORE INSERT OR UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION set_invoice_status();

-- Keep invoice subtotal / discount in sync with its items
CREATE OR REPLACE FUNCTION refresh_invoice_totals()
RETURNS trigger AS $$
DECLARE
    v_ids BIGINT[];
BEGIN
    IF TG_OP = 'INSERT' THEN v_ids := ARRAY[NEW.invoice_id];
    ELSIF TG_OP = 'DELETE' THEN v_ids := ARRAY[OLD.invoice_id];
    ELSE v_ids := ARRAY[NEW.invoice_id, OLD.invoice_id];
    END IF;

    UPDATE invoices i
       SET subtotal       = COALESCE((SELECT SUM(amount)   FROM invoice_items WHERE invoice_id = i.id), 0),
           discount_total = COALESCE((SELECT SUM(discount) FROM invoice_items WHERE invoice_id = i.id), 0)
     WHERE i.id = ANY (v_ids);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refresh_invoice_totals
AFTER INSERT OR UPDATE OR DELETE ON invoice_items
FOR EACH ROW EXECUTE FUNCTION refresh_invoice_totals();

-- Recalculate how much of an invoice is paid (only VALID receipts count)
CREATE OR REPLACE FUNCTION refresh_invoice_paid(p_invoice_id BIGINT)
RETURNS void AS $$
    UPDATE invoices
       SET paid_amount = COALESCE((
             SELECT SUM(a.amount)
               FROM payment_allocations a
               JOIN receipts r ON r.id = a.receipt_id
              WHERE a.invoice_id = p_invoice_id AND r.status = 'valid'), 0)
     WHERE id = p_invoice_id;
$$ LANGUAGE sql;

-- Validate an allocation: valid receipt, same student, open invoice, no over-allocation
CREATE OR REPLACE FUNCTION validate_payment_allocation()
RETURNS trigger AS $$
DECLARE
    v_receipt      receipts%ROWTYPE;
    v_inv_student  BIGINT;
    v_inv_status   VARCHAR(10);
    v_old_invoice  BIGINT;
    v_allocated    NUMERIC(12,2);
BEGIN
    IF TG_OP = 'UPDATE' THEN v_old_invoice := OLD.invoice_id; END IF;

    SELECT * INTO v_receipt FROM receipts WHERE id = NEW.receipt_id;
    IF v_receipt.status <> 'valid' THEN
        RAISE EXCEPTION 'Receipt % is cancelled', v_receipt.receipt_no;
    END IF;

    SELECT e.student_id, i.status INTO v_inv_student, v_inv_status
      FROM invoices i JOIN enrollments e ON e.id = i.enrollment_id
     WHERE i.id = NEW.invoice_id;

    IF v_inv_student <> v_receipt.student_id THEN
        RAISE EXCEPTION 'Receipt % belongs to a different student than invoice %', v_receipt.receipt_no, NEW.invoice_id;
    END IF;
    IF v_inv_status IN ('draft','cancelled') THEN
        RAISE EXCEPTION 'Cannot pay a % invoice', v_inv_status;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_allocated
      FROM payment_allocations
     WHERE receipt_id = NEW.receipt_id
       AND invoice_id IS DISTINCT FROM v_old_invoice
       AND invoice_id <> NEW.invoice_id;

    IF v_allocated + NEW.amount > v_receipt.amount THEN
        RAISE EXCEPTION 'Receipt % over-allocated: % + % > %',
            v_receipt.receipt_no, v_allocated, NEW.amount, v_receipt.amount;
    END IF;

    -- invoice must not be overpaid (only valid receipts count)
    SELECT COALESCE(SUM(a.amount), 0) INTO v_allocated
      FROM payment_allocations a JOIN receipts r ON r.id = a.receipt_id AND r.status = 'valid'
     WHERE a.invoice_id = NEW.invoice_id
       AND NOT (a.receipt_id = NEW.receipt_id AND a.invoice_id IS NOT DISTINCT FROM v_old_invoice);
    IF v_allocated + NEW.amount > (SELECT total_amount FROM invoices WHERE id = NEW.invoice_id) THEN
        RAISE EXCEPTION 'Invoice % would be overpaid: already paid %, adding %, total %',
            NEW.invoice_id, v_allocated, NEW.amount, (SELECT total_amount FROM invoices WHERE id = NEW.invoice_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_payment_allocation
BEFORE INSERT OR UPDATE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION validate_payment_allocation();

CREATE OR REPLACE FUNCTION sync_invoice_paid()
RETURNS trigger AS $$
BEGIN
    IF TG_OP IN ('INSERT','UPDATE') THEN PERFORM refresh_invoice_paid(NEW.invoice_id); END IF;
    IF TG_OP IN ('DELETE','UPDATE') THEN PERFORM refresh_invoice_paid(OLD.invoice_id); END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_invoice_paid
AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION sync_invoice_paid();

-- Cancelling (or restoring) a receipt updates every invoice it paid
CREATE OR REPLACE FUNCTION receipt_status_changed()
RETURNS trigger AS $$
BEGIN
    PERFORM refresh_invoice_paid(a.invoice_id)
       FROM payment_allocations a WHERE a.receipt_id = NEW.id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_receipt_status_changed
AFTER UPDATE OF status ON receipts
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION receipt_status_changed();

-- ---------------------------------------------------------------------
-- Student ledger — every charge, payment, discount, fine, refund.
-- Balance = SUM(debit) - SUM(credit). Handles advance & carried-forward dues.
-- ---------------------------------------------------------------------
CREATE TABLE student_ledger (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id     BIGINT NOT NULL REFERENCES students(id),
    enrollment_id  BIGINT REFERENCES enrollments(id),
    entry_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    entry_type     VARCHAR(20) NOT NULL
                   CHECK (entry_type IN ('opening_balance','charge','payment','discount','fine','refund','adjustment')),
    invoice_id     BIGINT REFERENCES invoices(id),
    receipt_id     BIGINT REFERENCES receipts(id),
    debit          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),   -- amount student owes
    credit         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),   -- amount paid / reduced
    remarks        VARCHAR(255),
    created_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((debit > 0) <> (credit > 0))           -- exactly one side has a value
);
CREATE INDEX idx_ledger_student ON student_ledger (student_id, entry_date);

-- ---------------------------------------------------------------------
-- School expenses (outgoing money)
-- ---------------------------------------------------------------------
CREATE TABLE expense_categories (
    id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name  VARCHAR(100) NOT NULL UNIQUE            -- Electricity, Stationery, Maintenance, Fuel ...
);

CREATE TABLE expenses (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id    INT NOT NULL REFERENCES expense_categories(id),
    amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    expense_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    paid_to        VARCHAR(150),
    method         VARCHAR(15) NOT NULL DEFAULT 'cash'
                   CHECK (method IN ('cash','bank_transfer','cheque','esewa','khalti','other')),
    reference_no   VARCHAR(100),
    bill_no        VARCHAR(50),
    description    TEXT,
    attachment_url TEXT,
    approved_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_date ON expenses (expense_date);
