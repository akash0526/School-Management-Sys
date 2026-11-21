-- =====================================================================
-- File 10: Notices, events, notifications, SMS logs, homework,
--          admissions (inquiries come from the website via API)
-- =====================================================================

CREATE TABLE notices (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title           VARCHAR(255) NOT NULL,
    body            TEXT NOT NULL,
    audience        VARCHAR(15) NOT NULL DEFAULT 'all'
                    CHECK (audience IN ('all','students','parents','staff','specific')),
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE = website may show it via API
    attachment_url  TEXT,
    publish_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CHECK (expires_at IS NULL OR expires_at > publish_at)
);
CREATE INDEX idx_notices_public ON notices (is_public, publish_at DESC);

-- When audience = 'specific': which classes / sections receive it
CREATE TABLE notice_targets (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    notice_id   BIGINT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
    class_id    INT REFERENCES classes(id),
    section_id  INT REFERENCES sections(id),
    CHECK (num_nonnulls(class_id, section_id) >= 1)
);

CREATE TABLE events (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title        VARCHAR(255) NOT NULL,
    description  TEXT,
    location     VARCHAR(150),
    start_at     TIMESTAMPTZ NOT NULL,
    end_at       TIMESTAMPTZ,
    is_public    BOOLEAN NOT NULL DEFAULT FALSE,     -- TRUE = website may show it
    cover_image_url TEXT,
    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_at IS NULL OR end_at >= start_at)
);

-- In-app / push notifications for portal users
CREATE TABLE notifications (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(255) NOT NULL,
    body        TEXT,
    link        TEXT,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

-- Outgoing SMS (Sparrow SMS / Aakash SMS etc.)
CREATE TABLE sms_logs (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone         VARCHAR(20) NOT NULL,
    message       TEXT NOT NULL,
    purpose       VARCHAR(30),                       -- absent_alert, fee_reminder, result, notice
    provider      VARCHAR(30),
    provider_ref  VARCHAR(100),
    status        VARCHAR(10) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed')),
    credits_used  SMALLINT,
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at       TIMESTAMPTZ
);
CREATE INDEX idx_sms_logs_status ON sms_logs (status);

-- ------------------------------ HOMEWORK -----------------------------
CREATE TABLE assignments (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    section_id        INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    class_subject_id  INT NOT NULL REFERENCES class_subjects(id),
    staff_id          BIGINT REFERENCES staff(id) ON DELETE SET NULL,
    title             VARCHAR(255) NOT NULL,
    description       TEXT,
    attachment_url    TEXT,
    assigned_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date          DATE,
    max_marks         NUMERIC(6,2),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assignment_submissions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    assignment_id   BIGINT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    enrollment_id   BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    content         TEXT,
    attachment_url  TEXT,
    marks           NUMERIC(6,2),
    feedback        TEXT,
    UNIQUE (assignment_id, enrollment_id)
);

-- ----------------------------- ADMISSIONS ----------------------------
-- Inquiries arrive from the website (POST /api/v1/inquiries) or walk-ins
CREATE TABLE admission_inquiries (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source             VARCHAR(15) NOT NULL DEFAULT 'website'
                       CHECK (source IN ('website','walk_in','phone','social_media','referral')),
    external_ref       VARCHAR(50) UNIQUE,           -- website's inquiry id (prevents duplicate sync)
    student_name       VARCHAR(150) NOT NULL,
    dob                DATE,
    gender             VARCHAR(10),
    applying_class_id  INT REFERENCES classes(id),
    stream_id          INT REFERENCES streams(id),
    guardian_name      VARCHAR(150),
    phone              VARCHAR(20) NOT NULL,
    email              CITEXT,
    message            TEXT,
    status             VARCHAR(15) NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','contacted','applied','closed','spam')),
    assigned_to        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    follow_up_notes    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inquiries_status ON admission_inquiries (status);

CREATE TABLE admission_applications (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_no      VARCHAR(30) NOT NULL UNIQUE,
    inquiry_id          BIGINT REFERENCES admission_inquiries(id) ON DELETE SET NULL,
    academic_year_id    INT NOT NULL REFERENCES academic_years(id),
    applying_class_id   INT NOT NULL REFERENCES classes(id),
    stream_id           INT REFERENCES streams(id),
    applicant_data      JSONB NOT NULL,              -- full form data until approved
    entrance_exam_date  DATE,
    entrance_score      NUMERIC(6,2),
    interview_notes     TEXT,
    status              VARCHAR(15) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','shortlisted','approved','rejected','waitlisted','enrolled')),
    student_id          BIGINT REFERENCES students(id),   -- filled once converted to a student
    decided_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
