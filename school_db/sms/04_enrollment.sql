-- =====================================================================
-- File 04: Enrollment — THE central table linking a student to a
--          section for one academic year. Attendance, marks, fees all
--          reference enrollment_id.
-- =====================================================================

CREATE TABLE enrollments (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id        BIGINT NOT NULL REFERENCES students(id),
    academic_year_id  INT    NOT NULL REFERENCES academic_years(id),
    section_id        INT    NOT NULL,
    roll_no           SMALLINT,
    symbol_no         VARCHAR(30),                -- board exam symbol number (SEE / NEB)
    registration_no   VARCHAR(30),                -- NEB registration number
    enrolled_on       DATE NOT NULL DEFAULT CURRENT_DATE,
    status            VARCHAR(20) NOT NULL DEFAULT 'studying'
                      CHECK (status IN ('studying','promoted','repeated','transferred','left','graduated')),
    remarks           TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- the section must belong to the same academic year
    FOREIGN KEY (section_id, academic_year_id) REFERENCES sections (id, academic_year_id),
    UNIQUE (student_id, academic_year_id),        -- one section per student per year
    UNIQUE (section_id, roll_no),                 -- roll numbers unique inside a section
    UNIQUE (academic_year_id, symbol_no)          -- board symbol numbers never repeat in a year
);
CREATE INDEX idx_enrollments_section ON enrollments (section_id);
CREATE INDEX idx_enrollments_year    ON enrollments (academic_year_id);

-- Optional / elective subjects chosen by each student
CREATE TABLE student_subjects (
    enrollment_id     BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    class_subject_id  INT    NOT NULL REFERENCES class_subjects(id) ON DELETE CASCADE,
    PRIMARY KEY (enrollment_id, class_subject_id)
);

-- The chosen subject must belong to the student's own class, stream and year
CREATE OR REPLACE FUNCTION validate_student_subject()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM enrollments e
        JOIN sections s        ON s.id = e.section_id
        JOIN class_subjects cs ON cs.id = NEW.class_subject_id
        WHERE e.id = NEW.enrollment_id
          AND cs.academic_year_id = e.academic_year_id
          AND cs.class_id = s.class_id
          AND (cs.stream_id IS NULL OR cs.stream_id IS NOT DISTINCT FROM s.stream_id)
          -- only OPTIONAL subjects are "chosen"; a compulsory subject belongs to every
          -- student of the class already, so storing it here is a data error
          AND cs.is_optional
    ) THEN
        RAISE EXCEPTION 'Subject % is not a chosen optional subject of enrollment % (wrong class/stream/year, or it is compulsory)',
            NEW.class_subject_id, NEW.enrollment_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_student_subject
BEFORE INSERT OR UPDATE ON student_subjects
FOR EACH ROW EXECUTE FUNCTION validate_student_subject();

-- History of status changes (active -> transferred -> ...)
CREATE TABLE student_status_history (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id  BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    old_status  VARCHAR(20),
    new_status  VARCHAR(20) NOT NULL,
    changed_on  DATE NOT NULL DEFAULT CURRENT_DATE,
    reason      TEXT,
    changed_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_status_history_student ON student_status_history (student_id);

-- Transfer / character certificates issued when a student leaves
CREATE TABLE transfer_certificates (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id      BIGINT NOT NULL REFERENCES students(id),
    certificate_no  VARCHAR(30) NOT NULL UNIQUE,
    certificate_type VARCHAR(20) NOT NULL DEFAULT 'transfer'
                    CHECK (certificate_type IN ('transfer','character','migration')),
    last_class_id   INT REFERENCES classes(id),
    issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    leaving_reason  TEXT,
    conduct         VARCHAR(50),
    issued_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
