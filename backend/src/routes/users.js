const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, logActivity } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, isTemp: u.is_temp, createdAt: u.created_at };
}
async function adminCount() {
  const { rows } = await query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND is_active = true");
  return rows[0].n;
}

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE is_active = true ORDER BY created_at');
  res.json(rows.map(publicUser));
}));

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['user', 'approver', 'admin']).default('user'),
});

router.post('/', asyncHandler(async (req, res) => {
  const d = createSchema.parse(req.body);
  const existing = await query('SELECT 1 FROM users WHERE email = $1', [d.email]);
  if (existing.rows.length) return res.status(409).json({ error: 'That email is already registered' });

  const passwordHash = await bcrypt.hash(d.password, 10);
  const { rows } = await query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING *',
    [d.name, d.email, passwordHash, d.role]
  );
  res.status(201).json(publicUser(rows[0]));
  logActivity({ actor: req.user, action: 'user.created', entityType: 'user', entityId: rows[0].id, entityLabel: rows[0].email, details: { role: rows[0].role } });
}));

const roleSchema = z.object({ role: z.enum(['user', 'approver', 'admin']) });

router.put('/:id/role', asyncHandler(async (req, res) => {
  const { role } = roleSchema.parse(req.body);

  const current = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'User not found' });

  if (current.rows[0].role === 'admin' && role !== 'admin' && (await adminCount()) <= 1) {
    return res.status(400).json({ error: 'At least one admin is required' });
  }

  const { rows } = await query('UPDATE users SET role = $1 WHERE id = $2 RETURNING *', [role, req.params.id]);
  res.json(publicUser(rows[0]));
  logActivity({ actor: req.user, action: 'user.role_changed', entityType: 'user', entityId: rows[0].id, entityLabel: rows[0].email, details: { from: current.rows[0].role, to: role } });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't remove your own account" });
  }
  const target = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!target.rows[0]) return res.status(404).json({ error: 'User not found' });

  if (target.rows[0].role === 'admin' && (await adminCount()) <= 1) {
    return res.status(400).json({ error: 'At least one admin is required' });
  }

  await query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.status(204).send();
  logActivity({ actor: req.user, action: 'user.deleted', entityType: 'user', entityId: target.rows[0].id, entityLabel: target.rows[0].email, details: { role: target.rows[0].role } });
}));

module.exports = router;
