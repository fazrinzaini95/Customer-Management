# Changelog

Everything built so far, in order. Data shapes are included where useful for
anyone extending this or wiring up a real backend later.

## 1. Initial build — customer management app
- Trips (open/private), each rendered as a boarding-pass-style "stub" card.
- Trip approval flow: Pending → Approved/Declined, Approved → Completed/Cancelled.
- Passenger payment status: Paid / Deposit / Pending / Cancelled.
- Bulk Excel upload with flexible header matching.
- Manual create/edit for both trips and passengers, not just bulk upload.

## 2. Schema alignment to the real registration form
Customer fields updated to match the actual Google Form export:
`Timestamp, Full Name (As per IC), Date of Birth, Contact Number, Trip Type,
Location, Medical Condition/history, Upload Passport front page`.

- Bulk upload auto-groups rows by **Trip Type + Location**, matching an
  existing trip or creating a new one per group — so one upload file can
  populate several trips at once.
- Full edit support added for both trips and passengers (not just create).

## 3. Bulk upload template
- Downloadable `.xlsx` template (`templates/Excapism_Passenger_Upload_Template.xlsx`):
  styled header row, sample row, Trip Type dropdown validation, and an
  Instructions sheet.
- Column headers are written to match the app's recognized synonyms exactly.
- **Download template** button added inside the Bulk Upload modal — the
  template file is embedded in `index.html` as base64 and generated
  client-side, no server needed.

## 4. Export
- **Export to Excel** button on a trip's passenger list — downloads that
  trip's full passenger data as `.xlsx`, generated client-side via SheetJS.

## 5. Accounts & roles
- Three roles: **User** (create/edit), **Approver** (User + approve/decline/
  complete/cancel trips), **Admin** (full control, incl. delete + manage
  users).
- Manage Users modal (admin-only): add accounts, change roles inline, remove
  accounts. Always keeps at least one admin.
- Trips/passengers switched from personal to **shared** storage — required
  for multiple accounts to see the same data.

