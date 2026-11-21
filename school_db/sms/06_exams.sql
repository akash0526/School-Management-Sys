-- =====================================================================
-- File 06: Exams, flexible assessment components, marks, grading, results
-- =====================================================================

-- Grading scales stored as data (NEB rules change -> update rows, not code)
CREATE TABLE grading_scales (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(80) NOT NULL UNIQUE,      -- 'NEB Letter Grading', 'Basic Level CAS'
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT
);
CREATE UNIQUE INDEX uq_one_default_scale ON grading_scales (is_default) WHERE is_default;

CREATE TABLE grading_scale_items (
    id                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    grading_scale_id  INT NOT NULL REFERENCES grading_scales(id) ON DELETE CASCADE,
    min_percent       NUMERIC(5,2) NOT NULL,      -- inclusive
    max_percent       NUMERIC(5,2) NOT NULL,      -- exclusive; top band uses 100.01 so 100% is included
    grade             VARCHAR(5)  NOT NULL,       -- A+, A, B+ ... NG
    grade_point       NUMERIC(3,2),               -- NULL for NG (Not Graded has no grade point)
    description       VARCHAR(50),                -- Outstanding, Excellent ...
    UNIQUE (grading_scale_id, grade),
    CHECK (max_percent > min_percent),
    CHECK (min_percent >= 0 AND max_percent <= 100.01),
    -- bands inside one scale may not overlap
    EXCLUDE USING gist (grading_scale_id WITH =,
                        numrange(min_percent, max_percent, '[)') WITH &&)
);

