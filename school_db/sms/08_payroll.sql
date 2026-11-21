-- =====================================================================
-- File 08: Staff payroll
-- =====================================================================

CREATE TABLE salary_components (
    id              INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR(80) NOT NULL UNIQUE,   -- Basic, Grade, Allowance, PF, CIT, SSF, TDS
    component_type  VARCHAR(10) NOT NULL CHECK (component_type IN ('earning','deduction')),
    is_taxable      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Each staff member's salary setup
CREATE TABLE staff_salary_structures (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id             BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    salary_component_id  INT NOT NULL REFERENCES salary_components(id),
    amount               NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    effective_from       DATE NOT NULL,
    effective_to         DATE,
    UNIQUE (staff_id, salary_component_id, effective_from),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE payslips (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id         BIGINT NOT NULL REFERENCES staff(id),
    period_year      SMALLINT NOT NULL,           -- BS year e.g. 2083
    period_month     SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),  -- BS month
    working_days     SMALLINT,
    present_days     SMALLINT,
    gross_earnings   NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_pay          NUMERIC(12,2) GENERATED ALWAYS AS (gross_earnings - total_deductions) STORED,
    status           VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
    paid_on          DATE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (staff_id, period_year, period_month)
);

CREATE TABLE payslip_items (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payslip_id           BIGINT NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
    salary_component_id  INT NOT NULL REFERENCES salary_components(id),
    amount               NUMERIC(12,2) NOT NULL
);
