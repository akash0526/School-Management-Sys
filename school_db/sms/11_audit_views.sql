-- =====================================================================
-- File 11: Audit log + views used by the public API
-- =====================================================================

-- ---------------------------------------------------------------------
-- Audit log: who changed what (attached to sensitive tables below)
-- The API should run:  SET LOCAL app.user_id = '<id>';  inside each
-- transaction so the trigger knows which user made the change.
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT,
    action      VARCHAR(10) NOT NULL,             -- INSERT / UPDATE / DELETE
    table_name  VARCHAR(63) NOT NULL,
    record_id   TEXT,
    old_data    JSONB,
    new_data    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_table_record ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_created      ON audit_logs (created_at);

CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS trigger AS $$
DECLARE
    v_user BIGINT := NULLIF(current_setting('app.user_id', TRUE), '')::BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data)
        VALUES (v_user, TG_OP, TG_TABLE_NAME, OLD.id::TEXT, to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
        VALUES (v_user, TG_OP, TG_TABLE_NAME, NEW.id::TEXT, to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSE
        INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
        VALUES (v_user, TG_OP, TG_TABLE_NAME, NEW.id::TEXT, to_jsonb(NEW));
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_students        AFTER INSERT OR UPDATE OR DELETE ON students        FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER trg_audit_marks           AFTER INSERT OR UPDATE OR DELETE ON marks           FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER trg_audit_invoices        AFTER INSERT OR UPDATE OR DELETE ON invoices        FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER trg_audit_receipts        AFTER INSERT OR UPDATE OR DELETE ON receipts        FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER trg_audit_student_ledger  AFTER INSERT OR UPDATE OR DELETE ON student_ledger  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER trg_audit_payslips        AFTER INSERT OR UPDATE OR DELETE ON payslips        FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- ---------------------------------------------------------------------
-- Helpful internal views
-- ---------------------------------------------------------------------

-- Current fee balance of every student (positive = due, negative = advance)
CREATE VIEW v_student_balances AS
SELECT s.id AS student_id,
       s.admission_no,
       s.first_name || ' ' || s.last_name AS student_name,
       COALESCE(SUM(l.debit), 0)  AS total_charged,
       COALESCE(SUM(l.credit), 0) AS total_paid,
       COALESCE(SUM(l.debit - l.credit), 0) AS balance
FROM students s
LEFT JOIN student_ledger l ON l.student_id = s.id
WHERE s.deleted_at IS NULL
GROUP BY s.id;

-- Current-year class list
CREATE VIEW v_current_enrollments AS
SELECT e.id AS enrollment_id, s.id AS student_id, s.admission_no,
       s.first_name, s.last_name, c.name AS class_name, sec.name AS section_name,
       st.name AS stream_name, e.roll_no, e.status
FROM enrollments e
JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.is_current
JOIN students s        ON s.id = e.student_id
JOIN sections sec      ON sec.id = e.section_id
JOIN classes c         ON c.id = sec.class_id
LEFT JOIN streams st   ON st.id = sec.stream_id;

-- ---------------------------------------------------------------------
-- PUBLIC views — the ONLY data the website API endpoints should read.
-- They expose no phone numbers, addresses, salaries or fee data.
-- ---------------------------------------------------------------------
CREATE VIEW public_notices AS
SELECT id, title, body, attachment_url, publish_at, expires_at, updated_at
FROM notices
WHERE is_public AND deleted_at IS NULL
  AND publish_at <= now()
  AND (expires_at IS NULL OR expires_at > now());

CREATE VIEW public_events AS
SELECT id, title, description, location, start_at, end_at, cover_image_url, updated_at
FROM events
WHERE is_public;

CREATE VIEW public_staff AS
SELECT st.id,
       concat_ws(' ', st.first_name, st.middle_name, st.last_name) AS full_name,
       st.designation, d.name AS department, st.qualification,
       st.photo_url, st.public_bio, st.website_order, st.updated_at
FROM staff st
LEFT JOIN departments d ON d.id = st.department_id
WHERE st.show_on_website AND st.status = 'active' AND st.deleted_at IS NULL;

-- Result lookup: website sends symbol_no/admission_no + dob, API queries this view.
-- dob is here ONLY for the WHERE clause — the API must not return it.
-- Withheld results (e.g. unpaid fees) show status only, no grades.
CREATE VIEW public_results AS
SELECT ex.id AS exam_id, ex.name AS exam_name, ay.name AS academic_year,
       s.admission_no, e.symbol_no, s.dob,
       concat_ws(' ', s.first_name, s.middle_name, s.last_name) AS student_name,
       c.name AS class_name, sec.name AS section_name,
       CASE WHEN r.result_status = 'withheld' THEN NULL ELSE r.gpa END         AS gpa,
       CASE WHEN r.result_status = 'withheld' THEN NULL ELSE r.final_grade END AS final_grade,
       r.result_status
FROM exam_results r
JOIN exams ex          ON ex.id = r.exam_id AND ex.is_published
JOIN academic_years ay ON ay.id = ex.academic_year_id
JOIN enrollments e     ON e.id = r.enrollment_id
JOIN students s        ON s.id = e.student_id
JOIN sections sec      ON sec.id = e.section_id
JOIN classes c         ON c.id = sec.class_id
WHERE s.deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- Optional: restricted DB role for the API code that serves the website.
-- Uncomment and run as superuser. (Tested: can read only public_* views
-- and insert inquiries; cannot read students, marks, fees or staff tables.)
-- ---------------------------------------------------------------------
-- CREATE ROLE website_api LOGIN PASSWORD 'change-me';
-- GRANT CONNECT ON DATABASE school_sms TO website_api;
-- GRANT USAGE ON SCHEMA public TO website_api;
-- GRANT SELECT ON public_notices, public_events, public_staff, public_results TO website_api;
-- GRANT INSERT (source, external_ref, student_name, dob, gender, applying_class_id, stream_id,
--               guardian_name, phone, email, message) ON admission_inquiries TO website_api;
-- GRANT SELECT (id, external_ref) ON admission_inquiries TO website_api;   -- for RETURNING id / duplicate check
-- GRANT SELECT (id, name) ON classes, streams TO website_api;              -- map 'Grade 5' -> class id
