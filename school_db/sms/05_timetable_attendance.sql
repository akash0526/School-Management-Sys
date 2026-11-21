-- =====================================================================
-- File 05: Timetable, attendance, leave
-- =====================================================================

CREATE TABLE periods (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(30) NOT NULL,             -- '1st Period', 'Tiffin'
    sequence    SMALLINT NOT NULL UNIQUE,
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    is_break    BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (end_time > start_time)
);

CREATE TABLE timetable_entries (
    id                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    academic_year_id  INT NOT NULL REFERENCES academic_years(id),
    section_id        INT NOT NULL,
    day_of_week       SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0 = Sunday
    period_id         INT NOT NULL REFERENCES periods(id),
    class_subject_id  INT NOT NULL REFERENCES class_subjects(id),
    staff_id          BIGINT REFERENCES staff(id) ON DELETE SET NULL,
    room_id           INT REFERENCES rooms(id) ON DELETE SET NULL,
    FOREIGN KEY (section_id, academic_year_id) REFERENCES sections (id, academic_year_id) ON DELETE CASCADE,
    -- Same subject can't be scheduled twice in one slot. Different subjects in the same
    -- slot are allowed ON PURPOSE: optional groups (Opt. Maths | Computer) run in parallel.
    -- The app should only allow parallel rows when both subjects share an optional_group.
    UNIQUE (section_id, day_of_week, period_id, class_subject_id),
    UNIQUE (academic_year_id, staff_id, day_of_week, period_id),    -- a teacher can't be in 2 places
    UNIQUE (academic_year_id, room_id, day_of_week, period_id)      -- a room can't be double booked
);

-- ---------------------------------------------------------------------
-- Student attendance (daily; set period_id for period-wise attendance)
-- ---------------------------------------------------------------------
CREATE TABLE student_attendance (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id    BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    attendance_date  DATE NOT NULL,
    period_id        INT REFERENCES periods(id),                     -- NULL = whole-day attendance
    status           VARCHAR(10) NOT NULL CHECK (status IN ('present','absent','late','leave','half_day')),
    remarks          VARCHAR(255),
    marked_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (enrollment_id, attendance_date, period_id)
);
CREATE INDEX idx_student_attendance_date ON student_attendance (attendance_date);

CREATE TABLE staff_attendance (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id         BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    attendance_date  DATE NOT NULL,
    check_in         TIME,
    check_out        TIME,
    status           VARCHAR(10) NOT NULL CHECK (status IN ('present','absent','late','leave','half_day')),
    source           VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','biometric','app')),
    remarks          VARCHAR(255),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (staff_id, attendance_date),
    CHECK (check_out IS NULL OR check_in IS NULL OR check_out > check_in)
);

-- ---------------------------------------------------------------------
-- Leave management (students and staff)
-- ---------------------------------------------------------------------
CREATE TABLE leave_types (
    id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           VARCHAR(50) NOT NULL,          -- Sick, Casual, Maternity, Home leave
    applies_to     VARCHAR(10) NOT NULL CHECK (applies_to IN ('staff','student','both')),
    days_per_year  SMALLINT,
    is_paid        BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (name, applies_to)
);

CREATE TABLE leave_requests (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id     BIGINT REFERENCES students(id) ON DELETE CASCADE,
    staff_id       BIGINT REFERENCES staff(id)    ON DELETE CASCADE,
    leave_type_id  INT NOT NULL REFERENCES leave_types(id),
    from_date      DATE NOT NULL,
    to_date        DATE NOT NULL,
    reason         TEXT,
    status         VARCHAR(10) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','cancelled')),
    requested_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,   -- parent / staff user
    approved_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (to_date >= from_date),
    CHECK (num_nonnulls(student_id, staff_id) = 1)                   -- exactly one applicant
);