CREATE TABLE exams (
    id                  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    academic_year_id    INT NOT NULL REFERENCES academic_years(id),
    term_id             INT REFERENCES terms(id),
    name                VARCHAR(100) NOT NULL,    -- 'First Terminal Exam 2083'
    exam_type           VARCHAR(20) NOT NULL CHECK (exam_type IN ('unit','terminal','final','pre_board','entrance')),
    grading_scale_id    INT REFERENCES grading_scales(id),
    weightage_in_final  NUMERIC(5,2),             -- % contribution to final result (optional)
    start_date          DATE,
    end_date            DATE,
    is_published        BOOLEAN NOT NULL DEFAULT FALSE,   -- results visible to portal / website
    published_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (academic_year_id, name),
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- One paper of one subject for one class in an exam
CREATE TABLE exam_schedules (
    id                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    exam_id           INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    class_subject_id  INT NOT NULL REFERENCES class_subjects(id),
    exam_date         DATE,
    start_time        TIME,
    end_time          TIME,
    room_id           INT REFERENCES rooms(id) ON DELETE SET NULL,
    UNIQUE (exam_id, class_subject_id),
    CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);

-- Theory / Practical / Internal / Project ... (no hard-coded mark columns)
CREATE TABLE assessment_components (
    id                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    exam_schedule_id  INT NOT NULL REFERENCES exam_schedules(id) ON DELETE CASCADE,
    name              VARCHAR(30) NOT NULL,
    component_type    VARCHAR(20) NOT NULL
                      CHECK (component_type IN ('theory','practical','internal','project','oral','cas')),
    full_marks        NUMERIC(6,2) NOT NULL CHECK (full_marks > 0),
    pass_marks        NUMERIC(6,2) NOT NULL DEFAULT 0,  -- NEB: 35% of theory, else NG
    credit_hours      NUMERIC(4,2),                     -- NEB grades TH and IN separately, each with own credit hours
    sequence          SMALLINT NOT NULL DEFAULT 0,
    UNIQUE (exam_schedule_id, name),
    CHECK (pass_marks <= full_marks)
);

CREATE TABLE marks (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    component_id    INT    NOT NULL REFERENCES assessment_components(id) ON DELETE CASCADE,
    enrollment_id   BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    marks_obtained  NUMERIC(6,2) CHECK (marks_obtained >= 0),
    is_absent       BOOLEAN NOT NULL DEFAULT FALSE,
    remarks         VARCHAR(255),
    entered_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    verified_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (component_id, enrollment_id),
    CHECK (is_absent = (marks_obtained IS NULL))  -- absent ⇔ no marks
);
CREATE INDEX idx_marks_enrollment ON marks (enrollment_id);

-- Validate marks:
--   1. not above full marks
--   2. enrollment is in the same academic year and class as the exam paper
--   3. for optional subjects, the student must have chosen that subject
CREATE OR REPLACE FUNCTION validate_marks()
RETURNS trigger AS $$
DECLARE
    v_full      NUMERIC(6,2);
    v_cs_id     INT;
    v_cs_year   INT;
    v_cs_class  INT;
    v_cs_stream INT;
    v_optional  BOOLEAN;
    v_e_year    INT;
    v_e_class   INT;
    v_e_stream  INT;
BEGIN
    SELECT ac.full_marks, cs.id, cs.academic_year_id, cs.class_id, cs.stream_id, cs.is_optional
      INTO v_full, v_cs_id, v_cs_year, v_cs_class, v_cs_stream, v_optional
      FROM assessment_components ac
      JOIN exam_schedules es ON es.id = ac.exam_schedule_id
      JOIN class_subjects cs ON cs.id = es.class_subject_id
     WHERE ac.id = NEW.component_id;

    IF NEW.marks_obtained IS NOT NULL AND NEW.marks_obtained > v_full THEN
        RAISE EXCEPTION 'Marks % exceed full marks % (component %)', NEW.marks_obtained, v_full, NEW.component_id;
    END IF;

    SELECT e.academic_year_id, s.class_id, s.stream_id
      INTO v_e_year, v_e_class, v_e_stream
      FROM enrollments e JOIN sections s ON s.id = e.section_id
     WHERE e.id = NEW.enrollment_id;

    IF v_e_year <> v_cs_year OR v_e_class <> v_cs_class
       OR (v_cs_stream IS NOT NULL AND v_cs_stream IS DISTINCT FROM v_e_stream) THEN
        RAISE EXCEPTION 'Enrollment % is not in the class/stream/year of this exam paper', NEW.enrollment_id;
    END IF;

    IF v_optional AND NOT EXISTS (
        SELECT 1 FROM student_subjects
         WHERE enrollment_id = NEW.enrollment_id AND class_subject_id = v_cs_id) THEN
        RAISE EXCEPTION 'Enrollment % has not chosen optional subject (class_subject %)', NEW.enrollment_id, v_cs_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_marks
BEFORE INSERT OR UPDATE ON marks
FOR EACH ROW EXECUTE FUNCTION validate_marks();

-- ---------------------------------------------------------------------
-- Calculated results (cache tables, filled by the application when
-- results are processed — keeps report cards & ranking fast)
-- ---------------------------------------------------------------------
-- Grade per component (NEB grade sheet shows TH and IN grades separately)
CREATE TABLE exam_component_results (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    exam_id          INT    NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    enrollment_id    BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    component_id     INT    NOT NULL REFERENCES assessment_components(id) ON DELETE CASCADE,
    percentage       NUMERIC(5,2),
    grade            VARCHAR(5),
    grade_point      NUMERIC(3,2),               -- NULL when NG / absent
    credit_hours     NUMERIC(4,2),
    UNIQUE (exam_id, enrollment_id, component_id)
);

CREATE TABLE exam_subject_results (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    exam_id           INT    NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    enrollment_id     BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    class_subject_id  INT    NOT NULL REFERENCES class_subjects(id),
    total_obtained    NUMERIC(6,2),
    total_full        NUMERIC(6,2),
    percentage        NUMERIC(5,2),
    grade             VARCHAR(5),
    grade_point       NUMERIC(3,2),               -- credit-weighted average of component grade points
    is_graded         BOOLEAN,                    -- FALSE = NG in this subject
    UNIQUE (exam_id, enrollment_id, class_subject_id)
);

CREATE TABLE exam_results (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    exam_id          INT    NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    enrollment_id    BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    total_obtained   NUMERIC(7,2),
    total_full       NUMERIC(7,2),
    percentage       NUMERIC(5,2),
    gpa              NUMERIC(3,2),               -- NULL if any subject is NG
    final_grade      VARCHAR(5),
    rank_in_section  SMALLINT,
    rank_in_class    SMALLINT,
    attendance_days  SMALLINT,
    working_days     SMALLINT,
    result_status    VARCHAR(12) NOT NULL
                     CHECK (result_status IN ('graded','not_graded','absent','withheld')),  -- NEB has no 'fail', only NG
    teacher_remarks  TEXT,
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exam_id, enrollment_id)
);
CREATE INDEX idx_exam_results_exam ON exam_results (exam_id);
