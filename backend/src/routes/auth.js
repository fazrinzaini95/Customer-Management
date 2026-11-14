const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { query } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.username || user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}
function publicUser(u) {
  return {
    id: u.id, name: u.username || u.name, username: u.username || null, fullName: u.name, initials: u.initials || null,
    email: u.email, role: u.role, isTemp: u.is_temp, mustChangePassword: !!u.must_change_password,
  };
}
async function isFirstAccount() {
  const { rows } = await query('SELECT 1 FROM users LIMIT 1');
  return rows.length === 0;
}
function makeInitials(s) {
  const w = String(s || '').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || '').charAt(0) + (w[1] || '').charAt(0)).toUpperCase() || (String(s || '?').charAt(0).toUpperCase());
}

const signupSchema = z.object({
  username: z.string().trim().min(2, 'Username must be at least 2 characters').regex(/^[A-Za-z0-9._-]+$/, 'Username can only use letters, numbers, dot, dash and underscore'),
  name: z.string().trim().optional(),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// Sign-up is closed: accounts are created by an admin (Manage Users).
// The ONLY exception is the very first account on an empty system, which
// becomes the admin so the app can be set up at all.
router.post('/signup', asyncHandler(async (req, res) => {
  if (!(await isFirstAccount())) {
    return res.status(403).json({ error: 'Sign-up is closed. Please ask your admin to create an account for you.' });
  }
  const d = signupSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(d.password, 10);
  const { rows } = await query(
    'INSERT INTO users (name, username, initials, email, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [d.name || d.username, d.username, makeInitials(d.name || d.username), d.email, passwordHash, 'admin']
  );
  res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
}));

// Whether the open "first account" screen should be offered at all.
router.get('/setup-status', asyncHandler(async (req, res) => {
  res.json({ needsFirstAccount: await isFirstAccount() });
}));

const loginSchema = z.object({
  email: z.string().min(1, 'Please enter your username or email'),   // username OR email
  password: z.string().min(1, 'Please enter your password'),
});

router.post('/login', asyncHandler(async (req, res) => {
  const { email: ident, password } = loginSchema.parse(req.body);
  const { rows } = await query(
    'SELECT * FROM users WHERE email = $1 OR lower(username) = lower($1) LIMIT 1', [ident.trim()]
  );
  const user = rows[0];

  // Deliberately vague on failure — don't reveal whether the account exists.
  if (!user || !user.is_active) return res.status(401).json({ error: 'Incorrect username or password' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Incorrect username or password' });

  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(rows[0]));
}));

// Anyone signed in can change their own password (also used for the forced change after an admin reset).
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const d = z.object({
    currentPassword: z.string().min(1, 'Please enter your current password'),
    newPassword: z.string().min(6, 'New password must be at least 6 characters'),
  }).parse(req.body);
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!(await bcrypt.compare(d.currentPassword, user.password_hash))) {
    return res.status(400).json({ error: 'Your current password is not correct' });
  }
  if (d.currentPassword === d.newPassword) return res.status(400).json({ error: 'Please choose a different password from the current one' });
  const hash = await bcrypt.hash(d.newPassword, 10);
  const up = await query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2 RETURNING *', [hash, req.user.id]);
  res.json({ user: publicUser(up.rows[0]) });
}));

module.exports = router;
