const router = require('express').Router();
const { z } = require('zod');
const { query, logActivity } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');

// Deliberately NO requireAuth on this router — this is the one part of
// the API meant to be reachable by someone with just a link, no account.
// In exchange, every response here is scoped to exactly one trip and
// carries only what a passenger filling in their own details needs to
// see — never other passengers, other trips, or anything account-related.

function safeTripView(trip) {
  const closedStatuses = ['Declined', 'Cancelled', 'Completed'];
  return {
    name: trip.name,
    type: trip.type,
    destination: trip.destination,
    startDate: trip.start_date,
    endDate: trip.end_date,
    acceptingRegistrations: !closedStatuses.includes(trip.status),
  };
}

router.get('/trips/:token', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM trips WHERE public_token = $1', [req.params.token]);
  if (!rows[0]) return res.status(404).json({ error: 'Registration link not found' });
  res.json(safeTripView(rows[0]));
}));

const registerSchema = z.object({
  name: z.string().min(1),
  dob: z.string().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  idNumber: z.string().optional().or(z.literal('')),
  medicalCondition: z.string().optional().or(z.literal('')),
  passportNumber: z.string().optional().or(z.literal('')),
  passportExpiry: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
});

router.post('/trips/:token/register', asyncHandler(async (req, res) => {
  const tripRow = await query('SELECT * FROM trips WHERE public_token = $1', [req.params.token]);
  const trip = tripRow.rows[0];
  if (!trip) return res.status(404).json({ error: 'Registration link not found' });

  const view = safeTripView(trip);
  if (!view.acceptingRegistrations) {
    return res.status(400).json({ error: 'Registration is closed for this trip' });
  }

  const d = registerSchema.parse(req.body);

  // Every field a self-registering passenger could set is deliberately
  // whitelisted above — amount, deposit, payment status, and all flight-
  // ticket fields are staff-managed and always start at their defaults
  // here, regardless of anything in the request body.
  const { rows } = await query(
    `INSERT INTO passengers
       (trip_id, name, dob, phone, id_number, medical_condition, passport_number, passport_expiry, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name`,
    [trip.id, d.name, d.dob || null, d.phone || null, d.idNumber || null, d.medicalCondition || null, d.passportNumber || null, d.passportExpiry || null, d.notes || null]
  );

  logActivity({
    actor: { id: null, name: `${d.name} (self-registered)`, email: 'public-registration@excapism.local' },
    action: 'passenger.self_registered',
    entityType: 'passenger',
    entityId: rows[0].id,
    entityLabel: rows[0].name,
    details: { tripId: trip.id, tripName: trip.name },
  });

  res.status(201).json({ name: rows[0].name });
}));

module.exports = router;
