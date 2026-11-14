const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, logActivity } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));

function publicUser(u) {
  return {
    id: u.id, name: u.username || u.name, username: u.username || null, fullName: u.name, initials: u.initials || null,
    email: u.email, role: u.role, isTemp: u.is_temp, mustChangePassword: !!u.must_change_password, createdAt: u.created_at,
  };
}
function makeInitials(s) {
  const w = String(s || '').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || '').charAt(0) + (w[1] || '').charAt(0)).toUpperCase() || String(s || '?').charAt(0).toUpperCase();
}
const usernameRule = z.string().trim().min(2, 'Username must be at least 2 characters')
  .regex(/^[A-Za-z0-9._-]+$/, 'Username can only use letters, numbers, dot, dash and underscore');
function tempPassword() {
  return require('crypto').randomBytes(6).toString('base64url');
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
  username: usernameRule,
  name: z.string().trim().optional(),
  email: z.string().email('Please enter a valid email'),
  initials: z.string().trim().max(4).optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),   // blank = generate a temporary one
  role: z.enum(['user', 'approver', 'admin']).default('user'),
});

router.post('/', asyncHandler(async (req, res) => {
  const d = createSchema.parse(req.body);
  const dupEmail = await query('SELECT 1 FROM users WHERE email = $1', [d.email]);
  if (dupEmail.rows.length) return res.status(409).json({ error: 'That email is already registered' });
  const dupUser = await query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [d.username]);
  if (dupUser.rows.length) return res.status(409).json({ error: 'That username is already taken' });

  const plain = d.password || tempPassword();
  const passwordHash = await bcrypt.hash(plain, 10);
  const { rows } = await query(
    'INSERT INTO users (name, username, initials, email, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *',
    [d.name || d.username, d.username, (d.initials || makeInitials(d.name || d.username)).toUpperCase(), d.email, passwordHash, d.role]
  );
  res.status(201).json({ ...publicUser(rows[0]), tempPassword: plain });
  logActivity({ actor: req.user, action: 'user.created', entityType: 'user', entityId: rows[0].id, entityLabel: rows[0].username, details: { role: rows[0].role } });
}));

// Admin edits someone's particulars: username, full name, email, initials.
const editSchema = z.object({
  username: usernameRule.optional(),
  name: z.string().trim().min(1, 'Name cannot be empty').optional(),
  email: z.string().email('Please enter a valid email').optional(),
  initials: z.string().trim().min(1, 'Initials cannot be empty').max(4, 'Initials: up to 4 letters').optional(),
});
router.patch('/:id', asyncHandler(async (req, res) => {
  const d = editSchema.parse(req.body);
  const cur = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: 'User not found' });
  if (d.email && d.email.toLowerCase() !== String(cur.rows[0].email).toLowerCase()) {
    const dup = await query('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [d.email, req.params.id]);
    if (dup.rows.length) return res.status(409).json({ error: 'That email is already registered' });
  }
  if (d.username && d.username.toLowerCase() !== String(cur.rows[0].username || '').toLowerCase()) {
    const dup = await query('SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2', [d.username, req.params.id]);
    if (dup.rows.length) return res.status(409).json({ error: 'That username is already taken' });
  }
  const next = {
    username: d.username ?? cur.rows[0].username, name: d.name ?? cur.rows[0].name,
    email: d.email ?? cur.rows[0].email, initials: (d.initials ?? cur.rows[0].initials ?? '').toUpperCase() || null,
  };
  const { rows } = await query(
    'UPDATE users SET username=$1, name=$2, email=$3, initials=$4 WHERE id=$5 RETURNING *',
    [next.username, next.name, next.email, next.initials, req.params.id]
  );
  res.json(publicUser(rows[0]));
  logActivity({ actor: req.user, action: 'user.updated', entityType: 'user', entityId: rows[0].id, entityLabel: rows[0].username, details: { fields: Object.keys(d) } });
}));

// Admin resets a password: give one, or leave blank to generate a temporary one.
// The person must choose their own at next sign-in. The plain password is returned ONCE.
router.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const d = z.object({ password: z.string().min(6, 'Password must be at least 6 characters').optional() }).parse(req.body || {});
  const cur = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: 'User not found' });
  const plain = d.password || tempPassword();
  const hash = await bcrypt.hash(plain, 10);
  await query('UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2', [hash, req.params.id]);
  res.json({ tempPassword: plain });
  logActivity({ actor: req.user, action: 'user.password_reset', entityType: 'user', entityId: cur.rows[0].id, entityLabel: cur.rows[0].username || cur.rows[0].email, details: {} });
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
  logActivity({ actor: req.user, action: 'user.role_changed', entityType: 'user', entityId: rows[0].id, entityLabel: rows[0].username || rows[0].email, details: { from: current.rows[0].role, to: role } });
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
