-- =====================================================================
-- File 02: People — students, guardians, staff, departments, documents
-- =====================================================================

CREATE TABLE departments (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,     -- Science, Mathematics, Administration, Accounts ...
    head_staff_id BIGINT,                         -- FK added after staff table is created
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Students (permanent info only — class/section lives in enrollments)
-- ---------------------------------------------------------------------
CREATE TABLE students (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,  -- portal login (optional)
    admission_no      VARCHAR(30) NOT NULL UNIQUE,
    first_name        VARCHAR(50) NOT NULL,
    middle_name       VARCHAR(50),
    last_name         VARCHAR(50) NOT NULL,
    full_name_np      VARCHAR(150),               -- name in Devanagari
    gender            VARCHAR(10) NOT NULL CHECK (gender IN ('male','female','other')),
    dob               DATE NOT NULL,              -- stored in AD; convert to BS in the app
    blood_group       VARCHAR(5)  CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),

    -- Government (IEMIS) reporting fields
    religion          VARCHAR(50),
    caste_ethnicity   VARCHAR(80),
    mother_tongue     VARCHAR(50),
    nationality       VARCHAR(50) NOT NULL DEFAULT 'Nepali',
    disability_type   VARCHAR(80),                -- NULL = none
    birth_cert_no     VARCHAR(50),

    -- Address (Nepal format)
    province          VARCHAR(50),
    district          VARCHAR(50),
    local_level       VARCHAR(80),                -- municipality / rural municipality
    ward_no           SMALLINT,
    tole              VARCHAR(100),
    temporary_address TEXT,

    phone             VARCHAR(20),
    email             CITEXT,
    photo_url         TEXT,
    previous_school   VARCHAR(150),
    admission_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    status            VARCHAR(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','inactive','transferred','left','graduated','dropped')),
    left_date         DATE,
    custom_fields     JSONB NOT NULL DEFAULT '{}',  -- school-specific extra fields
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    CHECK (ward_no IS NULL OR ward_no > 0),
    CHECK (left_date IS NULL OR left_date >= admission_date)
);
CREATE INDEX idx_students_name   ON students (last_name, first_name);
CREATE INDEX idx_students_status ON students (status);

-- ---------------------------------------------------------------------
-- Guardians (one guardian can have many children in the school)
-- ---------------------------------------------------------------------
CREATE TABLE guardians (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,   -- parent portal login
    full_name       VARCHAR(150) NOT NULL,
    phone           VARCHAR(20) NOT NULL,
    alt_phone       VARCHAR(20),
    email           CITEXT,
    occupation      VARCHAR(100),
    organization    VARCHAR(150),
    citizenship_no  VARCHAR(50),
    address         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_guardians_phone ON guardians (phone);

CREATE TABLE student_guardians (
    student_id   BIGINT NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
    guardian_id  BIGINT NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
    relation     VARCHAR(20) NOT NULL
                 CHECK (relation IN ('father','mother','grandfather','grandmother','brother','sister','uncle','aunt','other')),
    is_primary   BOOLEAN NOT NULL DEFAULT FALSE,   -- receives SMS / fee notices
    can_pickup   BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (student_id, guardian_id)
);
-- Only one primary guardian per student
CREATE UNIQUE INDEX uq_one_primary_guardian ON student_guardians (student_id) WHERE is_primary;
CREATE INDEX idx_student_guardians_guardian ON student_guardians (guardian_id);

-- ---------------------------------------------------------------------
-- Staff (teaching + non-teaching)
-- ---------------------------------------------------------------------
CREATE TABLE staff (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id          BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    employee_no      VARCHAR(30) NOT NULL UNIQUE,
    first_name       VARCHAR(50) NOT NULL,
    middle_name      VARCHAR(50),
    last_name        VARCHAR(50) NOT NULL,
    full_name_np     VARCHAR(150),
    gender           VARCHAR(10) NOT NULL CHECK (gender IN ('male','female','other')),
    dob              DATE,
    phone            VARCHAR(20) NOT NULL,
    email            CITEXT,
    address          TEXT,
    department_id    INT REFERENCES departments(id) ON DELETE SET NULL,
    designation      VARCHAR(80) NOT NULL,        -- Principal, Teacher, Accountant, Peon ...
    staff_type       VARCHAR(20) NOT NULL CHECK (staff_type IN ('teaching','non_teaching')),
    employment_type  VARCHAR(20) NOT NULL DEFAULT 'permanent'
                     CHECK (employment_type IN ('permanent','temporary','contract','part_time')),
    qualification    VARCHAR(150),
    teaching_license_no VARCHAR(50),
    citizenship_no   VARCHAR(50),
    pan_no           VARCHAR(20),
    bank_name        VARCHAR(100),
    bank_account_no  VARCHAR(50),
    photo_url        TEXT,
    join_date        DATE NOT NULL,
    leave_date       DATE,
    status           VARCHAR(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','on_leave','resigned','retired','terminated')),
    -- Fields the public website may show (sent via API only if show_on_website = true)
    show_on_website  BOOLEAN NOT NULL DEFAULT FALSE,
    public_bio       TEXT,
    website_order    INT,
    custom_fields    JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    CHECK (leave_date IS NULL OR leave_date >= join_date)
);
CREATE INDEX idx_staff_department ON staff (department_id);

ALTER TABLE departments
    ADD CONSTRAINT fk_departments_head FOREIGN KEY (head_staff_id) REFERENCES staff(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- Uploaded documents for any person (birth certificate, TC, citizenship...)
-- ---------------------------------------------------------------------
CREATE TABLE documents (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id   BIGINT REFERENCES students(id)  ON DELETE CASCADE,
    staff_id     BIGINT REFERENCES staff(id)     ON DELETE CASCADE,
    guardian_id  BIGINT REFERENCES guardians(id) ON DELETE CASCADE,
    doc_type     VARCHAR(50) NOT NULL,           -- birth_certificate, transfer_certificate, citizenship, photo ...
    title        VARCHAR(150),
    file_url     TEXT NOT NULL,
    uploaded_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- exactly one owner
    CHECK (num_nonnulls(student_id, staff_id, guardian_id) = 1)
);
CREATE INDEX idx_documents_student ON documents (student_id);
CREATE INDEX idx_documents_staff   ON documents (staff_id);
