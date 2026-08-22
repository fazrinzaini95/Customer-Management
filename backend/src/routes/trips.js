const router = require('express').Router();
const { z } = require('zod');
const { query, withTransaction } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

function mapTrip(row, passengerCount) {
  return {
    id: row.id,
    seq: row.seq,
    name: row.name,
    type: row.type,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    history: row.history,
    createdAt: row.created_at,
    ...(passengerCount !== undefined ? { passengerCount: Number(passengerCount) } : {}),
  };
}

// Same shape as the frontend's nextActions(): what a trip's status can move
// to next, and whether ANY logged-in role can trigger it or only an
// approver/admin. Kept here so the server enforces the same rules the UI
// hides/shows buttons for — a role check purely in the frontend is only a
// display convenience, not real access control.
const TRANSITIONS = {
  Draft:     [{ to: 'Pending',   anyRole: true }],
  Pending:   [{ to: 'Approved',  anyRole: false }, { to: 'Declined', anyRole: false }],
  Approved:  [{ to: 'Completed', anyRole: false }, { to: 'Cancelled', anyRole: false }],
  Declined:  [{ to: 'Draft',     anyRole: true }],
  Cancelled: [{ to: 'Draft',     anyRole: true }],
  Completed: [],
};

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT t.*, COUNT(p.id) AS passenger_count
    FROM trips t
    LEFT JOIN passengers p ON p.trip_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `);
  res.json(rows.map((r) => mapTrip(r, r.passenger_count)));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM trips WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Trip not found' });
  res.json(mapTrip(rows[0]));
}));

const tripSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['open', 'private']).default('open'),
  destination: z.string().optional().or(z.literal('')),
  startDate: z.string().optional().or(z.literal('')),
  endDate: z.string().optional().or(z.literal('')),
});

// Any logged-in role can create a trip — it starts as Draft either way,
// and Draft is freely editable before anyone submits it for approval.
router.post('/', asyncHandler(async (req, res) => {
  const d = tripSchema.parse(req.body);
  const history = JSON.stringify([{ status: 'Draft', date: new Date().toISOString() }]);
  const { rows } = await query(
    `INSERT INTO trips (name, type, destination, start_date, end_date, status, history, created_by)
     VALUES ($1,$2,$3,$4,$5,'Draft',$6,$7) RETURNING *`,
    [d.name, d.type, d.destination || null, d.startDate || null, d.endDate || null, history, req.user.id]
  );
  res.status(201).json(mapTrip(rows[0]));
}));

// Editing trip details (name/type/destination/dates) is separate from
// changing its status — any logged-in role can edit, matching "users can
// create and edit."
router.put('/:id', asyncHandler(async (req, res) => {
  const d = tripSchema.partial().parse(req.body);
  const fields = [];
  const values = [];
  let i = 1;
  const colMap = { name: 'name', type: 'type', destination: 'destination', startDate: 'start_date', endDate: 'end_date' };
  for (const [key, col] of Object.entries(colMap)) {
    if (d[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(d[key] || null); }
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  values.push(req.params.id);
  const { rows } = await query(`UPDATE trips SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (!rows[0]) return res.status(404).json({ error: 'Trip not found' });
  res.json(mapTrip(rows[0]));
}));

// Admin-only, matching the frontend's delete gating. Passengers cascade.
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM trips WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Trip not found' });
  res.status(204).send();
}));

const statusSchema = z.object({ status: z.enum(['Draft', 'Pending', 'Approved', 'Declined', 'Cancelled', 'Completed']) });

router.post('/:id/status', asyncHandler(async (req, res) => {
  const { status: newStatus } = statusSchema.parse(req.body);

  const current = await query('SELECT * FROM trips WHERE id = $1', [req.params.id]);
  const trip = current.rows[0];
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const allowed = TRANSITIONS[trip.status] || [];
  const move = allowed.find((a) => a.to === newStatus);
  if (!move) {
    return res.status(400).json({ error: `Can't move a trip from ${trip.status} to ${newStatus}` });
  }
  if (!move.anyRole && !['approver', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only an approver or admin can do that' });
  }

  const history = [...(trip.history || []), { status: newStatus, date: new Date().toISOString() }];
  const { rows } = await query(
    'UPDATE trips SET status = $1, history = $2 WHERE id = $3 RETURNING *',
    [newStatus, JSON.stringify(history), req.params.id]
  );
  res.json(mapTrip(rows[0]));
}));

// ---------------------------------------------------------------
// Bulk import — mirrors the frontend's client-side grouping logic, just
// done server-side/atomically: each row carries tripType + location: rows
// sharing both are grouped into one trip (matched to an existing Draft/
// any-status trip with the same type+destination, or created fresh as
// Draft), then all passengers are inserted in a single transaction.
// ---------------------------------------------------------------
const importRowSchema = z.object({
  name: z.string().min(1),
  dob: z.string().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  idNumber: z.string().optional().or(z.literal('')),
  tripType: z.string().optional().or(z.literal('')),
  location: z.string().optional().or(z.literal('')),
  medicalCondition: z.string().optional().or(z.literal('')),
  passportNote: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  timestamp: z.string().optional().or(z.literal('')),
});
const importSchema = z.object({ rows: z.array(importRowSchema).min(1) });

router.post('/bulk-import', asyncHandler(async (req, res) => {
  const { rows } = importSchema.parse(req.body);

  const groups = new Map();
  for (const r of rows) {
    const type = /private/i.test(r.tripType || '') ? 'private' : 'open';
    const location = (r.location || '').trim() || 'Unspecified destination';
    const key = `${type}|${location.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { type, location, rows: [] });
    groups.get(key).rows.push(r);
  }

  const result = await withTransaction(async (client) => {
    let importedCount = 0;
    let createdTripCount = 0;
    const tripIds = [];

    for (const g of groups.values()) {
      const existing = await client.query(
        'SELECT id FROM trips WHERE type = $1 AND lower(destination) = lower($2) LIMIT 1',
        [g.type, g.location]
      );
      let tripId = existing.rows[0]?.id;

      if (!tripId) {
        const history = JSON.stringify([{ status: 'Draft', date: new Date().toISOString() }]);
        const created = await client.query(
          `INSERT INTO trips (name, type, destination, status, history, created_by)
           VALUES ($1,$2,$3,'Draft',$4,$5) RETURNING id`,
          [g.location, g.type, g.location, history, req.user.id]
        );
        tripId = created.rows[0].id;
        createdTripCount += 1;
      }
      tripIds.push(tripId);

      for (const r of g.rows) {
        await client.query(
          `INSERT INTO passengers
             (trip_id, name, dob, phone, id_number, medical_condition, passport_note, notes, submitted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            tripId, r.name, r.dob || null, r.phone || null, r.idNumber || null,
            r.medicalCondition || null, r.passportNote || null, r.notes || null,
            r.timestamp || null,
          ]
        );
        importedCount += 1;
      }
    }

    return { importedCount, createdTripCount, tripIds: [...new Set(tripIds)] };
  });

  res.status(201).json(result);
}));

module.exports = router;
