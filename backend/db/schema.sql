-- ============================================================
-- Excapism Passenger Manifest — Schema (PostgreSQL 14+)
-- ============================================================
-- Design notes:
-- - trip_seq is a real Postgres SEQUENCE, not a value tracked in app code.
--   That gives atomic, ever-increasing trip numbers for free — two people
--   creating a trip at the same instant can never get the same number, and
--   deleting a trip never frees its number back up for reuse. The frontend
--   previously approximated this with an in-memory counter; a sequence is
--   the real version of that guarantee.
-- - trips.history is append-only JSONB (status + timestamp per change) —
--   simple, and matches exactly what the frontend already renders as the
--   trip's status log. No separate audit table needed for this app's scale.
-- - app_settings is a single-row table (id is CHECK'd to always be 1) that
--   holds the trip-numbering format (prefix / includeYear / padding) — the
--   same pattern the accounting app uses for its own settings.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

CREATE TYPE user_role       AS ENUM ('user', 'approver', 'admin');
CREATE TYPE trip_type       AS ENUM ('open', 'private');
CREATE TYPE trip_status     AS ENUM ('Draft', 'Pending', 'Approved', 'Declined', 'Cancelled', 'Completed');
CREATE TYPE payment_status  AS ENUM ('Pending', 'Deposit', 'Paid', 'Cancelled');

-- ---------------------------------------------------------------
-- Users & auth
-- ---------------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'user',
  is_temp       BOOLEAN NOT NULL DEFAULT false,  -- created via the "temporary account" quick-start
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Trip numbering
-- ---------------------------------------------------------------
CREATE SEQUENCE trip_seq START 1;

-- ---------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------
CREATE TABLE trips (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq          INT NOT NULL UNIQUE DEFAULT nextval('trip_seq'),
  name         TEXT NOT NULL,
  type         trip_type NOT NULL DEFAULT 'open',
  destination  TEXT,
  start_date   DATE,
  end_date     DATE,
  status       trip_status NOT NULL DEFAULT 'Draft',
  history      JSONB NOT NULL DEFAULT '[]',  -- [{ "status": "Draft", "date": "2026-08-22T..." }, ...]
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_trips_type_destination ON trips(type, destination);  -- for bulk-import grouping lookups

-- ---------------------------------------------------------------
-- Passengers
-- ---------------------------------------------------------------
CREATE TABLE passengers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id            UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  dob                DATE,
  phone              TEXT,
  id_number          TEXT,
  medical_condition  TEXT,
  passport_note      TEXT,
  amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status     payment_status NOT NULL DEFAULT 'Pending',
  notes              TEXT,
  submitted_at       TIMESTAMPTZ,  -- from the source form/sheet, if provided
  added_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_passengers_trip_id ON passengers(trip_id);

-- ---------------------------------------------------------------
-- App settings (trip-numbering format)
-- ---------------------------------------------------------------
CREATE TABLE app_settings (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- enforces exactly one row
  data       JSONB NOT NULL DEFAULT '{"prefix":"EXC","includeYear":true,"padding":3}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id, data)
  VALUES (1, '{"prefix":"EXC","includeYear":true,"padding":3}')
  ON CONFLICT (id) DO NOTHING;
