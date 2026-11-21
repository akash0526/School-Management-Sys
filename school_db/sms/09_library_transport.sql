-- =====================================================================
-- File 09: Library & Transport
-- =====================================================================

-- ------------------------------ LIBRARY ------------------------------
CREATE TABLE books (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    isbn         VARCHAR(20),
    title        VARCHAR(255) NOT NULL,
    author       VARCHAR(255),
    publisher    VARCHAR(150),
    edition      VARCHAR(30),
    category     VARCHAR(80),
    language     VARCHAR(30),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_books_title ON books (title);

-- Each physical copy has its own accession number
CREATE TABLE book_copies (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    book_id        BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    accession_no   VARCHAR(30) NOT NULL UNIQUE,
    shelf_location VARCHAR(50),
    status         VARCHAR(15) NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available','issued','lost','damaged','withdrawn'))
);

CREATE TABLE book_issues (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    book_copy_id  BIGINT NOT NULL REFERENCES book_copies(id),
    student_id    BIGINT REFERENCES students(id),
    staff_id      BIGINT REFERENCES staff(id),
    issue_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date      DATE NOT NULL,
    return_date   DATE,
    fine_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
    issued_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    CHECK (num_nonnulls(student_id, staff_id) = 1),
    CHECK (due_date >= issue_date),
    CHECK (return_date IS NULL OR return_date >= issue_date)
);
-- A copy can only be issued once at a time
CREATE UNIQUE INDEX uq_copy_not_returned ON book_issues (book_copy_id) WHERE return_date IS NULL;

-- ----------------------------- TRANSPORT -----------------------------
CREATE TABLE vehicles (
    id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_no       VARCHAR(30) NOT NULL UNIQUE,   -- e.g. 'Lu 1 Kha 2345'
    capacity         SMALLINT,
    driver_staff_id  BIGINT REFERENCES staff(id) ON DELETE SET NULL,
    helper_staff_id  BIGINT REFERENCES staff(id) ON DELETE SET NULL,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE transport_routes (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    vehicle_id  INT REFERENCES vehicles(id) ON DELETE SET NULL
);

CREATE TABLE route_stops (
    id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    route_id     INT NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    sequence     SMALLINT NOT NULL,
    pickup_time  TIME,
    drop_time    TIME,
    monthly_fee  NUMERIC(10,2),
    UNIQUE (route_id, sequence)
);

CREATE TABLE student_transport (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id  BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    route_stop_id  INT NOT NULL REFERENCES route_stops(id),
    start_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date       DATE,
    UNIQUE (enrollment_id, start_date),
    CHECK (end_date IS NULL OR end_date >= start_date)
);
