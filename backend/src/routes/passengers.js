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
    balancePaid: Number(row.balance_paid),
    payments: Array.isArray(row.payments) ? row.payments : [],
    paymentStatus: row.payment_status,
    ticketPurchaser: row.ticket_purchaser,
    ticketStatus: row.ticket_status,
    airline: row.airline,
    bookingReference: row.booking_reference,
    picName: row.pic_name || null,
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
  balancePaid: z.number().nonnegative().default(0),
  paymentStatus: z.enum(['Pending', 'Deposit', 'Paid', 'Cancelled']).default('Pending'),
  ticketPurchaser: z.enum(['Self Purchase', 'Excapism']).optional().or(z.literal('')),
  ticketStatus: z.enum(['Pending', 'Purchased']).default('Pending'),
  airline: z.string().optional().or(z.literal('')),
  bookingReference: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
});

router.get('/trips/:tripId/passengers', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT p.*, pic.name AS pic_name
    FROM passengers p
    LEFT JOIN users pic ON pic.id = p.pic_id
    WHERE p.trip_id = $1
    ORDER BY p.added_at DESC
  `, [req.params.tripId]);
  res.json(rows.map(mapPassenger));
}));

// PIC (person in charge) is set once, here, to whoever is creating the
// record — and never reassigned by later edits (see PUT below, which
// deliberately excludes pic_id from its updatable column map).
router.post('/trips/:tripId/passengers', asyncHandler(async (req, res) => {
  const d = passengerSchema.parse(req.body);
  const { rows } = await query(
    `INSERT INTO passengers
       (trip_id, name, dob, phone, id_number, medical_condition, passport_number, passport_expiry,
        amount, deposit_amount, balance_paid, payment_status, ticket_purchaser, ticket_status, airline, booking_reference, pic_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [
      req.params.tripId, d.name, d.dob || null, d.phone || null, d.idNumber || null,
      d.medicalCondition || null, d.passportNumber || null, d.passportExpiry || null,
      d.amount, d.depositAmount, d.balancePaid, d.paymentStatus, d.ticketPurchaser || null, d.ticketStatus,
      d.airline || null, d.bookingReference || null, req.user.id, d.notes || null,
    ]
  );
  res.status(201).json({ ...mapPassenger(rows[0]), picName: req.user.name });
  logActivity({ actor: req.user, action: 'passenger.created', entityType: 'passenger', entityId: rows[0].id, entityLabel: rows[0].name, details: { tripId: rows[0].trip_id } });
}));

