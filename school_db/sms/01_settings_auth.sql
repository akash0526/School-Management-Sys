-- =====================================================================
-- File 01: School settings, users, roles & permissions, API access
-- =====================================================================

-- Single-row table holding the school's profile
CREATE TABLE school_profile (
    id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- only one row allowed
    name             VARCHAR(150) NOT NULL,
    name_np          VARCHAR(150),                 -- name in Nepali
    address          TEXT,
    phone            VARCHAR(30),
    email            CITEXT,
    website          VARCHAR(150),
    pan_no           VARCHAR(20),
    school_code      VARCHAR(30),                  -- govt / EMIS school code
    established_year SMALLINT,
    logo_url         TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Key/value settings (receipt prefix, SMS sender id, attendance mode, ...)
CREATE TABLE settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Login accounts (separate from people records)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username       CITEXT NOT NULL UNIQUE,
    email          CITEXT UNIQUE,
    phone          VARCHAR(20),
    password_hash  TEXT NOT NULL,                 -- bcrypt/argon2 hash, never plain text
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ                    -- soft delete
);

CREATE TABLE roles (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE,      -- admin, principal, teacher, accountant, student, parent ...
    description TEXT
);

CREATE TABLE permissions (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        VARCHAR(100) NOT NULL UNIQUE,     -- e.g. 'marks.enter', 'marks.approve', 'fees.collect'
    module      VARCHAR(50) NOT NULL,
    description TEXT
);

CREATE TABLE role_permissions (
    role_id       INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INT    NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- Refresh tokens / login sessions for the REST API
CREATE TABLE user_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    ip_address         INET,
    user_agent         TEXT,
    expires_at         TIMESTAMPTZ NOT NULL,
    revoked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);

CREATE TABLE password_resets (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Machine clients allowed to call the SMS API (e.g. the public website)
-- ---------------------------------------------------------------------
CREATE TABLE api_clients (
    id            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          VARCHAR(100) NOT NULL UNIQUE,   -- 'public-website'
    api_key_hash  TEXT NOT NULL,                  -- store only a hash of the key
    scopes        TEXT[] NOT NULL DEFAULT '{}',   -- {'notices.read','events.read','inquiries.create','results.lookup'}
    allowed_ips   INET[],
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
