# Verification

Unlike the accounting API (whose own `DEPLOYMENT.md` explicitly flags that
it was only syntax-checked, never run against a live database), this
backend was actually stood up and exercised end-to-end: a real local
Postgres 16 instance, the schema applied for real, the server started for
real, and every route hit with real HTTP requests. What follows is a
condensed record of what was tested and what came back.

## Setup
```
$ psql -f db/schema.sql
CREATE EXTENSION
CREATE EXTENSION
CREATE TYPE ×4
CREATE TABLE ×4
CREATE SEQUENCE
CREATE INDEX ×2
INSERT 0 1
```
Schema applies cleanly with no errors.

## Auth
- `POST /auth/signup` (first account ever) → **role: "admin"** ✅
- `POST /auth/signup` (second account) → **role: "user"** ✅ (only the
  first account gets admin automatically)
- `POST /auth/temp-account` → creates a guest account, returns the raw
  password once (`tempPassword` in the response) ✅
- `POST /auth/login` with a wrong password → `401 {"error":"Incorrect
  email or password"}`, doesn't reveal whether the email exists ✅
- `GET /auth/me` with a valid token → returns the user ✅

## Trips & the approval workflow
- `POST /trips` → created with `status: "Draft"`, `seq: 1` (from the real
  Postgres sequence, not app-side arithmetic) ✅
- A **plain User** tries `Draft → Approved` directly → `400 "Can't move a
  trip from Draft to Approved"` (not a valid transition at all) ✅
- A **plain User** does `Draft → Pending` (submit for approval) →
  **succeeds** (this transition is `anyRole`) ✅
- That same User then tries `Pending → Approved` → `403 "Only an approver
  or admin can do that"` ✅
- An **Admin** does the same `Pending → Approved` → **succeeds**, and the
  trip's `history` array now has all three entries in order ✅

## Passengers
- A User adds a passenger → succeeds ✅
- That same User tries to `DELETE` the passenger → `403` (delete is
  admin-only) ✅
- Updating `paymentStatus` via the dedicated endpoint → succeeds, returns
  the updated row ✅

## Bulk import (Trip Type + Location grouping)
Sent 2 rows in one request:
- Row 1: `Open Trip` / `Bromo, Indonesia` → **matched** the existing Bromo
  trip (same type + destination) → that trip's passenger count went from
  1 to 2 ✅
- Row 2: `Private Trip` / `Raja Ampat, Indonesia` → no match → **new Draft
  trip created**, `seq: 2` ✅

Response: `{"importedCount":2,"createdTripCount":1,"tripIds":[...]}` — both
numbers correct.

## Trip-numbering settings
- `GET /settings` after 2 trips exist → `{"runningNumber":2,"nextNumber":3,
  ...}` — correct ✅
- `POST /settings/trip-sequence {"nextNumber":1}` (below the existing max
  of 2) → `400 "Can't go below 3 — that would collide with an existing
  trip."` — **rejected as designed** ✅
- A plain User tries `PUT /settings` → `403` ✅
- Admin sets `nextNumber: 100` → succeeds; the **next trip created actually
  got `seq: 100`** ✅ (confirms the override really drives the underlying
  Postgres sequence, not just a display value)
- Admin changes prefix/format → succeeds, reflected in the next `GET
  /settings` call ✅

## Bootstrap
- `GET /bootstrap` as Admin → single response containing `trips` (3),
  `passengers` (3), `settings`, and `users` (3) ✅
- `GET /bootstrap` as a plain User → `users` field is **omitted entirely**
  (not just empty) — non-admins never receive the account list over the
  wire at all ✅

## User management guard rails
- Sole admin tries to demote themselves → `400 "At least one admin is
  required"` ✅
- Admin tries to delete their own account → `400 "You can't remove your
  own account"` ✅
- Admin creates a second admin account, **then** the original admin can be
  demoted successfully (the "last admin" check is dynamic, not a
  one-time flag) ✅

## Activity log
Ran a real sequence through a live server against real Postgres — signup,
create/edit a trip, submit for approval, approve it, add a passenger,
change its payment status, create/promote/delete a second user account,
update numbering settings, delete the passenger, delete the trip — then
fetched `GET /activity` and confirmed:
- **All 12 actions logged**, in correct reverse-chronological order ✅
- Correct actor name/email on every entry ✅
- Correct before→after values (e.g. `trip.status_changed`:
  `{"from":"Pending","to":"Approved"}`) ✅
- Deleted trips/passengers/users still show their correct name/email in
  the log — captured via `RETURNING *` on the delete itself, not a
  separate lookup that would fail after the row is gone ✅
- A plain User calling `GET /activity` → `403`, confirming it's genuinely
  admin-only and not just hidden in the UI ✅

---

Every one of the role/permission rules the frontend's UI hides or shows
buttons for is independently re-checked here, server-side, and every check
above was confirmed to actually reject or allow the request as intended —
not assumed from reading the code.
