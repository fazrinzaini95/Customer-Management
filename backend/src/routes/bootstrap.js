const router = require('express').Router();
const { query } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /bootstrap — same reasoning as the accounting API's version: on
// Netlify Functions, the expensive part per request is connection
// setup/cold start, not the number of SQL statements once connected. One
// function invocation running several queries beats several separate
// requests each paying that cost on their own.
router.get('/', asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';

  const [tripsRes, passengersRes, settingsRes, seqRes, usersRes] = await Promise.all([
    query(`
      SELECT t.*, COUNT(p.id) AS passenger_count, u.name AS creator_name
      FROM trips t
      LEFT JOIN passengers p ON p.trip_id = t.id
      LEFT JOIN users u ON u.id = t.created_by
      GROUP BY t.id, u.name
      ORDER BY t.created_at DESC
    `),
    query('SELECT * FROM passengers ORDER BY added_at DESC'),
    query('SELECT data FROM app_settings WHERE id = 1'),
    query('SELECT last_value, is_called FROM trip_seq'),
    isAdmin
      ? query('SELECT * FROM users WHERE is_active = true ORDER BY created_at')
      : Promise.resolve({ rows: [] }),
  ]);

  const { last_value, is_called } = seqRes.rows[0];
  const nextNumber = is_called ? Number(last_value) + 1 : Number(last_value);

  res.json({
    trips: tripsRes.rows.map((r) => ({
      id: r.id, seq: r.seq, name: r.name, type: r.type, destination: r.destination,
      startDate: r.start_date, endDate: r.end_date, status: r.status, history: r.history,
      createdAt: r.created_at, createdByName: r.creator_name || null, passengerCount: Number(r.passenger_count), publicToken: r.public_token,
    })),
    passengers: passengersRes.rows.map((r) => ({
      id: r.id, tripId: r.trip_id, name: r.name, dob: r.dob, phone: r.phone,
      idNumber: r.id_number, medicalCondition: r.medical_condition, passportNumber: r.passport_number, passportExpiry: r.passport_expiry,
      amount: Number(r.amount), depositAmount: Number(r.deposit_amount), paymentStatus: r.payment_status,
      ticketPurchaser: r.ticket_purchaser, ticketStatus: r.ticket_status, airline: r.airline, bookingReference: r.booking_reference,
      notes: r.notes, submittedAt: r.submitted_at, addedAt: r.added_at,
    })),
    settings: { ...(settingsRes.rows[0]?.data || {}), runningNumber: is_called ? Number(last_value) : 0, nextNumber },
    users: isAdmin
      ? usersRes.rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, isTemp: u.is_temp, createdAt: u.created_at }))
      : undefined,
  });
}));

module.exports = router;
