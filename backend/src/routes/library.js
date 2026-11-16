const router = require('express').Router();
const { z } = require('zod');
const { query, logActivity } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

const packSchema = z.object({
  country: z.string().trim().min(1, 'Please enter the country').max(80),
  place: z.string().trim().max(80).optional().default(''),
  title: z.string().trim().min(1, 'Please enter a title').max(160),
  tripType: z.string().trim().max(40).optional().default(''),
  price: z.number().min(0).max(10000000).nullable().optional(),
  tags: z.string().trim().max(300).optional().default(''),
  archived: z.boolean().optional().default(false),
  messages: z.array(z.object({
    id: z.string().max(40).optional(),
    label: z.string().trim().max(80).optional().default(''),
    text: z.string().max(4000).optional().default(''),
  })).max(20).optional().default([]),
});

const fileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mime: z.string().regex(/^(image\/(png|jpeg|webp)|application\/pdf)$/, 'Only PNG, JPG, WEBP or PDF files can be uploaded'),
  size: z.number().int().min(0).max(8000000).optional().default(0),
  thumb: z.string().max(60000).optional().default(''),
  data: z.string().min(10).max(4800000, 'That file is too large (limit about 3 MB)'),
});

function mapPack(r, files) {
  return {
    id: r.id, country: r.country, place: r.place, title: r.title, tripType: r.trip_type,
    price: r.price == null ? null : Number(r.price), tags: r.tags, archived: r.archived,
    messages: r.messages || [], files: files || [], updatedAt: r.updated_at, updatedBy: r.updated_by_name || '',
  };
}
const SEL = `SELECT p.*, COALESCE(u.username, u.name) AS updated_by_name FROM library_packs p LEFT JOIN users u ON u.id = p.updated_by`;

router.get('/', asyncHandler(async (req, res) => {
  const packs = await query(`${SEL} ORDER BY lower(p.country), lower(p.place), lower(p.title)`);
  const files = await query('SELECT id, pack_id, name, mime, size, thumb FROM library_files ORDER BY created_at');
  const by = {};
  files.rows.forEach(f => { (by[f.pack_id] = by[f.pack_id] || []).push({ id: f.id, name: f.name, mime: f.mime, size: f.size, thumb: f.thumb }); });
  res.json(packs.rows.map(r => mapPack(r, by[r.id])));
}));

router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const d = packSchema.parse(req.body);
  const msgs = d.messages.map((m, i) => ({ id: m.id || ('m' + Date.now().toString(36) + i), label: m.label, text: m.text }));
  const { rows } = await query(
    'INSERT INTO library_packs (country, place, title, trip_type, price, tags, messages, archived, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id',
    [d.country, d.place, d.title, d.tripType, d.price == null ? null : d.price, d.tags, JSON.stringify(msgs), d.archived, req.user.id]
  );
  const full = await query(`${SEL} WHERE p.id = $1`, [rows[0].id]);
  res.status(201).json(mapPack(full.rows[0], []));
  logActivity({ actor: req.user, action: 'library.created', entityType: 'library', entityId: rows[0].id, entityLabel: d.title, details: {} });
}));

router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const d = packSchema.parse(req.body);
  const msgs = d.messages.map((m, i) => ({ id: m.id || ('m' + Date.now().toString(36) + i), label: m.label, text: m.text }));
  const { rows } = await query(
    'UPDATE library_packs SET country=$1, place=$2, title=$3, trip_type=$4, price=$5, tags=$6, messages=$7, archived=$8, updated_by=$9, updated_at=now() WHERE id=$10 RETURNING id',
    [d.country, d.place, d.title, d.tripType, d.price == null ? null : d.price, d.tags, JSON.stringify(msgs), d.archived, req.user.id, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Pack not found' });
  const full = await query(`${SEL} WHERE p.id = $1`, [req.params.id]);
  const files = await query('SELECT id, name, mime, size, thumb FROM library_files WHERE pack_id = $1 ORDER BY created_at', [req.params.id]);
  res.json(mapPack(full.rows[0], files.rows));
  logActivity({ actor: req.user, action: 'library.updated', entityType: 'library', entityId: req.params.id, entityLabel: d.title, details: {} });
}));

router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('DELETE FROM library_packs WHERE id = $1 RETURNING title', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Pack not found' });
  res.status(204).send();
  logActivity({ actor: req.user, action: 'library.deleted', entityType: 'library', entityId: req.params.id, entityLabel: rows[0].title, details: {} });
}));

router.post('/:id/files', requireRole('admin'), asyncHandler(async (req, res) => {
  const d = fileSchema.parse(req.body);
  const cnt = await query('SELECT count(*)::int AS n FROM library_files WHERE pack_id = $1', [req.params.id]);
  if (cnt.rows[0].n >= 10) return res.status(400).json({ error: 'A pack can hold up to 10 files' });
  const pack = await query('SELECT id FROM library_packs WHERE id = $1', [req.params.id]);
  if (!pack.rows[0]) return res.status(404).json({ error: 'Pack not found' });
  const { rows } = await query(
    'INSERT INTO library_files (pack_id, name, mime, size, thumb, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, mime, size, thumb',
    [req.params.id, d.name, d.mime, d.size, d.thumb, d.data]
  );
  await query('UPDATE library_packs SET updated_by=$1, updated_at=now() WHERE id=$2', [req.user.id, req.params.id]);
  res.status(201).json(rows[0]);
}));

router.get('/files/:fid', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, name, mime, data FROM library_files WHERE id = $1', [req.params.fid]);
  if (!rows[0]) return res.status(404).json({ error: 'File not found' });
  res.json({ id: rows[0].id, name: rows[0].name, mime: rows[0].mime, dataUrl: rows[0].data });
}));

router.put('/files/:fid/thumb', requireRole('admin'), asyncHandler(async (req, res) => {
  const d = z.object({ thumb: z.string().max(60000) }).parse(req.body);
  const { rows } = await query('UPDATE library_files SET thumb = $1 WHERE id = $2 RETURNING id', [d.thumb, req.params.fid]);
  if (!rows[0]) return res.status(404).json({ error: 'File not found' });
  res.json({ id: rows[0].id, thumb: d.thumb });
}));

router.delete('/files/:fid', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('DELETE FROM library_files WHERE id = $1 RETURNING pack_id', [req.params.fid]);
  if (!rows[0]) return res.status(404).json({ error: 'File not found' });
  await query('UPDATE library_packs SET updated_by=$1, updated_at=now() WHERE id=$2', [req.user.id, rows[0].pack_id]);
  res.status(204).send();
}));

module.exports = router;