## 6. Sign-in / sign-up rework
- Proper Sign In / Create Account screens (previously a one-time "first
  admin setup" only).
- Switched from username to **email** as the login identifier throughout.
- First account ever created becomes admin automatically; every account
  after that defaults to User (an admin can promote later).
- **Temporary/guest account** button — one click generates a random email +
  password, creates the account, and signs in immediately. Credentials are
  shown once in an on-screen banner since the password can't be recovered
  after hashing.

## 7. Template cleanup
- Removed `Timestamp` and `Upload Passport front page` columns from the
  bulk-upload template (still optional/recognized if present in other
  files, just no longer part of the default template).

## 8. Trip status workflow: Draft stage
- New trips (manual or bulk-created) now start as **Draft** instead of
  Pending.
- **Submit for approval** button moves Draft → Pending (available to any
  logged-in role — submitting isn't the same as approving).
- Declined/Cancelled trips now reopen to **Draft** (not straight back to
  Pending), so they can be edited before resubmission.
- Full flow: `Draft → Pending → Approved → Completed`, with
  Declined/Cancelled as off-ramps that loop back to Draft.

## 9. Permanent unique trip numbers
- Trip codes (`EXC-2026-014`) now come from an ever-increasing counter
  stored separately from the trips list, so a deleted trip's number is
  never reused by a later trip. (Previously the number was recalculated
  from `max(existing trip numbers) + 1`, which could collide after a
  deletion.)

## 10. Trip numbering Settings panel (admin-only)
- View the current running number and what the next trip will be numbered.
- Configure the **prefix** (default `EXC`), whether the **year** is
  included, and **digit padding** (2–5 digits) — live preview shown.
- **Set next trip number (advanced)** — jump the counter ahead (e.g. after
  importing legacy records); refuses to go below the highest number
  already in use.

## 11. Bug fix — "+ New trip" button (empty state)
- The empty-state "+ New trip" button and the top-bar one both used
  `data-action="open-new-trip"`, but the click-binding code used
  `querySelector` (grabs only the first match), so the empty-state button
  silently did nothing. Fixed by binding all matching elements.

## 12. Storage portability
- Added a storage adapter (`storage` object, top of the `<script>` in
  `index.html`) that uses `window.storage` when running inside Claude.ai,
  and automatically falls back to real `localStorage` when the file is
  opened outside Claude.ai (local file, self-hosted, etc.) — see
  `docs/DEPLOYMENT.md` for why this matters before a real go-live.

## 13. Netlify deployment prep
- Added `netlify.toml` (publish dir `.`, no build step, basic security
  headers).
- README updated with two Netlify deploy paths: drag-and-drop and
  Git-connected continuous deployment.
- `DEPLOYMENT.md` expanded with Netlify-specific detail on the storage
  caveat: on a static host with no backend, each teammate's browser holds
  its own separate copy of trips/passengers/accounts — the shared-team
  behavior this app was built for needs a real backend (Supabase/Firebase/
  custom API) to actually work once it's live on a public URL.

## 14. Real backend — Express + Postgres, following the accounting app's conventions
Built `backend/` from scratch to the same architecture as the accounting
app's `ledger-api`: Express + `pg` (raw Postgres, not the Supabase SDK) +
JWT auth (bcrypt-hashed passwords) + Zod validation, deployed as a single
Netlify Function via `serverless-http`, with Supabase as hosted Postgres.

- Schema: `users`, `trips`, `passengers`, `app_settings`, plus a real
  Postgres `SEQUENCE` for trip numbers (atomic, never reused, replacing
  the old client-side counter entirely).
- Routes: `auth` (signup/login/temp-account — first account ever becomes
  admin), `trips` (CRUD, status transitions with server-side role
  enforcement, bulk-import with server-side Trip Type + Location
  grouping), `passengers`, `users` (admin-only management), `settings`
  (numbering format + sequence override), `bootstrap` (everything needed
  after login, in one request).
- **Independently verified**, not just written: stood up a real local
  Postgres instance, applied the schema, ran the server, and exercised
  every route with real HTTP requests — including confirming each
  role-based rejection actually rejects (a User can't approve a trip or
  delete a passenger; a non-admin can't touch `/users` or `/settings`;
  the "last admin" guard actually blocks removing the only admin). Full
  transcript in `backend/VERIFICATION.md`.

## 15. Frontend rewired to the real API
`index.html` no longer stores any app data in the browser. Replaced the
entire `window.storage`/`localStorage` adapter with a real API client:

- New `apiFetch()` helper — attaches the JWT as a `Bearer` token, surfaces
  server error messages directly in the UI instead of generic failures.
- `API_BASE` config constant at the top of the `<script>` tag — the app
  shows a "Backend not configured" screen instead of a broken login form
  if it's left as the placeholder.
- Every handler that used to mutate local state directly now calls the
  matching endpoint: sign-up/login/temp-account, trip create/edit/delete/
  status-change, passenger create/edit/delete/payment-status, bulk upload
  (grouped rows go to `/trips/bulk-import` in one atomic call; the
  no-Trip-Type fallback loops individual passenger-create calls into one
  target trip), and all Manage Users / Settings actions.
- Login sessions still live in memory only (refreshing the page requires
  signing in again) — unchanged from before, just now backed by a real
  JWT instead of a locally-checked password hash.
- **Verified end-to-end**, not just synced with the backend's route
  shapes: ran a headless-browser test (jsdom) against the real response
  shapes confirmed via the backend's own curl testing — sign in → load
  bootstrap data → render the trip list → create a new trip → open its
  detail view → add a passenger → confirm it appears in the table. No
  runtime errors, correct endpoints hit in the correct order.

---

## 16. Demo mode — try it without deploying a backend first
Added a complete client-side mock of the entire API (`demoFetch()`), so the
app can be tried end-to-end with zero setup — no Supabase, no Netlify
deploy for the backend, nothing.

- On the "Backend not configured" screen, a **"Try it in demo mode"**
  button switches every request over to `demoFetch()`, which replicates
  every backend route (auth, trips, passengers, users, settings,
  bulk-import) route-for-route against `localStorage` instead of Postgres.
  Same request/response shapes as the real API, same role rules (a demo
  User still can't approve a trip or delete a passenger), same trip-number
  sequencing logic.
- A "🧪 Demo" badge appears in the header and on the auth screens whenever
  it's active, plus a **"Reset demo data"** button to clear everything and
  start over.
- Data persists across page refreshes (via `localStorage`) but never
  leaves the browser and is never shared between people — this is
  explicitly a single-browser sandbox, not a substitute for the real
  backend once actually going live with a team.
- No changes needed to any handler function (`handleSaveTrip`,
  `handleSignup`, etc.) — they all already went through the single
  `apiFetch()` chokepoint, so demo mode only required teaching that one
  function to route to the mock instead of the network.
- **Caught and fixed a real bug while verifying this**: `apiFetch()`
  originally short-circuited to the demo router *before* attaching the
  `Authorization` header (that only happened in the real-fetch branch
  below it), so every demo-mode request after login looked
  unauthenticated. Found via an actual jsdom test that clicks through
  demo mode end-to-end — sign up → create a trip → add a passenger →
  submit for approval → approve it → log out → log back in → confirm the
  trip is still there — with `fetch()` itself stubbed to throw if demo
  mode ever tried to use the network. All steps pass now.

## 17. Consolidated to a single Netlify site (frontend + API together)
Previously deployed as two separate Netlify sites with CORS between them.
Reconfigured to one site: the API runs as a Netlify Function served from
the same domain as the static frontend, via an `/api/*` redirect —
same-origin, so CORS is no longer needed at all.

- Added root-level `package.json` — exists purely so Netlify's install
  step populates `node_modules` at the repo root, where the API function's
  dependencies (`express`, `pg`, etc.) resolve to via normal upward
  Node module resolution, since `backend/` itself carries no
  `node_modules` of its own.
- `netlify.toml` (root) now sets `functions = "backend/netlify/functions"`
  alongside the existing static-publish config, plus the `/api/*` →
  function redirect and esbuild bundler settings (previously only in
  `backend/netlify.toml`, which remains as documentation for anyone who'd
  rather split the two sites again).
- `index.html`'s `API_BASE` simplified from a full cross-origin URL to
  `/api`.
- **Verified locally before handing off**, not just reasoned through:
  built a temp directory mirroring the exact deploy layout (root
  `package.json`, zero `node_modules` under `backend/`), ran a real `npm
  install` at that root, then loaded `backend/netlify/functions/api.js`
  directly to confirm module resolution actually reaches the root
  `node_modules` — it does. Then invoked the Lambda-style `handler()`
  function directly (the same interface Netlify calls) against a real
  local Postgres database for both `/health` and `/auth/signup` — both
  returned correct `200`/`201` responses with a real issued JWT,
  confirming the whole chain (function loading → dependency resolution →
  Express routing → Postgres) works end-to-end under the new layout
  before ever touching the live site.

## 18. Persistent sessions — no more re-login on every page refresh
The JWT was previously kept in memory only, by design — a page refresh
meant signing in again every time. Now saved to `localStorage` and
restored automatically on load, verified against the API (`GET /auth/me`)
before trusting it.

- `saveSession()` / `clearSession()` called from every sign-in path
  (signup, login, temp-account) and on logout, storing `{ token,
  demoMode }` so a demo-mode session restores back into demo mode, not
  accidentally into real-API mode.
- On load, `restoreSession()` checks for a saved session, and if found,
  validates it against `GET /auth/me` before trusting it — an
  expired/revoked token falls back to a clean login screen with the stale
  entry removed, rather than getting stuck.
- Added the missing `GET /auth/me` handler to `demoFetch()` (the client-
  side mock), since session-restore now depends on it in both modes.
- All `localStorage` calls are wrapped in `try/catch` — if storage is
  unavailable (e.g. a sandboxed preview), the app just degrades to the
  previous behavior (session doesn't survive a refresh) instead of
  throwing.
- **Verified with jsdom**, not just reasoned through: (1) signed up, created
  a trip, then loaded a *second, completely separate* script execution
  sharing the same simulated `localStorage` — confirmed it lands signed in
  with the trip already visible, no login screen; (2) confirmed logout
  actually clears the saved session; (3) seeded `localStorage` with a
  stale/invalid token and confirmed the app correctly falls back to the
  login screen with the bad entry cleaned up, rather than hanging or
  erroring.

---

## Data shapes (as returned by the API — see `backend/README.md` for full endpoint reference)

```js
// Trip
{
  id, seq, name, type: 'open'|'private', destination,
  startDate, endDate, status: 'Draft'|'Pending'|'Approved'|'Declined'|'Cancelled'|'Completed',
  createdAt, history: [{status, date}], passengerCount
}

// Passenger
{
  id, tripId, name, dob, phone, idNumber, medicalCondition, passportNote,
  amount, depositAmount, paymentStatus: 'Pending'|'Deposit'|'Paid'|'Cancelled',
  notes, submittedAt, addedAt
}

// User (password hash never leaves the server)
{
  id, name, email, role: 'user'|'approver'|'admin', isTemp, createdAt
}

// Settings (GET /settings or the `settings` key in GET /bootstrap)
{ prefix, includeYear, padding, runningNumber, nextNumber }
```

