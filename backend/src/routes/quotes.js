const router = require('express').Router();
const { z } = require('zod');
const { query, logActivity } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { defaults } = require('../quoteDefaults');

router.use(requireAuth);

const KEEP_DAYS = 14;

async function purgeOld() {
  await query(`DELETE FROM quote_drafts WHERE updated_at < now() - interval '${KEEP_DAYS} days'`);
}
async function loadSettings() {
  const { rows } = await query('SELECT data, next_no FROM quote_settings WHERE id = 1');
  const saved = rows[0]?.data || {};
  const settings = {
    company: { ...defaults.company, ...(saved.company || {}) },
    defaults: { ...defaults.defaults, ...(saved.defaults || {}) },
    terms: saved.terms && saved.terms.topics ? saved.terms : defaults.terms,
    items: Array.isArray(saved.items) ? saved.items : defaults.items,
    presets: Array.isArray(saved.presets) ? saved.presets : defaults.presets,
  };
  return { settings, nextNo: rows[0]?.next_no || 10001 };
}
function expiresAt(updatedAt) { return new Date(new Date(updatedAt).getTime() + KEEP_DAYS * 86400000).toISOString(); }
function mapRow(r, withData) {
  const o = { id: r.id, number: r.number, customer: r.customer, package: r.package, total: Number(r.total), createdByName: r.by_name || '', createdAt: r.created_at, updatedAt: r.updated_at, expiresAt: expiresAt(r.updated_at) };
  if (withData) o.data = r.data;
  return o;
}
const SEL = `SELECT d.*, COALESCE(u.username, u.name) AS by_name FROM quote_drafts d LEFT JOIN users u ON u.id = d.created_by`;

function totals(data) {
  const lines = Array.isArray(data.lines) ? data.lines : [];
  return Math.round(lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 0), 0) * 100) / 100;
}

const lineSchema = z.object({
  code: z.string().trim().max(40).optional().default(''),
  description: z.string().trim().max(200).optional().default(''),
  price: z.number().min(-100000000).max(100000000).nullable().optional(),
  qty: z.number().min(0).max(100000).nullable().optional(),
  per: z.enum(['pax', 'qty']).optional(),
});
const draftSchema = z.object({
  customer: z.object({ name: z.string().trim().max(200).optional().default(''), attn: z.string().trim().max(120).optional().default(''), contact: z.string().trim().max(120).optional().default('') }).optional().default({}),
  date: z.string().max(20).optional().default(''),
  validUntil: z.string().max(20).optional().default(''),
  pic: z.string().trim().max(60).optional().default(''),
  tripName: z.string().trim().max(200).optional().default(''),
  tripType: z.string().trim().max(40).optional().default(''),
  travelDates: z.string().trim().max(120).optional().default(''),
  pax: z.number().min(0).max(100000).nullable().optional(),
  lines: z.array(lineSchema).max(60).optional().default([]),
  remarks: z.string().max(1500).optional().default(''),
  depositPerPax: z.number().min(0).nullable().optional(),
  balanceDays: z.number().min(0).nullable().optional(),
  terms: z.any().optional(),
}).passthrough();

router.get('/bundle', asyncHandler(async (req, res) => {
  await purgeOld();
  const { settings, nextNo } = await loadSettings();
  const drafts = await query(`${SEL} ORDER BY d.updated_at DESC`);
  res.json({ settings, nextNumber: nextNo, drafts: drafts.rows.map(r => mapRow(r, false)) });
}));

router.put('/settings', requireRole('admin'), asyncHandler(async (req, res) => {
  const s = z.object({
    company: z.object({ name: z.string().max(120), address: z.string().max(400), email: z.string().max(120), phone: z.string().max(60), bank: z.string().max(80), accountNo: z.string().max(60), accountName: z.string().max(120), logo: z.string().max(400000).optional().default('') }),
    defaults: z.object({ prefix: z.string().max(12), validDays: z.number().int().min(1).max(365), depositPerPax: z.number().min(0), balanceDays: z.number().int().min(0).max(365), footer: z.string().max(200) }),
    terms: z.object({ topics: z.array(z.object({ id: z.string().max(40), title: z.string().max(80), short: z.string().max(400), full: z.string().max(2000) })).max(40), templates: z.array(z.object({ id: z.string().max(40), name: z.string().max(60), on: z.array(z.string().max(40)) })).max(12) }),
    items: z.array(z.object({ code: z.string().trim().min(1).max(40), description: z.string().trim().max(200), price: z.number().nullable().optional(), per: z.enum(['pax', 'qty']) })).max(300),
    presets: z.array(z.object({ id: z.string().max(40), name: z.string().trim().min(1).max(120), termsId: z.string().max(40).optional().default(''), remarks: z.string().max(1500).optional().default(''), lines: z.array(lineSchema).max(60) })).max(100),
    nextNumber: z.number().int().min(1).max(99999999).optional(),
  }).parse(req.body);
  const codes = new Set();
  for (const it of s.items) { const k = it.code.toLowerCase(); if (codes.has(k)) return res.status(400).json({ error: `Item code ${it.code} appears twice` }); codes.add(k); }
  const { nextNumber, ...data } = s;
  if (nextNumber != null) await query('UPDATE quote_settings SET data=$1, next_no=$2 WHERE id=1', [JSON.stringify(data), nextNumber]);
  else await query('UPDATE quote_settings SET data=$1 WHERE id=1', [JSON.stringify(data)]);
  res.json((await loadSettings()).settings);
  logActivity({ actor: req.user, action: 'quote.settings_updated', entityType: 'quote', entityId: null, entityLabel: 'Quotation settings', details: {} });
}));

router.get('/next-number', asyncHandler(async (req, res) => {
  const { settings, nextNo } = await loadSettings();
  res.json({ nextNumber: nextNo, preview: settings.defaults.prefix + nextNo });
}));

router.get('/drafts/:id', asyncHandler(async (req, res) => {
  await purgeOld();
  const { rows } = await query(`${SEL} WHERE d.id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'This draft was not found — drafts are removed 14 days after the last save' });
  res.json(mapRow(rows[0], true));
}));

router.post('/drafts', asyncHandler(async (req, res) => {
  const data = draftSchema.parse(req.body);
  const bump = await query('UPDATE quote_settings SET next_no = next_no + 1 WHERE id = 1 RETURNING next_no - 1 AS n');
  const { settings } = await loadSettings();
  const number = settings.defaults.prefix + bump.rows[0].n;
  const { rows } = await query(
    'INSERT INTO quote_drafts (number, customer, package, total, data, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [number, data.customer.name || '', data.tripName || '', totals(data), JSON.stringify(data), req.user.id]
  );
  const full = await query(`${SEL} WHERE d.id = $1`, [rows[0].id]);
  res.status(201).json(mapRow(full.rows[0], true));
}));

router.put('/drafts/:id', asyncHandler(async (req, res) => {
  const data = draftSchema.parse(req.body);
  const { rows } = await query(
    'UPDATE quote_drafts SET customer=$1, package=$2, total=$3, data=$4, updated_at=now() WHERE id=$5 RETURNING id',
    [data.customer.name || '', data.tripName || '', totals(data), JSON.stringify(data), req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'This draft was not found — drafts are removed 14 days after the last save' });
  const full = await query(`${SEL} WHERE d.id = $1`, [req.params.id]);
  res.json(mapRow(full.rows[0], true));
}));

router.delete('/drafts/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('DELETE FROM quote_drafts WHERE id = $1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Draft not found' });
  res.status(204).send();
}));

module.exports = router;
