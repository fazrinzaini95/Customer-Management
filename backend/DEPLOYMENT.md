# Deploying the API — Netlify + Supabase + GitHub

> **This describes the two-site setup (API on its own separate Netlify
> site).** The repo is actually configured for the simpler single-site
> setup by default — one Netlify site serving both the frontend and this
> API together, no CORS configuration needed at all. See the root
> `README.md`'s "Deploying" section for that path; it's what's currently
> deployed. Steps 1–3 below (Supabase setup + schema) are identical either
> way — only the Netlify site configuration in step 4 differs.

This backend can also deploy as its **own Netlify site** (separate from
the frontend's), running as a single serverless Function, talking to a
Supabase Postgres database. Useful if you'd rather keep the two
independently deployable, or scale/manage them separately later.

## 1. Create the Supabase project

1. [supabase.com](https://supabase.com) → New project. Pick a strong
   database password and save it somewhere.
2. Once it's provisioned: **Project Settings → Database → Connection
   pooling**. Copy the **"Transaction" mode** connection string (port
   `6543`) — not the direct connection on port `5432`.

   **Why the pooler and not the direct connection:** Netlify Functions can
   spin up several concurrent container instances under any real load,
   each wanting its own Postgres connection. Supabase's direct connection
   has a fairly low connection cap and gets exhausted fast under that
   pattern — the pooler exists specifically to absorb many short-lived
   serverless connections. This is already accounted for in `src/db.js`
   (SSL auto-detected for Supabase URLs, pool capped at `max: 1` per
   function container) — just make sure the URL you use is the pooler one.

## 2. Apply the schema

From your machine, with `psql` installed:

```bash
psql "postgresql://postgres.xxxx:yourpassword@aws-0-region.pooler.supabase.com:6543/postgres" -f db/schema.sql
```

(Or paste `db/schema.sql`'s contents into Supabase's SQL Editor in the
dashboard and run it there — works identically.)

No manual admin user setup needed — unlike the accounting app, this one
supports self-signup, and the **first account ever created automatically
becomes admin**. That happens the first time someone opens the deployed
frontend and signs up.

## 3. Push to GitHub

If this repo isn't already on GitHub, push it (it's already `git init`'d
with commits). This `backend/` folder can live in the same repo as the
frontend (`index.html` at the repo root) — Netlify supports pointing a
site at a subdirectory of a monorepo.

## 4. Create the Netlify site for the API

1. Netlify → **Add new site → Import an existing project** → select the
   repo.
2. **Base directory**: `backend`
3. Build command / publish directory: leave as default — `netlify.toml`
   inside `backend/` already sets `functions = "netlify/functions"` and
   `publish = "public"`.
4. **Environment variables** (Site settings → Environment variables):
   - `DATABASE_URL` — the Supabase **pooler** connection string from step 1
   - `JWT_SECRET` — a long random string, e.g. `openssl rand -hex 32`
   - `JWT_EXPIRES_IN` — `8h` (or your preference)
   - `CORS_ORIGIN` — the frontend's deployed URL (e.g.
     `https://excapism-manifest.netlify.app`) — **not** `*`, since the
     server fails closed if this is missing
5. Deploy. Once it's live, verify: `https://your-api-site.netlify.app/api/health`
   should return `{"status":"ok",...}`.

## 5. Point the frontend at it

This is the piece that's still open: `index.html`'s `storage` adapter
currently talks to `window.storage`/`localStorage`, not this API. Swapping
that adapter for real `fetch()` calls to this API (with the JWT in an
`Authorization: Bearer` header) is what actually connects the two — see
the note in the top-level repo's `docs/DEPLOYMENT.md`. Happy to do that
wiring next; it's a contained change scoped to that one `storage` object
and the auth handlers, not a rewrite of the UI.

## 6. Before real use

- [ ] Confirm `CORS_ORIGIN` is the real frontend URL, not `*` or a preview URL
- [ ] Rotate `JWT_SECRET` if it was ever generated/shared insecurely
- [ ] In Supabase, confirm Row Level Security is either enabled with
      matching policies, or consciously left off because this API is the
      only thing with the `DATABASE_URL` (this backend does not use
      Supabase Auth/RLS — it's a normal server-side credential, so RLS is
      optional here, not required, but worth a deliberate decision either way)
- [ ] Remove any test accounts created while trying this out
      (`DELETE FROM users WHERE email LIKE '%@excapism.test'` or via
      `/users` once an admin is signed in)
