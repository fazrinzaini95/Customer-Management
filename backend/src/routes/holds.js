const router = require('express').Router();
const { z } = require('zod');
const { query, logActivity } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please use a valid date').refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')), 'Please use a valid date');
const holdSchema = z.object({
  title: z.string().trim().min(1, 'Please give the hold a title').max(120),
  startDate: ymd,
  endDate: ymd,
  note: z.string().trim().max(500).optional().default(''),
}).refine((d) => d.endDate >= d.startDate, { message: 'End date cannot be before the start date' });

function mapHold(r) {
  return { id: r.id, title: r.title, startDate: String(r.start_date).slice(0, 10), endDate: String(r.end_date).slice(0, 10), note: r.note || '', createdAt: r.created_at };
}

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT id, title, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, note, created_at FROM calendar_holds ORDER BY start_date");
  res.json(rows.map(mapHold));
}));

router.post('/', asyncHandler(async (req, res) => {
  const d = holdSchema.parse(req.body);
  const { rows } = await query(
    "INSERT INTO calendar_holds (title, start_date, end_date, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, title, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, note, created_at",
    [d.title, d.startDate, d.endDate, d.note, req.user.id]
  );
  res.status(201).json(mapHold(rows[0]));
  logActivity({ actor: req.user, action: 'hold.created', entityType: 'hold', entityId: rows[0].id, entityLabel: d.title, details: { startDate: d.startDate, endDate: d.endDate } });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const d = holdSchema.parse(req.body);
  const { rows } = await query(
    "UPDATE calendar_holds SET title=$1, start_date=$2, end_date=$3, note=$4 WHERE id=$5 RETURNING id, title, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, note, created_at",
    [d.title, d.startDate, d.endDate, d.note, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Hold not found' });
  res.json(mapHold(rows[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('DELETE FROM calendar_holds WHERE id = $1 RETURNING title', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Hold not found' });
  res.status(204).send();
  logActivity({ actor: req.user, action: 'hold.deleted', entityType: 'hold', entityId: req.params.id, entityLabel: rows[0].title, details: {} });
}));

module.exports = router;
