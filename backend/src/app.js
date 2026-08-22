require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const tripsRoutes = require('./routes/trips');
const passengersRoutes = require('./routes/passengers');
const settingsRoutes = require('./routes/settings');
const bootstrapRoutes = require('./routes/bootstrap');
const activityRoutes = require('./routes/activity');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// Defensive path normalization for serverless deployment (Netlify
// Functions and similar). Depending on exactly how the platform forwards a
// rewritten URL, req.url can arrive here still carrying a prefix like
// "/.netlify/functions/api" or "/api" in front of the real path. Stripping
// it here, first, makes the rest of the app work the same whether it's
// running as a normal server or behind that rewrite.
app.use((req, res, next) => {
  req.url = req.url.replace(/^\/\.netlify\/functions\/[^/]+/, '').replace(/^\/api(?=\/|$)/, '') || '/';
  next();
});

app.use(helmet());
// Fails closed, not open: if CORS_ORIGIN is ever accidentally unset, this
// blocks cross-origin requests by default rather than silently allowing
// any site to call the API. Set CORS_ORIGIN explicitly to the deployed
// frontend's URL.
app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
app.use(express.json({ limit: '1mb' }));

// Basic rate limiting — protects auth endpoints from brute-force attempts
// in particular.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/auth/login', authLimiter);
app.use('/auth/signup', authLimiter);
app.use('/auth/temp-account', authLimiter);
app.use(rateLimit({ windowMs: 60 * 1000, max: 300 }));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/trips', tripsRoutes);
app.use('/', passengersRoutes);   // owns /trips/:tripId/passengers and /passengers/:id
app.use('/settings', settingsRoutes);
app.use('/bootstrap', bootstrapRoutes);
app.use('/activity', activityRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
