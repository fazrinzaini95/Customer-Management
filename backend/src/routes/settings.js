const router = require('express').Router();
const { z } = require('zod');
const { query, logActivity } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

async function sequenceInfo() {
  // Sequences can be SELECTed directly like a one-row table. is_called
  // tells us whether nextval() has ever actually been consumed — if not,
  // the next call returns last_value itself rather than last_value + 1.
  const { rows } = await query('SELECT last_value, is_called FROM trip_seq');
  const { last_value, is_called } = rows[0];
  const nextNumber = is_called ? Number(last_value) + 1 : Number(last_value);
  return { runningNumber: is_called ? Number(last_value) : 0, nextNumber };
}

// Everyone logged in needs this — it's what every trip code renders with,
// not just admins.
router.get('/', asyncHandler(async (req, res) => {
  const settingsRow = await query('SELECT data, updated_at FROM app_settings WHERE id = 1');
  const seq = await sequenceInfo();
  res.json({ ...(settingsRow.rows[0]?.data || {}), ...seq });
}));

const settingsSchema = z.object({
  prefix: z.string().min(1).max(8),
  includeYear: z.boolean(),
  padding: z.number().int().min(2).max(5),
});

router.put('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const d = settingsSchema.parse(req.body);
  const { rows } = await query(
    'UPDATE app_settings SET data = $1, updated_at = now() WHERE id = 1 RETURNING data, updated_at',
    [JSON.stringify(d)]
  );
  res.json(rows[0].data);
  logActivity({ actor: req.user, action: 'settings.updated', entityType: 'settings', entityId: null, entityLabel: 'Trip numbering format', details: d });
}));

const nextNumberSchema = z.object({ nextNumber: z.number().int().min(1) });

// Advanced: jump the counter ahead. Refuses to go below whatever number is
// already in use by an existing trip, so it can never create a collision.
router.post('/trip-sequence', requireRole('admin'), asyncHandler(async (req, res) => {
  const { nextNumber } = nextNumberSchema.parse(req.body);

  const maxRow = await query('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM trips');
  const maxExisting = Number(maxRow.rows[0].max_seq);
  if (nextNumber - 1 < maxExisting) {
    return res.status(400).json({ error: `Can't go below ${maxExisting + 1} — that would collide with an existing trip.` });
  }

  // RESTART WITH doesn't support a bound parameter in Postgres DDL — the
  // value is validated as a real integer by zod above before it ever
  // reaches string interpolation, so this stays injection-safe.
  const safeInt = Math.trunc(nextNumber);
  await query(`ALTER SEQUENCE trip_seq RESTART WITH ${safeInt}`);

  const seq = await sequenceInfo();
  res.json(seq);
  logActivity({ actor: req.user, action: 'trip_sequence.updated', entityType: 'settings', entityId: null, entityLabel: 'Trip numbering sequence', details: { nextNumber: safeInt } });
}));

module.exports = router;
