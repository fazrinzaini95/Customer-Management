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
-- - Every statement below is safe to re-run: types use a DO block with
--   exception handling (Postgres has no native "CREATE TYPE IF NOT
--   EXISTS"), and everything else uses IF NOT EXISTS / ON CONFLICT. Paste
--   the whole file and run it any number of times without worrying about
--   what already landed from a previous partial run.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'approver', 'admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE trip_type AS ENUM ('open', 'private');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE trip_status AS ENUM ('Draft', 'Pending', 'Approved', 'Declined', 'Cancelled', 'Completed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('Pending', 'Deposit', 'Paid', 'Cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_purchaser AS ENUM ('Self Purchase', 'Excapism');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('Pending', 'Purchased');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------
-- Users & auth
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
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
CREATE SEQUENCE IF NOT EXISTS trip_seq START 1;

-- ---------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
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
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A separate, unguessable token for the public self-registration link —
  -- deliberately NOT the trip's real id, so it can be shared publicly
  -- without exposing (or letting anyone guess) internal identifiers, and
  -- so it could be regenerated/revoked later without renumbering the trip.
  public_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex')
);

CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_type_destination ON trips(type, destination);  -- for bulk-import grouping lookups
-- No separate index for public_token: its UNIQUE constraint below already
-- creates one automatically (visible as trips_public_token_key).

-- Migration path for databases that already had the trips table before
-- self-registration links existed — safe to re-run. Because
-- gen_random_bytes() is volatile, Postgres evaluates it fresh per
-- existing row during this ALTER, so every pre-existing trip gets its
-- own distinct token too, not one shared value.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex');

-- ---------------------------------------------------------------
-- Passengers
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passengers (
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
  ticket_purchaser   ticket_purchaser,             -- who's buying the flight ticket — set once the trip is Approved
  ticket_status      ticket_status NOT NULL DEFAULT 'Pending',
  airline            TEXT,
  booking_reference  TEXT,
  notes              TEXT,
  submitted_at       TIMESTAMPTZ,  -- from the source form/sheet, if provided
  added_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passengers_trip_id ON passengers(trip_id);

-- Migration path for databases that already had the passengers table
-- before flight-ticket tracking was added — safe to re-run.
ALTER TABLE passengers ADD COLUMN IF NOT EXISTS ticket_purchaser ticket_purchaser;
ALTER TABLE passengers ADD COLUMN IF NOT EXISTS ticket_status ticket_status NOT NULL DEFAULT 'Pending';
ALTER TABLE passengers ADD COLUMN IF NOT EXISTS airline TEXT;
ALTER TABLE passengers ADD COLUMN IF NOT EXISTS booking_reference TEXT;

-- ---------------------------------------------------------------
-- App settings (trip-numbering format)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- enforces exactly one row
  data       JSONB NOT NULL DEFAULT '{"prefix":"EXC","includeYear":true,"padding":3}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id, data)
  VALUES (1, '{"prefix":"EXC","includeYear":true,"padding":3}')
  ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------
-- Activity log
-- Every create/edit/delete/status-change/role-change is recorded here —
-- who did it, what it was, and a short detail of what changed. actor_name
-- and actor_email are snapshotted at write time (not joined live) so the
-- log stays readable even after an account is later deleted.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name   TEXT NOT NULL,
  actor_email  TEXT NOT NULL,
  action       TEXT NOT NULL,   -- e.g. 'trip.created', 'trip.status_changed', 'user.role_changed'
  entity_type  TEXT NOT NULL,   -- 'trip' | 'passenger' | 'user' | 'settings' | 'bulk_import'
  entity_id    TEXT,            -- nullable — settings/bulk_import aren't tied to one row
  entity_label TEXT,            -- human-readable snapshot, e.g. the trip name or passenger name
  details      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
