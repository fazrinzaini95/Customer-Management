const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { query } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, isTemp: u.is_temp };
}
async function isFirstAccount() {
  const { rows } = await query('SELECT 1 FROM users LIMIT 1');
  return rows.length === 0;
}

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

// The very first account ever created becomes admin automatically — every
// account after that defaults to 'user'. Matches the frontend's original
// bootstrap behavior; an admin can promote someone later via /users.
router.post('/signup', asyncHandler(async (req, res) => {
  const d = signupSchema.parse(req.body);
  const existing = await query('SELECT 1 FROM users WHERE email = $1', [d.email]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const role = (await isFirstAccount()) ? 'admin' : 'user';
  const passwordHash = await bcrypt.hash(d.password, 10);
  const { rows } = await query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING *',
    [d.name, d.email, passwordHash, role]
  );
  const user = rows[0];
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

// One-click "temporary account" — generates a random email + password
// server-side, creates the account, and returns the token AND the raw
// password once (only time it's ever available — it's hashed immediately
// after this response). The frontend shows it in a one-time banner so the
// person can sign back in later if they want to.
router.post('/temp-account', asyncHandler(async (req, res) => {
  const suffix = crypto.randomBytes(6).toString('hex');
  const email = `guest.${suffix}@temp.excapism`;
  const password = crypto.randomBytes(8).toString('base64url');
  const role = (await isFirstAccount()) ? 'admin' : 'user';

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    'INSERT INTO users (name, email, password_hash, role, is_temp) VALUES ($1,$2,$3,$4,true) RETURNING *',
    ['Guest User', email, passwordHash, role]
  );
  const user = rows[0];
  res.status(201).json({ token: signToken(user), user: publicUser(user), tempPassword: password });
}));

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];

  // Deliberately vague on failure — don't reveal whether the email exists.
  if (!user || !user.is_active) return res.status(401).json({ error: 'Incorrect email or password' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Incorrect email or password' });

  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(rows[0]));
}));

module.exports = router;
