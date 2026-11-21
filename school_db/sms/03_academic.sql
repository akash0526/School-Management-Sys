-- =====================================================================
-- File 03: Academic structure — years, terms, calendar, classes,
--          streams, sections, subjects, curriculum, teacher assignments
-- =====================================================================

CREATE TABLE academic_years (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(20) NOT NULL UNIQUE,      -- e.g. '2083' or '2083/84'
    start_date  DATE NOT NULL,                    -- AD dates
    end_date    DATE NOT NULL,
    is_current  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date > start_date),
    -- academic years may not overlap
    EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
);
-- Only one current academic year
CREATE UNIQUE INDEX uq_one_current_year ON academic_years (is_current) WHERE is_current;

CREATE TABLE terms (
    id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    academic_year_id INT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    name             VARCHAR(50) NOT NULL,        -- First Term, Second Term, Final
    sequence         SMALLINT NOT NULL,
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    UNIQUE (academic_year_id, name),
    UNIQUE (academic_year_id, sequence),
    CHECK (end_date >= start_date)
);

-- Holidays & school calendar (needed for attendance % and public events)
CREATE TABLE school_calendar (
    id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    academic_year_id INT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    title            VARCHAR(150) NOT NULL,       -- Dashain Vacation, Saraswati Puja ...
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    day_type         VARCHAR(20) NOT NULL CHECK (day_type IN ('holiday','vacation','exam','event','half_day')),
    is_holiday       BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (end_date >= start_date)
);
CREATE INDEX idx_calendar_dates ON school_calendar (start_date, end_date);

-- Grade levels: Nursery, LKG, UKG, Grade 1 ... Grade 12
CREATE TABLE classes (
    id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           VARCHAR(30) NOT NULL UNIQUE,
    numeric_level  SMALLINT NOT NULL UNIQUE,      -- -2 Nursery, -1 LKG, 0 UKG, 1..12
    level_group    VARCHAR(20) NOT NULL
                   CHECK (level_group IN ('pre_primary','basic','secondary'))  -- basic 1-8, secondary 9-12
);

-- Streams / faculties for Grade 11-12
CREATE TABLE streams (
    id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name  VARCHAR(50) NOT NULL UNIQUE             -- Science, Management, Humanities, Law, Education
);

CREATE TABLE rooms (
    id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       VARCHAR(50) NOT NULL UNIQUE,
    building   VARCHAR(50),
    capacity   SMALLINT,
    room_type  VARCHAR(20) NOT NULL DEFAULT 'classroom'
               CHECK (room_type IN ('classroom','lab','library','hall','office','other'))
);

-- A section exists for ONE academic year (Grade 5 'A' in 2083 ≠ Grade 5 'A' in 2084)
CREATE TABLE sections (
    id                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    academic_year_id  INT NOT NULL REFERENCES academic_years(id),
    class_id          INT NOT NULL REFERENCES classes(id),
    stream_id         INT REFERENCES streams(id),   -- only for Grade 11-12
    name              VARCHAR(20) NOT NULL,         -- 'A', 'B', 'Science A'
    class_teacher_id  BIGINT REFERENCES staff(id) ON DELETE SET NULL,
    room_id           INT REFERENCES rooms(id) ON DELETE SET NULL,
    capacity          SMALLINT,
    UNIQUE (academic_year_id, class_id, name),
    UNIQUE (id, academic_year_id)                   -- lets enrollments enforce same-year section
);
CREATE INDEX idx_sections_class ON sections (class_id);

CREATE TABLE subjects (
    id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           VARCHAR(20) NOT NULL UNIQUE,     -- NEB/CDC subject code
    name           VARCHAR(100) NOT NULL,
    name_np        VARCHAR(100),
    has_practical  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Curriculum: which subjects are taught in which class (and stream) in a year
-- stream_id NULL = subject is common to ALL streams of that class (e.g. Compulsory English)
-- A Science student's subjects = rows WHERE stream_id IS NULL OR stream_id = <Science>
CREATE TABLE class_subjects (
    id                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    academic_year_id  INT NOT NULL REFERENCES academic_years(id),
    class_id          INT NOT NULL REFERENCES classes(id),
    stream_id         INT REFERENCES streams(id),
    subject_id        INT NOT NULL REFERENCES subjects(id),
    credit_hours      NUMERIC(4,2),                 -- used in GPA calculation
    is_optional       BOOLEAN NOT NULL DEFAULT FALSE,
    optional_group    VARCHAR(30),                  -- e.g. 'Optional I' — student picks one per group
    sequence          SMALLINT NOT NULL DEFAULT 0,  -- order on report card
    UNIQUE NULLS NOT DISTINCT (academic_year_id, class_id, stream_id, subject_id)
);

-- Which teacher teaches which subject to which section
CREATE TABLE teacher_assignments (
    id                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    academic_year_id  INT NOT NULL REFERENCES academic_years(id),
    section_id        INT NOT NULL,
    class_subject_id  INT NOT NULL REFERENCES class_subjects(id) ON DELETE CASCADE,
    staff_id          BIGINT NOT NULL REFERENCES staff(id),
    FOREIGN KEY (section_id, academic_year_id) REFERENCES sections (id, academic_year_id) ON DELETE CASCADE,
    UNIQUE (section_id, class_subject_id, staff_id)
);
CREATE INDEX idx_teacher_assign_staff ON teacher_assignments (staff_id, academic_year_id);
