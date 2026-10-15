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

## 19. Activity log — who created, edited, or deleted what
New `activity_log` table plus an admin-only **Activity log** panel showing
the most recent 200 changes across the whole app — who did it, what it
was, and what changed.

- Logged server-side, not just in the UI: every trip create/edit/delete/
  status-change/bulk-import, passenger create/edit/delete/payment-status-
  change, user create/role-change/delete, and settings/trip-sequence
  update writes one row via a new `logActivity()` helper in `db.js`.
  A logging failure never blocks or rolls back the action itself.
- Actor name/email are snapshotted at write time (not joined live from
  `users`), and deleted trips/passengers/users are captured via
  `RETURNING *` on the delete statement itself — so the log stays
  readable even after the thing it refers to no longer exists.
- New `GET /activity` route, admin-only (`requireRole('admin')`, same as
  Manage Users).
- **Verified against a real server + Postgres**: ran all 12 action types
  through a live local instance, confirmed every entry logged with
  correct actor, correct before→after values, and correct labels even for
  deleted records — full transcript in `backend/VERIFICATION.md`. Also
  confirmed a plain User gets `403` on `GET /activity`.
- `demoFetch()` mirrors this fully for parity — same action types, same
  admin-only gate.
- **Caught and fixed a real bug during testing**: demo mode's `bootstrap`
  response returned live object references from `demoState` (a shallow
  `.slice()`, not a deep clone), so the frontend's optimistic UI update
  for payment status (setting the field *before* the "network" call
  resolves) was silently mutating the same object `demoFetch` read the
  "before" value from — logging `Paid → Paid` instead of
  `Pending → Paid`. Fixed by making `demoFetch` deep-clone every response
  via `JSON.parse(JSON.stringify(...))`, the same way a real HTTP
  response naturally would. Re-ran the jsdom test that caught it —
  confirmed the correct `Pending → Paid` transition now logs correctly.

## 20. Flight ticket tracking (post-approval)
New passenger fields — who's purchasing the ticket, its status, airline,
and booking reference — visible and editable only once a trip reaches
**Approved** status (before that, ticket booking isn't relevant yet, so
the fields and table columns stay hidden to keep Draft/Pending trips
uncluttered).

- New columns on `passengers`: `ticket_purchaser` (`'Self Purchase'` |
  `'Excapism'`), `ticket_status` (`'Pending'` | `'Purchased'`, defaults
  to `Pending`), `airline`, `booking_reference`.
- Migration is additive and idempotent (`ALTER TABLE ... ADD COLUMN IF
  NOT EXISTS`) — safe to re-run `schema.sql` against an existing database
  without touching anything else.
- New dedicated `PUT /passengers/:id/ticket-status` endpoint, matching
  the existing payment-status pattern (used by the table's inline
  dropdown, separate from the full edit modal).
- Frontend: the "Add/Edit passenger" modal and the passenger table both
  conditionally show these fields based on the *trip's* status, not the
  passenger's own state — so a passenger added back when the trip was
  still Draft correctly picks up the ticket fields the moment that trip
  gets approved.
- `demoFetch()` mirrors the new endpoint and field set for parity.
- **Verified the exact live-database scenario**: applied the pre-change
  schema first (matching your actual current database), confirmed no
  ticket columns existed, then ran the migration on top and confirmed all
  4 columns landed with correct types — followed by a full request cycle
  against a real server (create → dedicated status update → bootstrap →
  activity log) confirming every field round-trips correctly. Full
  transcript in `backend/VERIFICATION.md`.
- **Verified the frontend conditional logic with jsdom**, not just visual
  inspection: confirmed ticket fields are absent from the DOM entirely on
  a Draft trip (both the add form and the table), confirmed they appear
  immediately after approval (including retroactively, for a passenger
  created before the trip was approved), and confirmed the inline
  ticket-status dropdown correctly updates and logs the right
  before→after transition.

## 21. Public passenger self-registration links
Each trip now has a shareable link passengers can open themselves to fill
in their own details — no account, no login, and nothing else in the
system visible to them.

- New `public_token` column on `trips` — a separate, unguessable
  identifier from the trip's real ID, so the link can be shared publicly
  without exposing (or letting anyone guess at) internal IDs.
