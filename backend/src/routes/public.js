const router = require('express').Router();
const { z } = require('zod');
const { query, withTransaction, logActivity } = require('../db');
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

const passengerEntrySchema = z.object({
  name: z.string().min(1, 'Full name is required'),
  dob: z.string().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  idNumber: z.string().optional().or(z.literal('')),
  medicalCondition: z.string().optional().or(z.literal('')),
  passportNumber: z.string().optional().or(z.literal('')),
  passportExpiry: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  // A boolean flag rather than trusting an arbitrary ticketPurchaser
  // string from an unauthenticated caller — server derives the actual
  // value ('Excapism' | null) from this itself, below.
  wantsFlight: z.boolean().optional().default(false),
}).refine(
  (d) => !d.wantsFlight || (d.passportNumber && d.passportNumber.trim() && d.passportExpiry && d.passportExpiry.trim()),
  { message: 'Passport number and expiry date are required when requesting a flight booking' }
);
const registerSchema = z.object({
  passengers: z.array(passengerEntrySchema).min(1, 'At least one passenger is required'),
});

router.post('/trips/:token/register', asyncHandler(async (req, res) => {
  const tripRow = await query('SELECT * FROM trips WHERE public_token = $1', [req.params.token]);
  const trip = tripRow.rows[0];
  if (!trip) return res.status(404).json({ error: 'Registration link not found' });

  const view = safeTripView(trip);
  if (!view.acceptingRegistrations) {
    return res.status(400).json({ error: 'Registration is closed for this trip' });
  }

  const { passengers } = registerSchema.parse(req.body);

  // Every field a self-registering passenger could set is deliberately
  // whitelisted above — amount, deposit, payment status, ticket status,
  // airline, and booking reference are staff-managed and always start
  // at their defaults here, regardless of anything in the request body.
  // All-or-nothing: if any entry in the batch is somehow invalid, none
  // of them are inserted.
  const created = await withTransaction(async (client) => {
    const results = [];
    for (const d of passengers) {
      const name = d.name.trim().toUpperCase(); // enforced server-side too, not just in the UI
      const ticketPurchaser = d.wantsFlight ? 'Excapism' : null;
      const { rows } = await client.query(
        `INSERT INTO passengers
           (trip_id, name, dob, phone, id_number, medical_condition, passport_number, passport_expiry, ticket_purchaser, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, name`,
        [trip.id, name, d.dob || null, d.phone || null, d.idNumber || null, d.medicalCondition || null,
         d.passportNumber || null, d.passportExpiry || null, ticketPurchaser, d.notes || null]
      );
      results.push(rows[0]);
    }
    return results;
  });

  created.forEach((c) => {
    logActivity({
      actor: { id: null, name: `${c.name} (self-registered)`, email: 'public-registration@excapism.local' },
      action: 'passenger.self_registered',
      entityType: 'passenger',
      entityId: c.id,
      entityLabel: c.name,
      details: { tripId: trip.id, tripName: trip.name, batchSize: created.length },
    });
  });

  res.status(201).json({ names: created.map((c) => c.name) });
}));

module.exports = router;
