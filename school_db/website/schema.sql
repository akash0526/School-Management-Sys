-- =====================================================================
-- PUBLIC WEBSITE DATABASE  (completely separate from school_sms)
-- Engine : PostgreSQL 15+
-- Usage  : createdb school_website && psql -d school_website -f schema.sql
--
-- Holds ONLY public content + data submitted by visitors.
-- Notices / events / staff are COPIES synced from the SMS API (read-only here).
-- Exam results are NOT stored here — the website calls the SMS API live.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- CMS admins (website editors — NOT the same accounts as the SMS)
-- ---------------------------------------------------------------------
CREATE TABLE admin_users (
    id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           VARCHAR(100) NOT NULL,
    email          CITEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    role           VARCHAR(10) NOT NULL DEFAULT 'editor' CHECK (role IN ('admin','editor')),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Site name, logo, contact info, social links, SEO defaults, map embed ...
CREATE TABLE site_settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Media library (all uploaded images / PDFs)
-- ---------------------------------------------------------------------
CREATE TABLE media (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_name    VARCHAR(255) NOT NULL,
    file_url     TEXT NOT NULL,
    mime_type    VARCHAR(100),
    size_bytes   BIGINT,
    width        INT,
    height       INT,
    alt_text     VARCHAR(255),
    uploaded_by  INT REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Pages (About, Principal's Message, Facilities, Contact ...)
-- ---------------------------------------------------------------------
CREATE TABLE pages (
    id                 INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id          INT REFERENCES pages(id) ON DELETE SET NULL,
    title              VARCHAR(255) NOT NULL,
    slug               VARCHAR(255) NOT NULL UNIQUE,
    content            TEXT,
    excerpt            TEXT,
    featured_image_id  BIGINT REFERENCES media(id) ON DELETE SET NULL,
    template           VARCHAR(50) NOT NULL DEFAULT 'default',
    meta_title         VARCHAR(255),
    meta_description   VARCHAR(500),
    status             VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    sequence           INT NOT NULL DEFAULT 0,
    published_at       TIMESTAMPTZ,
    created_by         INT REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- News / blog posts
-- ---------------------------------------------------------------------
CREATE TABLE post_categories (
    id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name  VARCHAR(100) NOT NULL,
    slug  VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE posts (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id        INT REFERENCES post_categories(id) ON DELETE SET NULL,
    title              VARCHAR(255) NOT NULL,
    slug               VARCHAR(255) NOT NULL UNIQUE,
    excerpt            TEXT,
    content            TEXT NOT NULL,
    featured_image_id  BIGINT REFERENCES media(id) ON DELETE SET NULL,
    meta_title         VARCHAR(255),
    meta_description   VARCHAR(500),
    status             VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    is_featured        BOOLEAN NOT NULL DEFAULT FALSE,
    view_count         INT NOT NULL DEFAULT 0,
    published_at       TIMESTAMPTZ,
    author_id          INT REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_posts_published ON posts (status, published_at DESC);

-- ---------------------------------------------------------------------
-- Navigation menus
-- ---------------------------------------------------------------------
CREATE TABLE menus (
    id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    location  VARCHAR(30) NOT NULL UNIQUE          -- 'header', 'footer'
);

CREATE TABLE menu_items (
    id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    menu_id    INT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    parent_id  INT REFERENCES menu_items(id) ON DELETE CASCADE,
    label      VARCHAR(100) NOT NULL,
    page_id    INT REFERENCES pages(id) ON DELETE CASCADE,
    url        TEXT,                               -- external link, e.g. portal login
    sequence   INT NOT NULL DEFAULT 0,
    open_new_tab BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (num_nonnulls(page_id, url) = 1)
);

-- ---------------------------------------------------------------------
-- Homepage & visual content
-- ---------------------------------------------------------------------
CREATE TABLE sliders (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title       VARCHAR(255),
    subtitle    VARCHAR(255),
    image_id    BIGINT NOT NULL REFERENCES media(id),
    button_text VARCHAR(50),
    link_url    TEXT,
    sequence    INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE gallery_albums (
    id              INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title           VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT,
    cover_image_id  BIGINT REFERENCES media(id) ON DELETE SET NULL,
    event_date      DATE,
    is_published    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gallery_items (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    album_id   INT NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
    item_type  VARCHAR(10) NOT NULL DEFAULT 'image' CHECK (item_type IN ('image','video')),
    media_id   BIGINT REFERENCES media(id) ON DELETE CASCADE,
    video_url  TEXT,                                -- YouTube link
    caption    VARCHAR(255),
    sequence   INT NOT NULL DEFAULT 0,
    CHECK (num_nonnulls(media_id, video_url) = 1)
);

CREATE TABLE testimonials (
    id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    person_name  VARCHAR(100) NOT NULL,
    designation  VARCHAR(100),                      -- 'Parent', 'Alumni (SEE 2080)'
    photo_id     BIGINT REFERENCES media(id) ON DELETE SET NULL,
    message      TEXT NOT NULL,
    sequence     INT NOT NULL DEFAULT 0,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE faqs (
    id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    category   VARCHAR(50),                         -- Admission, Fees, Transport
    sequence   INT NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- Prospectus, admission form, syllabus PDFs ...
CREATE TABLE downloads (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title       VARCHAR(255) NOT NULL,
    category    VARCHAR(50),
    media_id    BIGINT NOT NULL REFERENCES media(id),
    download_count INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Visitor submissions
-- ---------------------------------------------------------------------
-- Saved locally first, then pushed to SMS  POST /api/v1/inquiries
CREATE TABLE admission_inquiries (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_name    VARCHAR(150) NOT NULL,
    dob             DATE,
    gender          VARCHAR(10),
    applying_class  VARCHAR(30) NOT NULL,           -- 'Grade 5', 'Grade 11 - Science'
    guardian_name   VARCHAR(150),
    phone           VARCHAR(20) NOT NULL,
    email           CITEXT,
    message         TEXT,
    ip_address      INET,
    sync_status     VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','synced','failed')),
    sms_inquiry_id  BIGINT,                         -- id returned by the SMS API
    sync_attempts   SMALLINT NOT NULL DEFAULT 0,
    sync_error      TEXT,
    synced_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_web_inquiries_sync ON admission_inquiries (sync_status) WHERE sync_status <> 'synced';

CREATE TABLE contact_messages (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    email       CITEXT,
    phone       VARCHAR(20),
    subject     VARCHAR(255),
    message     TEXT NOT NULL,
    ip_address  INET,
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    is_spam     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE newsletter_subscribers (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email            CITEXT NOT NULL UNIQUE,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    subscribed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    unsubscribed_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- Read-only copies synced FROM the SMS API (never edited on website)
-- sms_id = primary key in the SMS database
-- ---------------------------------------------------------------------
CREATE TABLE synced_notices (
    sms_id          BIGINT PRIMARY KEY,
    title           VARCHAR(255) NOT NULL,
    body            TEXT NOT NULL,
    attachment_url  TEXT,
    publish_at      TIMESTAMPTZ NOT NULL,
    expires_at      TIMESTAMPTZ,
    sms_updated_at  TIMESTAMPTZ NOT NULL,          -- for incremental sync (?updated_since=)
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_synced_notices_publish ON synced_notices (publish_at DESC);

CREATE TABLE synced_events (
    sms_id           BIGINT PRIMARY KEY,
    title            VARCHAR(255) NOT NULL,
    description      TEXT,
    location         VARCHAR(150),
    start_at         TIMESTAMPTZ NOT NULL,
    end_at           TIMESTAMPTZ,
    cover_image_url  TEXT,
    sms_updated_at   TIMESTAMPTZ NOT NULL,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE synced_staff (
    sms_id          BIGINT PRIMARY KEY,
    full_name       VARCHAR(150) NOT NULL,
    designation     VARCHAR(80),
    department      VARCHAR(100),
    qualification   VARCHAR(150),
    photo_url       TEXT,
    bio             TEXT,
    display_order   INT,
    sms_updated_at  TIMESTAMPTZ NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log of each sync run
CREATE TABLE sync_logs (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity         VARCHAR(30) NOT NULL,           -- notices, events, staff, inquiries
    direction      VARCHAR(10) NOT NULL CHECK (direction IN ('pull','push')),
    status         VARCHAR(10) NOT NULL CHECK (status IN ('running','success','failed')),
    records_count  INT NOT NULL DEFAULT 0,
    error          TEXT,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ
);

-- Simple rate-limit table for the result lookup form (anti brute-force)
CREATE TABLE result_lookup_attempts (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ip_address  INET NOT NULL,
    symbol_no   VARCHAR(30),
    success     BOOLEAN NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_result_attempts_ip ON result_lookup_attempts (ip_address, created_at);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_admin_users_updated_at BEFORE UPDATE ON admin_users   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_site_settings_updated_at BEFORE UPDATE ON site_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pages_updated_at       BEFORE UPDATE ON pages         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_posts_updated_at       BEFORE UPDATE ON posts         FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------
INSERT INTO menus (location) VALUES ('header'), ('footer');

INSERT INTO site_settings (key, value) VALUES
 ('site_name',     '"Your School Name"'),
 ('contact',       '{"phone": "071-XXXXXX", "email": "info@school.edu.np", "address": "Butwal, Rupandehi"}'),
 ('social_links',  '{"facebook": "", "youtube": "", "instagram": ""}'),
 ('portal_url',    '"https://portal.school.edu.np"'),
 ('sms_api',       '{"base_url": "https://portal.school.edu.np/api/v1", "sync_interval_minutes": 15}');
-- NOTE: keep the SMS API key in an environment variable, NOT in this table.

INSERT INTO post_categories (name, slug) VALUES
 ('News', 'news'), ('Achievements', 'achievements'), ('Blog', 'blog');

COMMIT;