- New unauthenticated routes: `GET /public/trips/:token` (returns only
  the trip's name/destination/dates/whether it's still open for
  registration — nothing else, no other passengers, no other trips) and
  `POST /public/trips/:token/register` (creates a passenger with a
  strictly whitelisted field set — name/dob/phone/idNumber/
  medicalCondition/passportNote/notes only; amount, payment status, and
  every flight-ticket field always land at their safe defaults
  regardless of what's in the request body).
- Registration is automatically closed once a trip is Declined,
  Cancelled, or Completed.
- Frontend: a **"🔗 Share registration link"** button on the trip detail
  panel copies the link to the clipboard; the link itself
  (`?register=TOKEN`) loads a completely standalone registration page —
  it never touches login state, the trip list, or any other app data.
- `demoFetch()` mirrors both endpoints for parity.
- **Found and fixed a real, non-obvious bug during verification**: the
  new public routes were being rejected with `401 Missing or invalid
  Authorization header` even though they never call `requireAuth`.
  Root cause was an Express routing-order issue —
  `passengersRoutes` is mounted at app root (`'/'`), and
  `router.use(requireAuth)` inside it applies to *any* request reaching
  that router, which, mounted at `/`, means every request, in
  registration order, before Express even checks whether any of that
  router's own paths match. `/public` was registered after it, so every
  public request hit that gate first. This had been a latent
  architectural issue since the very first backend build — it just never
  mattered until this was the first genuinely unauthenticated route.
  Fixed by reordering `app.js`, then re-verified every previously-
  protected route (`/trips`, `/passengers/:id/payment-status`,
  `/settings`, `/bootstrap`) still correctly requires auth, confirming
  the fix didn't weaken anything else.
- **Verified end-to-end for real**: applied the exact live-database
  migration scenario (pre-existing trips, old schema, then the new
  schema on top) and confirmed each existing trip got its own distinct
  token; ran a live server and confirmed a "sneaky" registration attempt
  trying to set `amount:99999`/`paymentStatus:"Paid"` was silently
  ignored, landing with safe defaults instead; confirmed invalid tokens
  404 cleanly and closed trips correctly reject new registrations.
  Separately verified the frontend with jsdom: the public page loads
  trip info, submits correctly, shows success/closed/invalid states
  appropriately, and is confirmed genuinely isolated from the rest of
  the app (no admin nav, no sign-in screen reachable from it). Full
  transcript in `backend/VERIFICATION.md`.

## 22. Passport number + expiry (replacing the passport-link field)
Swapped the old "Passport front page" field (a link/filename text box)
for two real fields: **Passport number** and **Passport expiry date** —
on both the staff Add/Edit passenger form and the public self-
registration form.

- New `passport_number` (`TEXT`) and `passport_expiry` (`DATE`) columns
  on `passengers`. Purely additive — the old `passport_note` column is
  left in place, unused, rather than renamed or dropped, so nothing that
  was already filled in under the old field is ever lost.
- Updated everywhere the old field was referenced: `passengers.js`
  (schema, insert, update, response mapping), `bootstrap.js`,
  `public.js` (self-registration), the staff edit modal, the passenger
  table display (now shows a 🛂 icon with number + expiry date), the
  Excel export (column count correctly bumped, width array updated to
  match), bulk-upload column recognition (`HEADER_MAP`), and the
  public registration form.
- **Verified the exact live-database migration scenario**: applied the
  old schema, inserted a passenger with real data in the old
  `passport_note` column, ran the new schema on top — zero errors, both
  new columns landed correctly, and the old data was confirmed
  completely untouched (not dropped, not overwritten). Followed by a
  live server test confirming both fields round-trip correctly through
  both the authenticated and public-registration paths.
- **Verified the frontend with jsdom** on both forms: confirmed the new
  fields render, the old field IDs are genuinely gone (not just hidden),
  values save and display correctly on the staff side, and the public
  registration form sends the correct field names to the API and shows
  the success screen.

## 23. User and Approver can now delete passengers (trips stay admin-only)
Passenger deletion was previously admin-only, same as trips. Opened it up
to all three roles — **trip** deletion remains admin-only, unchanged.

- Backend: removed `requireRole('admin')` from `DELETE
  /passengers/:id` — `requireAuth` (already applied to the whole router)
  is the only gate now.
- Frontend: the ✕ delete icon in the passenger table and the "Remove
  passenger" button in the edit modal are no longer gated behind
  `isAdmin()` — visible to any logged-in role.
- `demoFetch()`'s equivalent handler updated to match.
- Updated the Manage Users panel's role-description text to reflect the
  new split.
- **Verified against a real server**: confirmed a plain User can now
  delete a passenger (`204`), confirmed that same User is still
  correctly blocked from deleting the *trip* itself (`403`, unchanged
  behavior), and confirmed Admin can still delete passengers too — all
  three checked in one live sequence, not assumed from the code change
  alone. Also verified with jsdom that a User-role session actually sees
  both delete controls rendered in the UI.

## 24. Show who created each trip
Trip detail header now shows "Created by [name]" under the destination/
dates line, whenever the creator is known.

- `trips.created_by` was already stored on every trip (used internally
  since the very first backend build) but never surfaced to the
  frontend — now joined against `users` and returned as `createdByName`
  on every trip response: create, single-trip fetch, list, edit,
  status-change, and bootstrap.
- **Found and fixed a real bug during implementation**: a naive
  `UPDATE ... RETURNING *` doesn't include a joined column, and the
  frontend merges API responses into its local trip objects via object
  spread — so editing a trip or changing its status would have silently
  overwritten the correct creator name with `null`. Fixed using a `WITH
  updated AS (UPDATE ...) SELECT ... LEFT JOIN` pattern on both routes,
  then specifically re-verified both operations preserve the name
  correctly.
- **Also fixed an unrelated pre-existing bug found while in this file**:
  the bulk-import route's passenger insert still referenced the old
  `passport_note` column from before the passport-number migration —
  passport data submitted via bulk upload was being silently dropped.
  Fixed and re-verified.
- `demoFetch()` updated to set `createdByName` at trip creation, for
  parity.
- **Verified against a real server**: confirmed `createdByName` is
  correct on creation, on fetch, in the list, in bootstrap, and —
  critically — that it survives both an edit and a status change without
  reverting to `null`. Separately confirmed the bulk-import passport fix
  actually persists data now. Frontend verified with jsdom: the "Created
  by" line renders correctly in the trip detail header. Full transcript
  in `backend/VERIFICATION.md`.

## 25. Grid / List view toggle for the trips overview
Two "▦ Grid" / "☰ List" buttons at the right of the toolbar switch
between the existing boarding-pass-style cards and a compact table —
useful once there are enough trips that the card grid takes a lot of
scrolling. List view shows Code, Trip name + destination, Type, Dates,
Status, Pax, and Paid count per row; clicking a row opens that trip's
detail view, same as clicking a card.

- New `view.layout` state (`'grid'` default | `'list'`), reset to grid
  on login/signup/logout like the rest of `view`.
- `listHTML()` branches on `view.layout` — the toolbar (search, status/
  type filters, and the new toggle) is shared between both; only what's
  below it changes.
- **Found and fixed a real, pre-existing bug while building this** (not
  introduced by the toggle itself, but exposed by testing it):
  `renderListOnly()` — used to update the trip list live while typing in
  the search box, without losing input focus — swaps in a new DOM
  subtree but was never re-attaching click handlers to it. That meant
  any trip card or row shown *after* typing a search term was silently
  unclickable, in both the old grid view and the new list view. Fixed
  by explicitly reattaching the `data-open-trip` and empty-state
  "+ New trip" handlers to the freshly swapped-in content.
- **Verified with jsdom**: confirmed the toggle switches views and the
  active button highlights correctly; confirmed search correctly
  filters rows while in list view and stays in list mode (doesn't
  silently revert to grid); confirmed a list row clicked *after*
  searching correctly opens the trip detail (the exact case that was
  broken); then separately re-confirmed the identical fix also restores
  correct click behavior for grid-view cards after a search, as a
  regression check on the pre-existing bug.

## 26. Public registration: uppercase names, flight-dependent passport, multi-passenger, review step
Several improvements to the self-registration link, all scoped to the
public form only:

- **Full name forced to uppercase** — visually via `text-transform:
  uppercase` on the input, and enforced for real (not just display) both
  client-side on submit and server-side on insert, so the stored value
  is genuinely uppercase regardless of what was typed.
- **"I'd like Excapism to arrange my flight ticket" checkbox** per
  passenger — checking it reveals Passport number + Passport expiry
  date as *required* fields (marked `*required`); leaving it unchecked
  keeps those fields hidden and optional, as before. Maps to
  `ticketPurchaser: 'Excapism'` server-side when checked, `null`
  otherwise — never trusts an arbitrary string from an unauthenticated
  caller for this.
- **"+ Add another passenger"** — the form now supports registering
  multiple people (e.g. a family) in one link visit. Each passenger gets
  their own block with a "✕ Remove" button once there's more than one.
  Typed values are preserved correctly when adding, removing, or
  toggling the flight checkbox for any block, via a `syncPublicFormFromDOM()`
  step before every re-render.
- **Review step before submitting** — "Review registration" validates
  every passenger (name required; passport required if flight
  requested) and, if all clear, shows a read-only summary of everyone
  entered before the final "Confirm & submit". "← Back to edit" returns
  to the form with everything still filled in.
- Backend: `POST /public/trips/:token/register` now accepts `{
  passengers: [...] }` (was a single object) and inserts the whole
  batch inside a transaction — **all-or-nothing**, so one invalid entry
  can't leave a trip half-registered with only some of the family added.
  Response returns `{ names: [...] }` for the success screen.
- `errorHandler.js` improved to surface the actual Zod validation
  message (e.g. the passport-required message) instead of a generic
  "Validation failed" — benefits every route's error messages, not just
  this one.
- `demoFetch()` mirrors the batch endpoint and validation for parity.
- **Verified against a real server + Postgres**: confirmed server-side
  uppercase enforcement independent of the client; confirmed the
  flight-without-passport rejection returns the specific message;
  confirmed a 3-passenger batch succeeds together; and — the critical
  check — confirmed a batch with one invalid entry among two valid ones
  results in **zero** passengers inserted, not a partial success. Full
  transcript in `backend/VERIFICATION.md`.
- **Verified the frontend with an 18-point jsdom test**: add/remove
  passengers with data preservation, the flight checkbox correctly
  showing/hiding passport fields, being blocked from reaching review
  with missing required fields, the review screen correctly displaying
  uppercased names and flight status, "back to edit" preserving all
  data, and the final submitted payload matching exactly what was
  entered.

## 27. Save-before-commit passenger edits, "Last edited by", PIC tracking, sortable columns
Four changes to the passenger list and trip detail:

- **Inline edits now require an explicit Save.** The Payment status and
  Ticket status dropdowns in the passenger table used to save
  immediately on change. Now, changing either just updates a local draft
  — the row highlights and shows **💾 Save** / **Cancel** buttons in
  place of the usual Edit/Delete icons. Nothing reaches the server until
  Save is clicked; Cancel discards the draft and reverts the dropdown.
  Both fields save together in one `PUT /passengers/:id` call.
- **"Last edited by [name] · [date]"** now shows in the trip detail
  header, under "Created by" — only when different from the creator, to
  avoid showing the same name twice on an unedited trip. New
  `last_edited_by`/`last_edited_at` columns on `trips`, stamped on every
  edit *and* every status change (submitting for approval, approving,
  etc. all count).
- **PIC (person in charge) on every passenger.** New `pic_id` column on
  `passengers`, resolved to a name via join, shown as its own column in
  the table (always visible, unlike the ticket columns) and included in
  the Excel export.
  - Staff who manually add a passenger are automatically credited as
    PIC — nothing to fill in.
  - The "🔗 Share registration link" button now embeds the sharing staff
    member's id in the link (`&pic=...`); anyone who registers through
    that link gets that staff member set as PIC automatically. The id is
    never trusted at face value — resolved against real accounts
    server-side, and silently ignored (not an error) if it's missing,
    stale, or tampered with, so a bad link can never block a passenger
    from registering.
  - PIC is set once at creation and never reassigned by later edits —
    it answers "who brought this passenger on," not "who last touched
    this row."
- **Every column in both tables is now sortable** — the passenger table
  (Name, Contact, Amount, Deposit, Payment status, PIC, and the
  ticket-related columns when shown) and the trip list-view table (Code,
  Trip, Type, Dates, Status, Pax, Paid). Click a header to sort by it,
  click again to reverse; the active column shows an arrow. Status
  columns sort by workflow order (Draft → ... → Completed / Pending →
  Purchased) rather than alphabetically.
- **Found and fixed the same latent bug a second time**: the sort
  headers in the trip list-view table weren't being reattached after a
  live search re-render (the same `renderListOnly()` issue caught and
  fixed for row clicks two updates ago) — fixed the same way, by
  explicitly reattaching sort-header handlers to the freshly swapped-in
  content.
- **Verified against a real server + Postgres**: the live-database
  migration scenario for both new columns; two separate staff accounts
  confirming `createdByName` stays fixed while `lastEditedByName`
  correctly updates on both edits and status changes; staff-added
  passengers auto-credited as PIC; public registration with a valid,
  missing, and *fabricated* `picUserId` all behaving correctly (the
  fabricated case doesn't error, PIC just stays blank). Full transcript
  in `backend/VERIFICATION.md`.
- **Verified the frontend with jsdom** across three separate test runs:
  sorting (ascending, toggle-to-descending, multiple column types, both
  tables), the save/cancel draft pattern (confirming zero API calls
  happen just from changing a dropdown, exactly one call on Save, full
  revert on Cancel), and the complete share-link-to-registration loop
  (the generated link contains the right id, the registration page reads
  it back out of the URL and sends it as `picUserId`).

## 28. Keyword filter for the passenger table, sort type corrections
Added a live keyword filter to the passenger table (there wasn't one
before — only the trip list had search), and corrected 3 of the 9
column sort types to match the intended behavior exactly.

- **Filter by keyword** — a new search box above the passenger table
  matches against name, contact, IC/passport, payment status, PIC,
  ticket purchaser, airline, booking reference, ticket status, and
  notes. Filters live as you type.
- **Sort type corrections**: Contact now sorts **numerically** (strips
  non-digit characters and compares as a number, so `012-3456789` sorts
  correctly relative to other numbers rather than as raw text — this
  matters because phone numbers of different lengths/formats don't sort
  correctly as plain strings). Payment status and Ticket status now sort
  **alphabetically** (previously sorted by workflow order — Draft-style
  progression — which doesn't match "sort by alphabet"). Name, PIC,
  Ticket purchaser, and Airline were already alphabetical; Amount and
  Deposit were already numerical — those five were untouched.
- **Refactored passenger row rendering** into a standalone
  `passengerRowsHTML(t)` function, shared between the full trip-detail
  render and a new lightweight `renderPassengerTableOnly()` that swaps
  only the `<tbody>` — the same technique already used for the trip
  list's search box, applied here so the keyword filter doesn't lose
  input focus/cursor position on every keystroke the way a full
  `render()` would.
- Consolidated the passenger row's interactive elements (payment/ticket
  status dropdowns, Save/Cancel, Edit, Delete) into one
  `bindPassengerRowHandlers()` function used by both the full render and
  the lightweight one — removes duplicated handler logic and, more
  importantly, means there's exactly one place these can go stale
  instead of two.
- **Verified with jsdom**: confirmed the filter input's DOM node is
  never recreated and stays focused through repeated live-typing
  updates (the exact failure mode of the `renderListOnly()` bug found
  and fixed twice before — deliberately tested for it here rather than
  assuming the refactor avoided it); confirmed filtering by name, PIC,
  and airline keywords all correctly narrow the list and clearing the
  filter restores everyone; and individually verified all 9 sort
  columns produce the correct order, including confirming the two
  corrected columns (Contact numerically, Payment/Ticket status
  alphabetically) against data specifically chosen to catch a
  workflow-order-vs-alphabetical mistake.

---

## 29. Payment and Balance tracking
Payments were only ever tracked as Amount + Deposit paid, with no way to
record a partial or full payment of what's left after the deposit. Added
two new columns, in this order, right after Deposit paid:

**Package amount → Deposit paid → Payment → Balance**, where
**Balance = Package amount − Deposit paid − Payment** (floored at 0).

- **Payment** (new `balance_paid` column) — how much has been paid
  towards the balance (beyond the deposit) so far. Tracked the same way
  deposit amount is: editable in the Add/Edit passenger modal, its own
  sortable table column, included in the Excel export.
- **Balance** — a computed column, not stored; recalculated from the
  other three fields everywhere it's shown (table, modal, Excel export)
  so it's never out of sync. In the Add/Edit passenger modal it's a
  disabled, read-only field that live-updates as Package amount, Deposit
  paid, or Payment change.
- **Collected** stat on the trip detail page now also counts Payment for
  passengers with payment status "Deposit" (previously only counted the
  deposit itself for that status) — so a passenger who's paid the
  deposit and part/all of the balance is reflected accurately, not just
  undercounted until marked fully "Paid".
- Both passenger table headers and columns grew from 7→9 (9→12 with
  flight-ticket columns visible) to fit the two new columns; `colCount`
  (used for the "no passengers" empty-state colspan) updated to match.
- Schema: `passengers.balance_paid NUMERIC(12,2) NOT NULL DEFAULT 0`,
  added via `IF NOT EXISTS` migration — safe to re-run on an existing
  database. (Internal column name is unchanged from the first cut of
  this feature — only the displayed label, column order, and the
  Balance formula changed.)

---

## 30. Balance stat card on the trip page
Added a 5th stat card — **Balance** — to the trip detail page's stats
row, right after Collected: `Balance = max(0, Expected total − Collected)`.
Gives a one-glance outstanding-amount figure for the whole trip, instead
of only per-passenger (via #29's Balance column).

---

## 31. Approvals button for approvers/admins
Approvers previously had no fast way to see which trips were waiting on
them — they had to open the trip list and manually click the "Pending"
status chip. Added an **Approvals** button to the top bar, visible only
to approver/admin roles (plain "user" accounts don't see it, since they
can't approve anyway):

- Shows a live count badge of trips currently in "Pending" status.
  Styled `btn-primary` (stands out) whenever the count is > 0, falls
  back to a plain ghost button when there's nothing to review.
- Clicking it jumps straight to the trip list, pre-filtered to
  **Pending** status, with search and type filter cleared (grid/list
  layout preference is preserved) — works from anywhere in the app,
  including from inside a trip's detail view.
- Reuses the existing status-filter chip mechanism under the hood, so
  trip list sorting/rendering behavior is unchanged — this just sets
  `view.statusFilter = 'Pending'` the same way clicking the chip does.

---

## 32. Dashboard tab
A new **Dashboard** tab next to **Trips**, summarising every trip. Computed
in the browser from the trips and passengers already loaded, so there is no
backend or database change and it works in demo mode too.

- **Filters** (one row above everything, and every number below follows
  them): Year, Month, Trip type, Status, plus Reset filters.
- **Tiles**: Total trips, Trips this month (starting this month and not yet
  ended), Upcoming trips (not completed, end date not passed), Awaiting
  approval (clickable for approvers/admins), Total passengers, Total amount,
  Total payment (with % collected) and Outstanding balance.
- **Chart/table by year or month** with a Passengers / Trips / Amount /
  Collected switch: by year when "All years" is selected, by month once a
  year is picked. Hover for the exact value; a Table view is one click away.
- **Yearly summary** table (click a year to filter), **Next departures**
  (opens the trip; Back returns to the dashboard; a warning shows when a
  balance is due within 30 days), **Needs attention** (trips awaiting
  approval, flight tickets to purchase, departing within 30 days with a
  balance due, upcoming trips with no passengers), trips by status,
  passengers by payment status, open vs private, and top destinations
  (e.g. "Medan (4D3N)" and "Medan (3D2N)" count as one Medan).
- Rules: Year is the year in the trip code. Declined/Cancelled trips are
  left out of passengers and money unless you filter to them. Money uses the
  same rules as each trip page (Paid = full amount, Deposit = deposit +
  payment), through one shared `paidOf()` that the trip page now uses too.
- Verified with jsdom against hand-calculated data (every tile, every
  filter, trip-page reconciliation) and by rendering it in Chromium at
  desktop, tablet and phone widths.

---

## 33. Calendar tab

New third tab, **Calendar**, a monthly calendar of trips by date (frontend only, `index.html`).

- Each trip is a bar labelled with its **trip name**, spanning start to end date; trips crossing a week or month boundary continue with ◂ / ▸ markers. Bars are colour-coded by status; overlapping trips stack in lanes.
- Navigation: ‹ / › buttons, **Today**, month and year dropdowns, and keyboard shortcuts (← / → or PageUp / PageDown, **T** for today).
- Filters: All / Open / Private; declined and cancelled trips are hidden unless switched on.
- Click a bar or an agenda row to open the trip; **← Calendar** brings you back to the same month.
- An agenda list under the grid shows the month's trips with dates, status and pax. An empty month offers jump buttons to the nearest months with trips.
- Trips with no start date are skipped.

## 34. Trip form: country dropdown, single-calendar dates, status routing

- **Country dropdown** (New/Edit trip): searchable list of countries with a ★ beside each name. Pinned by default: Indonesia, Vietnam, Thailand, New Zealand. A country used on more than 5 trips is pinned automatically (counted from the trips themselves). Pins/unpins are saved per user in the browser. Older free-text locations still show and save unchanged on edit.
- **Dates**: start and end are chosen in one calendar. Click start then end, or drag from start to end; works across months; shows the number of days/nights.
- **Edit trip -> Status**: approvers and admins can set any status; users can set only Draft or Pending. Enforced on the server: `POST /trips/:id/status` accepts `override: true` (backend/src/routes/trips.js). The normal workflow buttons are unchanged.

## 35. New trip flow: Payment status + Operations sub-status (replaces the approval status)

- Main status: **Draft -> Pending Payment -> Paid**, or **Cancelled**. New trips are Draft; **Submit** moves a trip to Pending Payment; it shows **Paid** automatically once the balance is zero (and goes back to Pending Payment if the balance rises again, e.g. a new passenger); an approver/admin **Decline trip** cancels it. Stored values are still Draft / Pending / Cancelled (older Approved/Completed trips count as submitted, Declined as Cancelled).
- **Operations** sub-status: starts at **Pending Ops** automatically on Submit. Approvers/admins route it Pending Ops -> Ongoing -> Ready -> Completed, or On-hold / Rejected at any stage (trip page buttons, or Edit trip). Users can see it but not change it. Server-checked (`POST /trips/:id/ops-status`).
- The old Approve / Complete / Approval status controls are gone. The header **Actions needed** button (approvers/admins) counts submitted trips still at Pending Ops and opens them.
- Homepage grid and list show the main status, Operations and balance; filter chips for both; Dashboard, Calendar and registration links updated (registration closes when Operations is Completed or Rejected). Flight-ticket columns appear once Operations is Ongoing or later.
- **Money fix:** one rule everywhere. Collected = deposit + payment (or the full amount if the passenger is marked Paid), whatever the status dropdown says; Cancelled passengers are not counted; trip balance = sum of each passenger's balance. Previously the passenger table and the trip totals could disagree.
- Files: index.html, backend/src/routes/trips.js, bootstrap.js, public.js. Needs the `ops_status` column from entry 34 (the `pay_status` column is no longer used).

## 36. Passenger Payment status is now automatic

- The Payment status dropdown is removed. Status follows the money columns: Deposit paid with no Payment -> Deposit; any Payment (with or without Deposit) -> Pending; Balance zero -> Paid. Cancelled passengers stay Cancelled.
- The Deposit column now always shows the deposit amount. The edit-passenger form shows the status live as you type.
- Files: index.html only.

## 37. "Actions needed" now includes On-hold

- A submitted trip needs action when it is Pending Payment, or its Operations status is Pending Ops, Ongoing or On-hold. Ready, Completed and Rejected trips that are fully paid drop off the list.
- Files: index.html only.

## 38. Operations checklist (accommodation, flights, add-ons)

- New collapsible "Operations checklist" inside the Operations panel of every submitted trip. Simple view: one row per passenger with tick boxes (Accommodation, Flight to, Flight return, Add-ons) and an n/4 count; Detailed / Full screen view adds hotel, room type, room number, airline, ref, departure, arrival, luggage (to and return) and an add-ons note.
- Hotels and flights are entered once per trip ("Edit hotels & flights") then assigned to passengers; tick passengers and pick a hotel/flight to assign many at once. Header tick boxes tick a whole column.
- Approvers/admins edit (autosaves); users view only. Cancelled passengers are left out.
- Backend: new `trips.ops_checklist` JSONB column (run the SQL in schema.sql), `PATCH /trips/:id/ops-checklist` (merges per passenger/field), included in bootstrap + trip responses.
- Files: index.html, backend/src/routes/trips.js, bootstrap.js, backend/db/schema.sql.

## 39. Payment history (instalments) per passenger

- The Payment cell in the passenger list has a "🧾 N payments" link opening a payment history: date, amount, note per instalment, with the deposit shown as the first (read-only) line, live totals, balance and a progress bar.
- `Payment` (balancePaid) is always the sum of the history, so Balance, Payment status, trip totals, dashboard and export are unchanged. Edit Passenger shows Payment as read-only.
- Passengers with an existing Payment get an "Earlier payment" line for it (no data migration needed).
- Backend: `passengers.payments` JSONB column, `PUT /passengers/:id/payments` (recomputes balance_paid + payment status), included in bootstrap and passenger responses.
- Files: index.html, backend/src/routes/passengers.js, bootstrap.js, backend/db/schema.sql.

## 40. Cancelled passengers, refunds and delete protection

- Edit Passenger has **Cancel passenger / Reinstate passenger**. Cancelled passengers stay out of the trip totals as before.
- A cancelled passenger's payment history gets a **Type** per line: Payment, **Refund** (money returned) or **Kept** (e.g. a cancellation fee). The summary shows Paid in / Refunded / Kept / **Still held**; whatever is still held shows as "Refund due" on the passenger row and as a "Refund due" card on the trip. No refund policy is built in — record whatever you decide, case by case.
- Refund/Kept lines never change the passenger's Payment figure and are only accepted for cancelled passengers.
- A passenger with a deposit, payment or payment history can no longer be removed (app and server) — cancel them instead. Excel export gains Refunded, Kept and Refund Due columns.
- Files: index.html, backend/src/routes/passengers.js.

## 41. Dashboard: refunds, and passenger counts

- New dashboard row: **Refund due**, **Refunded** and **Kept**, plus a "Refunds to settle" list (passenger, trip, paid in, refunded, kept, still held; click a row to open the trip). Covers cancelled passengers and passengers on cancelled trips.
- Refund / Kept lines can now also be recorded for passengers on a cancelled trip (server and app).
- Passenger counts everywhere (dashboard, trip list/grid, trip page, empty-trip check) now leave out cancelled passengers; the trip page shows "+ n cancelled" under Passengers.
- Files: index.html, backend/src/routes/passengers.js.

## 42. Operations runs automatically + checklist filter / sort / group / bulk assign

- Operations status is now automatic: Pending Ops (default) -> Ongoing (two or more checklist details filled in) -> Ready (every required tick ticked for every passenger) -> Completed (after the trip's end date). Manual routing and the Operations select in Edit Trip are removed.
- On-hold and Rejected stay manual, ask for a reason (shown on the trip, logged in the activity log) and take priority until the trip is Resumed.
- Add-ons tick is optional unless the passenger has an add-on note.
- Checklist: assign room type / room no. / luggage (to and return) to the selected passengers; search, filter (hotel, flights, complete/incomplete), sort (click headers) and group (hotel, room, flights, completion) with group-select.
- Dashboard "Refunds to settle" already covers completed trips.
- Public registration closes once the trip has ended or is Rejected.
- Backend: `trips.ops_reason / ops_reason_by / ops_reason_at`; `POST /trips/:id/ops-status` now only accepts Onhold / Rejected (with reason) / Pending Ops (resume).
- Files: index.html, backend/src/routes/trips.js, bootstrap.js, public.js, backend/db/schema.sql (3 new columns).

## Data shapes (as returned by the API — see `backend/README.md` for full endpoint reference)

```js
// Trip
{
  id, seq, name, type: 'open'|'private', destination,
  startDate, endDate, status: 'Draft'|'Pending'|'Approved'|'Declined'|'Cancelled'|'Completed',
  createdAt, createdByName, lastEditedByName, lastEditedAt,
  history: [{status, date}], passengerCount, publicToken
}

// Passenger
{
  id, tripId, name, dob, phone, idNumber, medicalCondition,
  passportNumber, passportExpiry,
  amount, depositAmount, paymentStatus: 'Pending'|'Deposit'|'Paid'|'Cancelled',
  ticketPurchaser: 'Self Purchase'|'Excapism'|null, ticketStatus: 'Pending'|'Purchased',
  airline, bookingReference, picName,
  notes, submittedAt, addedAt
}

// User (password hash never leaves the server)
{
  id, name, email, role: 'user'|'approver'|'admin', isTemp, createdAt
}

// Settings (GET /settings or the `settings` key in GET /bootstrap)
{ prefix, includeYear, padding, runningNumber, nextNumber }

// Activity log entry (GET /activity, admin-only)
{
  id, actorId, actorName, actorEmail,
  action, entityType: 'trip'|'passenger'|'user'|'settings'|'bulk_import',
  entityId, entityLabel, details, createdAt
}
```


## #43 — Simpler, cleaner Operations checklist (front-end only)
- One compact table instead of Simple/Detailed: Passenger · Stay · Flight to · Flight return · Add-ons, with one round tick per section.
- Flight details (airline/ref/times) shown once under the dropdown instead of 4 extra columns each.
- Quiet inputs (grey until hover/focus), progress bar in header, green edge on completed rows.
- Search + Everyone/To do/Done + Group by on one line; Hotel/Flight filters tucked under "Filters".
- "Assign to selected" is now a floating bar that only appears when passengers are ticked.
- Fix: first click on a row checkbox was swallowed right after editing a hotel/flight name.
- No backend or SQL change.

## #44 — Checklist: one line per passenger
- Each passenger is a single ~33px row (hotel · type · room · tick | flight · luggage · tick | return · luggage · tick | note · tick), so 20 passengers fit without long scrolling. Flight times moved to the dropdown tooltip.

## #45 — Ticket columns hidden on new trips
- Ticket purchaser / Airline-Ref / Ticket status columns (and the same fields in Edit passenger) now only show on trips that already hold ticket data (a Purchased status, airline or booking ref). New trips use the Operations checklist instead.

## #46 — Ticket purchaser lives in the Operations checklist
- New "Ticket by" column per passenger in the checklist: Excapism / Self / — (stored as `ticketBy` in `trips.ops_checklist.pax`; older passengers fall back to their existing ticket purchaser).
- Filter (Ticket), Group by "Ticket (who buys)", sortable column, bulk "Ticket by…" in the assign bar, and a summary line "Tickets: n Excapism buys · n self-purchase · n not set".
- Dashboard "Flight tickets to purchase": on new trips counts Excapism-bought passengers whose Flight to / Return are not both ticked; legacy trips keep the old count.
- Backend: `PATCH /trips/:id/ops-checklist` accepts `ticketBy` ('', 'Excapism', 'Self'). No SQL needed.

## #47 — Ticket purchaser in Add / Edit passenger
- "Ticket purchased by" (Excapism buys / Self-purchase) now always appears in the Add / Edit passenger form, on every trip.
- The checklist's "Ticket by" column reads and writes this same passenger field (single source of truth) — no separate copy in the checklist data.
- Ticket status / airline / booking reference still only appear on older trips that already have ticket data.

## #48 — Operations lists (routes, hotels, airlines) + trip route + duration
- New Admin button **Operations lists**: Routes per country, Hotels per country (+ city), Airlines. Add / rename / delete; alphabetical; deleting never changes trips that used an item.
- New trip field **Location / route** under Country (stored separately in `trips.route`, so dashboard / filters / bulk upload still group by Country). Suggestions come from the list for the chosen country; free text always works.
- Free text is remembered automatically: trip routes on save, checklist hotels and airlines when you finish typing (blur/Enter). Duplicates (any capitalisation / spacing) are ignored.
- Checklist "Edit hotels & flights": hotel and airline inputs now suggest from the lists (hotels for the trip's country).
- Duration shown as e.g. **5D4N**, automatically from the trip dates (form, trip page header, list and grid).
- Trip form label "Location / country" is now just "Country".
- Backend: new `list_items` table, `trips.route`, `/lists` routes (`GET`, `POST /ensure` any user; `POST`, `PUT /:id`, `DELETE /:id` admin), lists in `/bootstrap`. SQL is in schema.sql (safe to re-run). Verified against a real PostgreSQL 16.

## #49 — Bulk upload template + importer aligned with the app
- **Fixed:** the old template could not be imported at all (headers are on row 4 but the importer read row 1). The importer now finds the header row automatically and skips the "↑ Sample row…" note line.
- **Fixed:** the "IC/Passport" column is now recognised, so IC numbers import.
- New template columns: Passport Number, Passport Expiry, Country (was "Location"), Route (optional), Ticket Purchaser (optional: Excapism / Self). Instructions sheet rewritten.
- Passengers are grouped into trips by Trip Type + Country + Route. A blank Route joins any existing trip for that country.
- Routes typed in the sheet are added to Admin > Operations lists. New trips are named "Country – Route".
- Older files still work: "Bali, Indonesia" becomes country Indonesia + route Bali.
- Backend: `/trips/bulk-import` accepts `route` and `ticketPurchaser`. No new SQL.

## #50 — Package amount & deposit in bulk upload, and bulk "Set prices"
- Template: new columns **Package Amount (RM)** and **Deposit Paid (RM)** (numbers only; "RM 2,400" also accepted). Payment status is set automatically (no deposit = Pending, some = Deposit, deposit ≥ package = Paid). The deposit goes into the passenger's normal Deposit field.
- Upload preview: per-trip Package / Deposit / Balance totals, a per-passenger table with the resulting status, and ⚠ warnings (figure not a number, deposit more than the package). Flagged figures import as RM 0; **Fix & re-upload** returns to the file picker.
- New trip button **💲 Set prices** (passenger list): pick passengers, enter package amount and/or deposit (empty box = unchanged), optional "only passengers with no package amount yet". Status is recalculated, Cancelled stays Cancelled.
- Backend: `/trips/bulk-import` accepts `amount` / `deposit`; new `PUT /trips/:tripId/pricing`. No new SQL.

## #51 — Fix: bulk upload importing every passenger twice
- Cause: the Import button stayed clickable while the import was running, so a double-click (or a second click on a slow connection) sent the same file twice and the server saved both.
- Fix: the button is disabled and shows "Importing…" until the import finishes; a second click is ignored.

## #52 — Bulk upload skips duplicates
- A passenger is treated as already in the trip when the name matches (ignoring capitals and extra spaces) and the IC/Passport does not contradict it (both filled in and different = two different people). Cancelled passengers don't count, so they can re-book.
- Applies to people already in the trip and to repeated rows inside the same file.
- Upload preview greys out skipped rows ("Skip – already in this trip"), totals and the Import button count only passengers who will really be added; after import the message says how many were skipped.
- The server enforces the same rule, so re-uploading a file can never double up. No new SQL.
