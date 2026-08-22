const { Pool, types } = require('pg');

// Same fix as the accounting API's db.js: without this, node-postgres turns
// SQL DATE columns into JS Date objects, which then serialize to full
// ISO timestamps instead of the plain "YYYY-MM-DD" Postgres actually
// stores. Fixing it once here means no route or frontend mapper has to
// work around it (dob, startDate, endDate, etc.).
types.setTypeParser(1082 /* DATE oid */, (val) => val);

// Supabase (and most managed Postgres) requires SSL — detected automatically
// so local Docker Postgres in development doesn't need any SSL config.
const needsSsl = /supabase|sslmode=require|render\.com|amazonaws/.test(process.env.DATABASE_URL || '');

// IMPORTANT — Supabase connection string + pool size:
// Use Supabase's CONNECTION POOLER string (port 6543, "Transaction" mode,
// found in Supabase → Project Settings → Database → Connection pooling),
// not the direct connection (port 5432). Netlify Functions can spin up
// many concurrent container instances under load, each opening its own
// Postgres connection — hitting Supabase's direct connection limit fast.
// The pooler is built for exactly this. Paired with that, `max: 1` below
// keeps each function container to a single connection rather than
// building its own multi-connection pool on top of the pooler (which
// would just move the same problem up a level).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 1,
});

pool.on('error', (err) => {
  // Log only — calling process.exit() here would kill the whole Netlify
  // Function invocation (and any other in-flight request sharing this warm
  // container), not just the one idle client that errored.
  console.error('Unexpected error on idle Postgres client', err);
});

function query(text, params) {
  return pool.query(text, params);
}

// Run a callback inside a single transaction — used wherever multiple
// statements need to succeed or fail together (e.g. the bulk-import route,
// which can create several trips and many passengers in one call).
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Records one row in activity_log. Never throws into the caller — a
// logging failure shouldn't ever block or roll back the actual action it
// was trying to record (e.g. a trip getting created successfully but the
// log write failing for some unrelated reason).
async function logActivity({ actor, action, entityType, entityId, entityLabel, details }) {
  try {
    await query(
      `INSERT INTO activity_log (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [actor.id, actor.name || actor.email, actor.email, action, entityType, entityId ?? null, entityLabel ?? null, JSON.stringify(details || {})]
    );
  } catch (err) {
    console.error('Failed to write activity log entry', err);
  }
}

module.exports = { query, withTransaction, pool, logActivity };
