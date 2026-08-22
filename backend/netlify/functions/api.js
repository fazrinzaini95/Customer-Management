// Adapts the existing Express app (src/app.js) to run as a single Netlify
// Function, using serverless-http. No route code changes needed — every
// request Netlify forwards here (see the /api/* redirect in netlify.toml)
// gets handled by the same Express app as if it were running normally.
//
// Note on the Postgres pool: Netlify Functions reuse a "warm" container
// across nearby invocations, so the pg.Pool created in src/db.js is NOT
// re-created on every request — it persists for the life of that warm
// container. Combined with db.js's `max: 1`, each warm container holds at
// most one connection into Supabase's pooler at a time.
const serverless = require('serverless-http');
const app = require('../../src/app');

module.exports.handler = serverless(app, { basePath: '/.netlify/functions/api' });
