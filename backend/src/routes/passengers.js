const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

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
    passportNote: row.passport_note,
    amount: Number(row.amount),
    depositAmount: Number(row.deposit_amount),
    paymentStatus: row.payment_status,
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
  passportNote: z.string().optional().or(z.literal('')),
  amount: z.number().nonnegative().default(0),
  depositAmount: z.number().nonnegative().default(0),
  paymentStatus: z.enum(['Pending', 'Deposit', 'Paid', 'Cancelled']).default('Pending'),
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
       (trip_id, name, dob, phone, id_number, medical_condition, passport_note, amount, deposit_amount, payment_status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      req.params.tripId, d.name, d.dob || null, d.phone || null, d.idNumber || null,
      d.medicalCondition || null, d.passportNote || null, d.amount, d.depositAmount,
      d.paymentStatus, d.notes || null,
    ]
  );
  res.status(201).json(mapPassenger(rows[0]));
}));

router.put('/passengers/:id', asyncHandler(async (req, res) => {
  const d = passengerSchema.partial().parse(req.body);
  const colMap = {
    name: 'name', dob: 'dob', phone: 'phone', idNumber: 'id_number',
    medicalCondition: 'medical_condition', passportNote: 'passport_note',
    amount: 'amount', depositAmount: 'deposit_amount',
    paymentStatus: 'payment_status', notes: 'notes',
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
}));

// Payment status has its own lightweight endpoint since it's changed via a
// plain dropdown in the table, separate from the full edit modal.
const statusOnlySchema = z.object({ paymentStatus: z.enum(['Pending', 'Deposit', 'Paid', 'Cancelled']) });
router.put('/passengers/:id/payment-status', asyncHandler(async (req, res) => {
  const { paymentStatus } = statusOnlySchema.parse(req.body);
  const { rows } = await query(
    'UPDATE passengers SET payment_status = $1 WHERE id = $2 RETURNING *',
    [paymentStatus, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Passenger not found' });
  res.json(mapPassenger(rows[0]));
}));

// Admin-only, matching the frontend's delete gating.
router.delete('/passengers/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM passengers WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Passenger not found' });
  res.status(204).send();
}));

module.exports = router;
