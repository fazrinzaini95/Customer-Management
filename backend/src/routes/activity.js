const router = require('express').Router();
const { query } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));

function mapEntry(row) {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    details: row.details,
    createdAt: row.created_at,
  };
}

// Most recent 200 entries — this app's scale doesn't need real pagination
// yet, and 200 comfortably covers a very active day for a small team.
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 200'
  );
  res.json(rows.map(mapEntry));
}));

module.exports = router;
