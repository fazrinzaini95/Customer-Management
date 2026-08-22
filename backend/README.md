# Passenger Manifest API

The real backend for the Excapism Passenger Manifest frontend (`../index.html`):
Express + Postgres, JWT auth, deployed as a single Netlify Function. Built to
the same conventions as the accounting app's `ledger-api` backend, so the
two are easy to maintain side by side.

**Verified**, not just written: every route in this backend has been run
against a real local Postgres instance (schema applied, server started, and
each endpoint exercised with real HTTP requests) — not merely syntax-checked.
See `VERIFICATION.md` for the full transcript of what was tested.

## Stack

- **Express** — routing, matching the frontend's existing data shapes so no
  response-mapping logic needs to change on the frontend side.
- **`pg`** (raw Postgres driver) — talks directly to Supabase's Postgres via
  connection string. Does **not** use Supabase's client SDK, Auth, or
  PostgREST — Supabase here is purely "hosted Postgres."
- **JWT** (`jsonwebtoken` + `bcryptjs`) — same lightweight auth model the
  frontend already had client-side, now enforced server-side too (every
  role check the UI does for display is re-checked here for real).
- **`serverless-http`** — adapts the Express app to run as one Netlify
  Function, no code changes needed between "run locally with `npm start`"
  and "deployed on Netlify."
- **Zod** — request validation on every route that accepts a body.

## Local development

```bash
cp .env.example .env      # edit DATABASE_URL to point at local Postgres
npm install
npm run migrate           # applies db/schema.sql
npm run dev                # or: docker compose up --build
```

Check it's alive: `curl http://localhost:4000/health`

## Endpoint reference

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/signup`, `POST /auth/temp-account`, `POST /auth/login`, `GET /auth/me` |
| Trips | `GET/POST /trips`, `GET/PUT/DELETE /trips/:id`, `POST /trips/:id/status`, `POST /trips/bulk-import` |
| Passengers | `GET/POST /trips/:tripId/passengers`, `PUT/DELETE /passengers/:id`, `PUT /passengers/:id/payment-status` |
| Users (admin only) | `GET/POST /users`, `PUT /users/:id/role`, `DELETE /users/:id` |
| Settings | `GET /settings`, `PUT /settings` (admin), `POST /settings/trip-sequence` (admin) |
| Bootstrap | `GET /bootstrap` — everything needed right after login, in one call |

Full request/response shapes are in the route files themselves
(`src/routes/*.js`) — each has a Zod schema right above the handler that
uses it, which doubles as documentation of exactly what's expected.

## Role enforcement (matches the frontend exactly)

- **User** — create/edit trips and passengers, submit a Draft for approval,
  bulk import.
- **Approver** — everything User can do, plus move a trip between
  Pending → Approved/Declined and Approved → Completed/Cancelled.
- **Admin** — everything, plus delete trips/passengers and manage user
  accounts (`/users/*`, `/settings` PUT, `/settings/trip-sequence`).

Every one of these is enforced in `src/middleware/auth.js` +
per-route checks — not just hidden in the UI. See `VERIFICATION.md` for
proof each guard actually rejects what it's supposed to.

## Deploying

See `DEPLOYMENT.md` for the Netlify + Supabase specific walkthrough.
