const router = require('express').Router();
const { z } = require('zod');
const { query, logActivity } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function mapPassenger(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    dob: row.dob,
    phone: row.phone,
    idNumber: row.id_number,
    medicalCondition: row.medical_condition,
    passportNumber: row.passport_number,
    passportExpiry: row.passport_expiry,
    amount: Number(row.amount),
    depositAmount: Number(row.deposit_amount),
    paymentStatus: row.payment_status,
    ticketPurchaser: row.ticket_purchaser,
    ticketStatus: row.ticket_status,
    airline: row.airline,
    bookingReference: row.booking_reference,
    notes: row.notes,
    submittedAt: row.submitted_at,
    addedAt: row.added_at,
  };
}

const passengerSchema = z.object({
  name: z.string().min(1),
  dob: z.string().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  idNumber: z.string().optional().or(z.literal('')),
  medicalCondition: z.string().optional().or(z.literal('')),
  passportNumber: z.string().optional().or(z.literal('')),
  passportExpiry: z.string().optional().or(z.literal('')),
  amount: z.number().nonnegative().default(0),
  depositAmount: z.number().nonnegative().default(0),
  paymentStatus: z.enum(['Pending', 'Deposit', 'Paid', 'Cancelled']).default('Pending'),
  ticketPurchaser: z.enum(['Self Purchase', 'Excapism']).optional().or(z.literal('')),
  ticketStatus: z.enum(['Pending', 'Purchased']).default('Pending'),
  airline: z.string().optional().or(z.literal('')),
  bookingReference: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
});

router.get('/trips/:tripId/passengers', asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM passengers WHERE trip_id = $1 ORDER BY added_at DESC',
    [req.params.tripId]
  );
  res.json(rows.map(mapPassenger));
}));

router.post('/trips/:tripId/passengers', asyncHandler(async (req, res) => {
  const d = passengerSchema.parse(req.body);
  const { rows } = await query(
    `INSERT INTO passengers
       (trip_id, name, dob, phone, id_number, medical_condition, passport_number, passport_expiry,
        amount, deposit_amount, payment_status, ticket_purchaser, ticket_status, airline, booking_reference, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [
      req.params.tripId, d.name, d.dob || null, d.phone || null, d.idNumber || null,
      d.medicalCondition || null, d.passportNumber || null, d.passportExpiry || null,
      d.amount, d.depositAmount, d.paymentStatus, d.ticketPurchaser || null, d.ticketStatus,
      d.airline || null, d.bookingReference || null, d.notes || null,
    ]
  );
  res.status(201).json(mapPassenger(rows[0]));
  logActivity({ actor: req.user, action: 'passenger.created', entityType: 'passenger', entityId: rows[0].id, entityLabel: rows[0].name, details: { tripId: rows[0].trip_id } });
}));

router.put('/passengers/:id', asyncHandler(async (req, res) => {
  const d = passengerSchema.partial().parse(req.body);
  const colMap = {
    name: 'name', dob: 'dob', phone: 'phone', idNumber: 'id_number',
    medicalCondition: 'medical_condition', passportNumber: 'passport_number', passportExpiry: 'passport_expiry',
    amount: 'amount', depositAmount: 'deposit_amount',
    paymentStatus: 'payment_status', ticketPurchaser: 'ticket_purchaser',
    ticketStatus: 'ticket_status', airline: 'airline', bookingReference: 'booking_reference',
    notes: 'notes',
  };
  const fields = [];
  const values = [];
  let i = 1;
  for (const [key, col] of Object.entries(colMap)) {
    if (d[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(d[key] === '' ? null : d[key]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  values.push(req.params.id);
  const { rows } = await query(`UPDATE passengers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (!rows[0]) return res.status(404).json({ error: 'Passenger not found' });
  res.json(mapPassenger(rows[0]));
  logActivity({ actor: req.user, action: 'passenger.updated', entityType: 'passenger', entityId: rows[0].id, entityLabel: rows[0].name, details: { updatedFields: Object.keys(d) } });
}));

// Payment status has its own lightweight endpoint since it's changed via a
// plain dropdown in the table, separate from the full edit modal.
const statusOnlySchema = z.object({ paymentStatus: z.enum(['Pending', 'Deposit', 'Paid', 'Cancelled']) });
router.put('/passengers/:id/payment-status', asyncHandler(async (req, res) => {
  const { paymentStatus } = statusOnlySchema.parse(req.body);

  const before = await query('SELECT payment_status, name FROM passengers WHERE id = $1', [req.params.id]);
  if (!before.rows[0]) return res.status(404).json({ error: 'Passenger not found' });

  const { rows } = await query(
    'UPDATE passengers SET payment_status = $1 WHERE id = $2 RETURNING *',
    [paymentStatus, req.params.id]
  );
  res.json(mapPassenger(rows[0]));
  logActivity({ actor: req.user, action: 'passenger.payment_status_changed', entityType: 'passenger', entityId: rows[0].id, entityLabel: rows[0].name, details: { from: before.rows[0].payment_status, to: paymentStatus } });
}));

// Ticket status has the same lightweight-dropdown pattern as payment status.
const ticketStatusOnlySchema = z.object({ ticketStatus: z.enum(['Pending', 'Purchased']) });
router.put('/passengers/:id/ticket-status', asyncHandler(async (req, res) => {
  const { ticketStatus } = ticketStatusOnlySchema.parse(req.body);

  const before = await query('SELECT ticket_status, name FROM passengers WHERE id = $1', [req.params.id]);
  if (!before.rows[0]) return res.status(404).json({ error: 'Passenger not found' });

  const { rows } = await query(
    'UPDATE passengers SET ticket_status = $1 WHERE id = $2 RETURNING *',
    [ticketStatus, req.params.id]
  );
  res.json(mapPassenger(rows[0]));
  logActivity({ actor: req.user, action: 'passenger.ticket_status_changed', entityType: 'passenger', entityId: rows[0].id, entityLabel: rows[0].name, details: { from: before.rows[0].ticket_status, to: ticketStatus } });
}));

// Delete is open to User/Approver/Admin (any authenticated role) —
// unlike trips, which stay admin-only. requireAuth (applied to the whole
// router above) is the only gate needed here.
router.delete('/passengers/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('DELETE FROM passengers WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Passenger not found' });
  res.status(204).send();
  logActivity({ actor: req.user, action: 'passenger.deleted', entityType: 'passenger', entityId: rows[0].id, entityLabel: rows[0].name, details: { tripId: rows[0].trip_id } });
}));

module.exports = router;
