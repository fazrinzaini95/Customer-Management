# Frontend deployment notes

This covers deploying `index.html` — the API has its own guide at
`../backend/DEPLOYMENT.md`, and needs to be live **first** since this
frontend has nothing to talk to without it.

## Before deploying: point it at the API

Open `index.html`, find `API_BASE` near the top of the `<script>` tag, and
set it to your deployed backend's URL:

```js
const API_BASE = 'https://your-api-site.netlify.app/api';
```

If this is still the placeholder value when the app loads, it shows a
"Backend not configured" screen instead of the login form — so a
misconfigured deploy is obvious immediately rather than failing silently
on every button click.

## Hosting

Any static host works — it's a single HTML file with two CDN dependencies
(SheetJS, Google Fonts), no build step.

**Netlify (this repo already includes `netlify.toml` for it):**

- **Drag and drop** — [app.netlify.com/drop](https://app.netlify.com/drop),
  drag this repo's root folder in. Fastest way to get a URL to test with.
- **Git-connected** — Netlify → **Add new site → Import an existing
  project** → this repo. Base directory: repo root (leave blank). Publish
  directory: `.` (already set via `netlify.toml`). Every push auto-redeploys.

**GitHub Pages / any other static host** — works the same way, just serve
the repo root.

## After both sites are live

Go back to the backend's Netlify site and set its `CORS_ORIGIN` environment
variable to this frontend's actual URL (e.g.
`https://excapism-manifest.netlify.app`), then redeploy the backend if it
doesn't pick the env var change up automatically. The API fails closed —
blocks all cross-origin requests — if `CORS_ORIGIN` is missing or wrong, so
until this step is done, the frontend will load but every sign-in/signup
attempt will fail with a CORS error visible in the browser console.

## Verifying it's actually working end to end

1. Open the frontend URL — should show the sign-in/create-account screen,
   not "Backend not configured."
2. Sign up with a real email — should succeed and land you in the app
   (first account becomes admin).
3. Open the browser's Network tab, create a trip — confirm you see a
   `POST` to `your-api-url/trips` returning `201`.
4. Open the same frontend URL in a different browser (or an incognito
   window) and sign in with the **same** account — you should see the
   **same** trip. That's the actual proof the shared-backend setup is
   working, as opposed to each browser silently keeping its own separate
   copy of the data (which is what happened before this was wired to a
   real API).

## Pre-launch checklist

- [ ] `API_BASE` in `index.html` points at the live backend, not
      `localhost` or the placeholder
- [ ] Backend's `CORS_ORIGIN` matches this frontend's real deployed URL
- [ ] Signed up for the real first admin account on the live URL (not a
      leftover test account from local development)
- [ ] Removed any temporary/guest accounts created while testing (Manage
      users → remove, or via the backend directly)
- [ ] Trip numbering prefix/format set in Settings if `EXC-YYYY-NNN` isn't
      what you want going forward
- [ ] Bulk-upload template in `templates/` still matches your current
      registration form's columns