router.put('/passengers/:id', asyncHandler(async (req, res) => {
  const d = passengerSchema.partial().parse(req.body);
  const colMap = {
    name: 'name', dob: 'dob', phone: 'phone', idNumber: 'id_number',
    medicalCondition: 'medical_condition', passportNumber: 'passport_number', passportExpiry: 'passport_expiry',
    amount: 'amount', depositAmount: 'deposit_amount', balancePaid: 'balance_paid',
    paymentStatus: 'payment_status', ticketPurchaser: 'ticket_purchaser',
    ticketStatus: 'ticket_status', airline: 'airline', bookingReference: 'booking_reference',
    notes: 'notes',
    // pic_id is deliberately NOT here — PIC reflects who originally
    // registered this passenger, not who last edited their details.
  };
  const fields = [];
  const values = [];
  let i = 1;
  for (const [key, col] of Object.entries(colMap)) {
    if (d[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(d[key] === '' ? null : d[key]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  values.push(req.params.id);
  const { rows } = await query(
    `WITH updated AS (UPDATE passengers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *)
     SELECT updated.*, pic.name AS pic_name FROM updated LEFT JOIN users pic ON pic.id = updated.pic_id`,
    values
  );
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
    `WITH updated AS (UPDATE passengers SET payment_status = $1 WHERE id = $2 RETURNING *)
     SELECT updated.*, pic.name AS pic_name FROM updated LEFT JOIN users pic ON pic.id = updated.pic_id`,
    [paymentStatus, req.params.id]
  );
  res.json(mapPassenger(rows[0]));
  logActivity({ actor: req.user, action: 'passenger.payment_status_changed', entityType: 'passenger', entityId: rows[0].id, entityLabel: rows[0].name, details: { from: before.rows[0].payment_status, to: paymentStatus } });
}));

// Payment history (instalments). `balance_paid` — the "Payment" figure every
// total, balance and status in the app reads — is always the sum of these
// entries, so nothing else needs to know the history exists. The payment
// status is re-derived here with the same rule as the frontend
// (Cancelled stays Cancelled).
const paymentsSchema = z.object({
  payments: z.array(z.object({
    id: z.string().max(60),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount: z.number().positive().max(100000000),
    note: z.string().max(300).optional().or(z.literal('')),
    // payment = money received (counts towards Payment); refund = money returned and
    // retained = kept by Excapism (e.g. a cancellation fee) — both only for cancelled passengers.
    kind: z.enum(['payment', 'refund', 'retained']).default('payment'),
  })).max(200),
});
router.put('/passengers/:id/payments', asyncHandler(async (req, res) => {
  const { payments } = paymentsSchema.parse(req.body);
  const clean = payments
    .map((e) => ({ id: e.id, date: e.date, amount: Math.round(e.amount * 100) / 100, note: e.note || '', kind: e.kind }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // Only received payments make up the passenger's "Payment" figure.
  const total = Math.round(clean.filter((e) => e.kind === 'payment').reduce((n, e) => n + e.amount, 0) * 100) / 100;
  const cur = await query(
    `SELECT p.amount, p.deposit_amount, p.payment_status, t.status AS trip_status
     FROM passengers p JOIN trips t ON t.id = p.trip_id WHERE p.id = $1`, [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: 'Passenger not found' });
  const a = Number(cur.rows[0].amount), dep = Number(cur.rows[0].deposit_amount);
  let status = cur.rows[0].payment_status;
  const tripCancelled = ['Cancelled', 'Declined'].includes(cur.rows[0].trip_status);
  if (status !== 'Cancelled' && !tripCancelled && clean.some((e) => e.kind !== 'payment')) {
    return res.status(400).json({ error: 'Refunds and retained amounts can only be recorded for a cancelled passenger or a cancelled trip' });
  }
  if (status !== 'Cancelled') {
    status = (a > 0 && dep + total >= a) ? 'Paid' : (dep > 0 && total === 0) ? 'Deposit' : 'Pending';
  }
  const { rows } = await query(
    `WITH updated AS (UPDATE passengers SET payments = $1, balance_paid = $2, payment_status = $3 WHERE id = $4 RETURNING *)
     SELECT updated.*, pic.name AS pic_name FROM updated LEFT JOIN users pic ON pic.id = updated.pic_id`,
    [JSON.stringify(clean), total, status, req.params.id]
  );
  res.json(mapPassenger(rows[0]));
  logActivity({ actor: req.user, action: 'passenger.payments_updated', entityType: 'passenger', entityId: rows[0].id, entityLabel: rows[0].name, details: { entries: clean.length, total } });
}));

// Set the package amount and/or deposit for several passengers at once. A field left out is not
// changed. Payment status is re-derived with the same rule as the payments route above
// (Cancelled stays Cancelled; money already received counts towards Paid).
const pricingSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  amount: z.number().nonnegative().max(100000000).optional(),
  depositAmount: z.number().nonnegative().max(100000000).optional(),
}).refine((d) => d.amount !== undefined || d.depositAmount !== undefined, { message: 'Enter a package amount or a deposit' })
  .refine((d) => !(d.amount > 0 && d.depositAmount > d.amount), { message: 'Deposit cannot be more than the package amount' });
router.put('/trips/:tripId/pricing', asyncHandler(async (req, res) => {
  const d = pricingSchema.parse(req.body);
  const { rows } = await query(
    `WITH n AS (
       SELECT id, COALESCE($2::numeric, amount) AS a, COALESCE($3::numeric, deposit_amount) AS dep, balance_paid AS bp, payment_status AS ps
       FROM passengers WHERE trip_id = $1 AND id = ANY($4::uuid[])
     ), updated AS (
       UPDATE passengers p SET amount = n.a, deposit_amount = n.dep,
         payment_status = (CASE WHEN n.ps = 'Cancelled' THEN 'Cancelled'
                                WHEN n.a > 0 AND n.dep + n.bp >= n.a THEN 'Paid'
                                WHEN n.dep > 0 AND n.bp = 0 THEN 'Deposit'
                                ELSE 'Pending' END)::payment_status
       FROM n WHERE p.id = n.id RETURNING p.*
     )
     SELECT updated.*, pic.name AS pic_name FROM updated LEFT JOIN users pic ON pic.id = updated.pic_id`,
    [req.params.tripId, d.amount ?? null, d.depositAmount ?? null, d.ids]
  );
  res.json(rows.map(mapPassenger));
  logActivity({ actor: req.user, action: 'passenger.pricing_bulk_set', entityType: 'trip', entityId: req.params.tripId, entityLabel: `${rows.length} passenger(s)`, details: { amount: d.amount, depositAmount: d.depositAmount, count: rows.length } });
}));

// Ticket status has the same lightweight-dropdown pattern as payment status.
const ticketStatusOnlySchema = z.object({ ticketStatus: z.enum(['Pending', 'Purchased']) });
router.put('/passengers/:id/ticket-status', asyncHandler(async (req, res) => {
  const { ticketStatus } = ticketStatusOnlySchema.parse(req.body);

  const before = await query('SELECT ticket_status, name FROM passengers WHERE id = $1', [req.params.id]);
  if (!before.rows[0]) return res.status(404).json({ error: 'Passenger not found' });

  const { rows } = await query(
    `WITH updated AS (UPDATE passengers SET ticket_status = $1 WHERE id = $2 RETURNING *)
     SELECT updated.*, pic.name AS pic_name FROM updated LEFT JOIN users pic ON pic.id = updated.pic_id`,
    [ticketStatus, req.params.id]
  );
  res.json(mapPassenger(rows[0]));
  logActivity({ actor: req.user, action: 'passenger.ticket_status_changed', entityType: 'passenger', entityId: rows[0].id, entityLabel: rows[0].name, details: { from: before.rows[0].ticket_status, to: ticketStatus } });
}));

// Delete is open to User/Approver/Admin (any authenticated role) —
// unlike trips, which stay admin-only. requireAuth (applied to the whole
// router above) is the only gate needed here.
router.delete('/passengers/:id', asyncHandler(async (req, res) => {
  // A passenger with any money recorded can't be deleted — cancel them instead so
  // the payment history (and any refund) stays on record.
  const chk = await query('SELECT deposit_amount, balance_paid, payments FROM passengers WHERE id = $1', [req.params.id]);
  if (!chk.rows[0]) return res.status(404).json({ error: 'Passenger not found' });
  const r0 = chk.rows[0];
  if (Number(r0.deposit_amount) > 0 || Number(r0.balance_paid) > 0 || (Array.isArray(r0.payments) && r0.payments.length)) {
    return res.status(409).json({ error: 'This passenger has payments recorded. Cancel the passenger instead (the payment history stays on record).' });
  }
  const { rows } = await query('DELETE FROM passengers WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Passenger not found' });
  res.status(204).send();
  logActivity({ actor: req.user, action: 'passenger.deleted', entityType: 'passenger', entityId: rows[0].id, entityLabel: rows[0].name, details: { tripId: rows[0].trip_id } });
}));

module.exports = router;
