const router = require('express').Router();
const { z } = require('zod');
const { query, logActivity } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Predefined lists the whole app can suggest from: routes (per country), hotels (per country, with
// a city) and airlines. Trips and checklists keep plain free text — these lists are only suggestions,
// so renaming or deleting an item never changes a trip that already used it.
const KINDS = ['route', 'hotel', 'airline'];
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function mapItem(r) {
  return { id: r.id, kind: r.kind, country: r.country, name: r.name, city: r.city, createdAt: r.created_at };
}

// Adds the item unless one with the same kind + country + name (ignoring case) already exists.
// Used by the auto-add (anything staff type is remembered) and by trips.js when a route is saved.
async function ensureItem({ kind, country, name, city, userId }) {
  const n = clean(name).slice(0, 120);
  if (!KINDS.includes(kind) || !n) return null;
  const c = kind === 'airline' ? '' : clean(country).slice(0, 80);
  const { rows } = await query(
    `INSERT INTO list_items (kind, country, name, city, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (kind, lower(country), lower(name)) DO NOTHING
     RETURNING *`,
    [kind, c, n, clean(city).slice(0, 80), userId || null]
  );
  return rows[0] ? mapItem(rows[0]) : null;
}

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM list_items ORDER BY kind, lower(country), lower(name)');
  res.json(rows.map(mapItem));
}));

const itemSchema = z.object({
  kind: z.enum(['route', 'hotel', 'airline']),
  country: z.string().max(80).optional().or(z.literal('')),
  name: z.string().min(1).max(120),
  city: z.string().max(80).optional().or(z.literal('')),
});

// Any signed-in user: typing something new on a trip / checklist remembers it for next time.
router.post('/ensure', asyncHandler(async (req, res) => {
  const d = itemSchema.parse(req.body);
  const item = await ensureItem({ ...d, userId: req.user.id });
  res.json({ created: !!item, item });
}));

// Admin: add / rename / delete.
router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const d = itemSchema.parse(req.body);
  const item = await ensureItem({ ...d, userId: req.user.id });
  if (!item) return res.status(409).json({ error: 'That one is already in the list' });
  res.status(201).json(item);
  logActivity({ actor: req.user, action: 'list.added', entityType: 'settings', entityId: item.id, entityLabel: item.name, details: { kind: item.kind, country: item.country } });
}));

router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const d = itemSchema.partial().parse(req.body);
  const cur = await query('SELECT * FROM list_items WHERE id = $1', [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: 'Not found' });
  const name = d.name !== undefined ? clean(d.name) : cur.rows[0].name;
  const city = d.city !== undefined ? clean(d.city) : cur.rows[0].city;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const dup = await query(
    'SELECT 1 FROM list_items WHERE kind = $1 AND lower(country) = lower($2) AND lower(name) = lower($3) AND id <> $4',
    [cur.rows[0].kind, cur.rows[0].country, name, req.params.id]
  );
  if (dup.rows[0]) return res.status(409).json({ error: 'There is already one with that name — delete the duplicate instead' });
  const { rows } = await query('UPDATE list_items SET name = $1, city = $2 WHERE id = $3 RETURNING *', [name, city, req.params.id]);
  res.json(mapItem(rows[0]));
  logActivity({ actor: req.user, action: 'list.updated', entityType: 'settings', entityId: rows[0].id, entityLabel: rows[0].name, details: { kind: rows[0].kind, from: cur.rows[0].name } });
}));

router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('DELETE FROM list_items WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.status(204).send();
  logActivity({ actor: req.user, action: 'list.deleted', entityType: 'settings', entityId: rows[0].id, entityLabel: rows[0].name, details: { kind: rows[0].kind, country: rows[0].country } });
}));

module.exports = router;
module.exports.ensureItem = ensureItem;
