const router = require('express').Router();
const { z } = require('zod');
const { query, withTransaction, logActivity } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ensureItem } = require('./lists');

router.use(requireAuth);

function mapTrip(row, passengerCount) {
  return {
    id: row.id,
    seq: row.seq,
    name: row.name,
    type: row.type,
    destination: row.destination,
    route: row.route || '',
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    history: row.history,
    createdAt: row.created_at,
    createdByName: row.creator_name || null,
    lastEditedByName: row.editor_name || null,
    lastEditedAt: row.last_edited_at || null,
    publicToken: row.public_token,
    opsStatus: row.ops_status || 'Pending Ops',
    opsReason: row.ops_reason || null,
    opsReasonBy: row.ops_reason_by || null,
    opsReasonAt: row.ops_reason_at || null,
    opsChecklist: row.ops_checklist || {},
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
  Pending:   [{ to: 'Cancelled', anyRole: false }, { to: 'Approved',  anyRole: false }, { to: 'Declined', anyRole: false }],
  Approved:  [{ to: 'Completed', anyRole: false }, { to: 'Cancelled', anyRole: false }],
  Declined:  [{ to: 'Draft',     anyRole: true }],
  Cancelled: [{ to: 'Draft',     anyRole: true }],
  Completed: [],
};

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT t.*, COUNT(p.id) AS passenger_count, u.name AS creator_name, le.name AS editor_name
    FROM trips t
    LEFT JOIN passengers p ON p.trip_id = t.id
    LEFT JOIN users u ON u.id = t.created_by
    LEFT JOIN users le ON le.id = t.last_edited_by
    GROUP BY t.id, u.name, le.name
    ORDER BY t.created_at DESC
  `);
  res.json(rows.map((r) => mapTrip(r, r.passenger_count)));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT t.*, u.name AS creator_name, le.name AS editor_name
    FROM trips t
    LEFT JOIN users u ON u.id = t.created_by
    LEFT JOIN users le ON le.id = t.last_edited_by
    WHERE t.id = $1
  `, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Trip not found' });
  res.json(mapTrip(rows[0]));
}));

// Trip flow: the main status is Draft -> Pending (shown as "Pending Payment") -> Cancelled.
// "Paid" is not stored: the app shows Paid once a submitted trip's balance reaches zero.
// Operations is a sub-status that only approvers/admins can route, once the trip is submitted.
const OPS_STATUSES = ['Pending Ops', 'Ongoing', 'Onhold', 'Ready', 'Rejected', 'Completed'];

const tripSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['open', 'private']).default('open'),
  destination: z.string().optional().or(z.literal('')),
  route: z.string().max(200).optional().or(z.literal('')),
  startDate: z.string().optional().or(z.literal('')),
  endDate: z.string().optional().or(z.literal('')),
});

// Any logged-in role can create a trip — it starts as Draft either way,
// and Draft is freely editable before anyone submits it for approval.
// The creator is also recorded as the first "last edited by", so a
// freshly created trip already shows an edit trail rather than a blank one.
router.post('/', asyncHandler(async (req, res) => {
  const d = tripSchema.parse(req.body);
  const history = JSON.stringify([{ status: 'Draft', date: new Date().toISOString() }]);
  const { rows } = await query(
    `INSERT INTO trips (name, type, destination, route, start_date, end_date, status, history, created_by, last_edited_by, last_edited_at)
     VALUES ($1,$2,$3,$4,$5,$6,'Draft',$7,$8,$8,now()) RETURNING *`,
    [d.name, d.type, d.destination || null, (d.route || '').trim() || null, d.startDate || null, d.endDate || null, history, req.user.id]
  );
  res.status(201).json({ ...mapTrip(rows[0]), createdByName: req.user.name, lastEditedByName: req.user.name });
  if (rows[0].route && rows[0].destination) ensureItem({ kind: 'route', country: rows[0].destination, name: rows[0].route, userId: req.user.id }).catch(() => {});
  logActivity({ actor: req.user, action: 'trip.created', entityType: 'trip', entityId: rows[0].id, entityLabel: rows[0].name, details: { type: rows[0].type, destination: rows[0].destination } });
}));

// Editing trip details (name/type/destination/dates) is separate from
// changing its status — any logged-in role can edit, matching "users can
// create and edit." Every edit also stamps last_edited_by/last_edited_at.
router.put('/:id', asyncHandler(async (req, res) => {
  const d = tripSchema.partial().parse(req.body);
  const fields = [];
  const values = [];
  let i = 1;
  const colMap = { name: 'name', type: 'type', destination: 'destination', route: 'route', startDate: 'start_date', endDate: 'end_date' };
  for (const [key, col] of Object.entries(colMap)) {
    if (d[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(d[key] || null); }
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  fields.push(`last_edited_by = $${i++}`);
  values.push(req.user.id);
  fields.push('last_edited_at = now()');

  values.push(req.params.id);
  const { rows } = await query(
    `WITH updated AS (UPDATE trips SET ${fields.join(', ')} WHERE id = $${i} RETURNING *)
     SELECT updated.*, u.name AS creator_name, le.name AS editor_name
     FROM updated
     LEFT JOIN users u ON u.id = updated.created_by
     LEFT JOIN users le ON le.id = updated.last_edited_by`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'Trip not found' });
  res.json(mapTrip(rows[0]));
  if (rows[0].route && rows[0].destination) ensureItem({ kind: 'route', country: rows[0].destination, name: rows[0].route, userId: req.user.id }).catch(() => {});
  logActivity({ actor: req.user, action: 'trip.updated', entityType: 'trip', entityId: rows[0].id, entityLabel: rows[0].name, details: { updatedFields: Object.keys(d) } });
}));

// Admin-only, matching the frontend's delete gating. Passengers cascade.
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('DELETE FROM trips WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Trip not found' });
  res.status(204).send();
  logActivity({ actor: req.user, action: 'trip.deleted', entityType: 'trip', entityId: rows[0].id, entityLabel: rows[0].name, details: { destination: rows[0].destination } });
}));

const statusSchema = z.object({ status: z.enum(['Draft', 'Pending', 'Approved', 'Declined', 'Cancelled', 'Completed']) });

// A status change also counts as an edit — stamps last_edited_by/at too.
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
    `WITH updated AS (
       UPDATE trips SET status = $1, history = $2, last_edited_by = $3, last_edited_at = now()
         ${newStatus === 'Pending' ? ", ops_status = 'Pending Ops'" : ''}  -- submitting always starts Operations at Pending Ops
       WHERE id = $4 RETURNING *
     )
     SELECT updated.*, u.name AS creator_name, le.name AS editor_name
     FROM updated
     LEFT JOIN users u ON u.id = updated.created_by
     LEFT JOIN users le ON le.id = updated.last_edited_by`,
    [newStatus, JSON.stringify(history), req.user.id, req.params.id]
  );
  res.json(mapTrip(rows[0]));
  logActivity({ actor: req.user, action: 'trip.status_changed', entityType: 'trip', entityId: rows[0].id, entityLabel: rows[0].name, details: { from: trip.status, to: newStatus } });
}));

// Operations sub-status — approvers and admins only, and only once the trip has
// been submitted (Draft and Cancelled trips have no active Operations stage).
// Operations now moves automatically (Pending Ops -> Ongoing -> Ready -> Completed is
// worked out from the checklist and the trip's end date). The only manual action left is
// putting a trip On-hold or Rejecting it — both need a reason — and resuming it again
// ('Pending Ops' here means "back to automatic").
const opsSchema = z.object({
  opsStatus: z.enum(['Onhold', 'Rejected', 'Pending Ops']),
  reason: z.string().max(500).optional().or(z.literal('')),
});
router.post('/:id/ops-status', requireRole('approver', 'admin'), asyncHandler(async (req, res) => {
  const { opsStatus, reason } = opsSchema.parse(req.body);
  const manual = opsStatus === 'Onhold' || opsStatus === 'Rejected';
  if (manual && (!reason || reason.trim().length < 3)) {
    return res.status(400).json({ error: 'Please give a reason' });
  }
  const current = await query('SELECT * FROM trips WHERE id = $1', [req.params.id]);
  const trip = current.rows[0];
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (['Draft', 'Cancelled', 'Declined'].includes(trip.status)) {
    return res.status(400).json({ error: 'Operations can only be changed once the trip has been submitted' });
  }
  const { rows } = await query(
    `WITH updated AS (
       UPDATE trips SET ops_status = $1, ops_reason = $2, ops_reason_by = $3, ops_reason_at = ${manual ? 'now()' : 'NULL'},
         last_edited_by = $4, last_edited_at = now()
       WHERE id = $5 RETURNING *
     )
     SELECT updated.*, u.name AS creator_name, le.name AS editor_name
     FROM updated
     LEFT JOIN users u ON u.id = updated.created_by
     LEFT JOIN users le ON le.id = updated.last_edited_by`,
    [opsStatus, manual ? reason.trim() : null, manual ? req.user.name : null, req.user.id, req.params.id]
  );
  res.json(mapTrip(rows[0]));
  logActivity({ actor: req.user, action: 'trip.ops_status_changed', entityType: 'trip', entityId: rows[0].id, entityLabel: rows[0].name, details: { from: trip.ops_status, to: opsStatus, ...(manual ? { reason: reason.trim() } : {}) } });
}));


// Operations checklist (accommodation / flights / add-ons per passenger).
// Stored as one JSON document on the trip:
//   { hotels:[{id,name}], flightsTo:[{id,airline,ref,departure,arrival}],
//     flightsReturn:[...same], pax:{ <passengerId>: { hotelId, roomType, ... } } }
// The request is a PATCH: `lists` replaces whichever of the three shared lists
// are sent, `pax` is merged per passenger and per field — so two people
// editing different passengers at the same time don't overwrite each other.
// Approvers and admins only (the Operations team), submitted trips only.
const clStr = z.string().max(300);
const clFlight = z.object({ id: z.string().max(40), airline: clStr.optional(), ref: clStr.optional(), departure: clStr.optional(), arrival: clStr.optional() });
const clPax = z.object({
  hotelId: clStr, roomType: clStr, roomNumber: clStr,
  toId: clStr, toLuggage: clStr, retId: clStr, retLuggage: clStr,
  addons: z.string().max(2000),
  ticketBy: z.enum(['', 'Excapism', 'Self']),
  hotelDone: z.boolean(), toDone: z.boolean(), retDone: z.boolean(), addonsDone: z.boolean(),
}).partial();
const checklistSchema = z.object({
  lists: z.object({
    hotels: z.array(z.object({ id: z.string().max(40), name: clStr.optional() })).max(60),
    flightsTo: z.array(clFlight).max(60),
    flightsReturn: z.array(clFlight).max(60),
  }).partial().optional(),
  pax: z.record(z.string().max(60), clPax).optional(),
});
router.patch('/:id/ops-checklist', requireRole('approver', 'admin'), asyncHandler(async (req, res) => {
  const patch = checklistSchema.parse(req.body);
  const out = await withTransaction(async (client) => {
    const cur = await client.query('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [req.params.id]);
    const trip = cur.rows[0];
    if (!trip) return { status: 404, error: 'Trip not found' };
    if (['Draft', 'Cancelled', 'Declined'].includes(trip.status)) {
      return { status: 400, error: 'The Operations checklist is available once the trip has been submitted' };
    }
    const doc = trip.ops_checklist && typeof trip.ops_checklist === 'object' ? trip.ops_checklist : {};
    const next = { hotels: doc.hotels || [], flightsTo: doc.flightsTo || [], flightsReturn: doc.flightsReturn || [], pax: doc.pax || {} };
    Object.assign(next, patch.lists || {});
    for (const [pid, fields] of Object.entries(patch.pax || {})) {
      next.pax[pid] = { ...(next.pax[pid] || {}), ...fields };
    }
    await client.query(
      'UPDATE trips SET ops_checklist = $1, last_edited_by = $2, last_edited_at = now() WHERE id = $3',
      [JSON.stringify(next), req.user.id, req.params.id]
    );
    return { status: 200, checklist: next, trip };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json({ opsChecklist: out.checklist });
}));

// ---------------------------------------------------------------
// Bulk import — mirrors the frontend's client-side grouping logic, just
// done server-side/atomically: each row carries tripType + location: rows
// sharing both are grouped into one trip (matched to an existing Draft/
// any-status trip with the same type+destination, or created fresh as
// Draft), then all passengers are inserted in a single transaction. Every
// passenger created this way gets pic_id set to whoever ran the import.
// ---------------------------------------------------------------
const importRowSchema = z.object({
  name: z.string().min(1),
  dob: z.string().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  idNumber: z.string().optional().or(z.literal('')),
  tripType: z.string().optional().or(z.literal('')),
  location: z.string().optional().or(z.literal('')),
  medicalCondition: z.string().optional().or(z.literal('')),
  passportNumber: z.string().optional().or(z.literal('')),
  passportExpiry: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  timestamp: z.string().optional().or(z.literal('')),
  amount: z.number().nonnegative().max(100000000).optional(),
  deposit: z.number().nonnegative().max(100000000).optional(),
  route: z.string().max(200).optional().or(z.literal('')),
  ticketPurchaser: z.enum(['Self Purchase', 'Excapism']).optional().or(z.literal('')),
});
const importSchema = z.object({ rows: z.array(importRowSchema).min(1) });

// Same person already in the trip? Same name, unless both sides have an IC/passport and they differ.
const normName = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normId = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isSamePerson = (a, b) => a.name === b.name && !(a.id && b.id && a.id !== b.id);

router.post('/bulk-import', asyncHandler(async (req, res) => {
  const { rows } = importSchema.parse(req.body);

  const groups = new Map();
  for (const r of rows) {
    const type = /private/i.test(r.tripType || '') ? 'private' : 'open';
    const location = (r.location || '').trim() || 'Unspecified destination';
    const route = (r.route || '').replace(/\s+/g, ' ').trim();
    const key = `${type}|${location.toLowerCase()}|${route.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { type, location, route, rows: [] });
    groups.get(key).rows.push(r);
  }

  const result = await withTransaction(async (client) => {
    let importedCount = 0;
    let skippedCount = 0;
    let createdTripCount = 0;
    const tripIds = [];

    for (const g of groups.values()) {
      // A row with a Route only joins a trip with the same route; a row without one joins any trip for that country.
      const existing = g.route
        ? await client.query('SELECT id FROM trips WHERE type = $1 AND lower(destination) = lower($2) AND lower(route) = lower($3) LIMIT 1', [g.type, g.location, g.route])
        : await client.query('SELECT id FROM trips WHERE type = $1 AND lower(destination) = lower($2) LIMIT 1', [g.type, g.location]);
      let tripId = existing.rows[0]?.id;

      if (!tripId) {
        const history = JSON.stringify([{ status: 'Draft', date: new Date().toISOString() }]);
        const created = await client.query(
          `INSERT INTO trips (name, type, destination, route, status, history, created_by, last_edited_by, last_edited_at)
           VALUES ($1,$2,$3,$4,'Draft',$5,$6,$6,now()) RETURNING id`,
          [g.route ? `${g.location} – ${g.route}` : g.location, g.type, g.location, g.route || null, history, req.user.id]
        );
        tripId = created.rows[0].id;
        createdTripCount += 1;
      }
      tripIds.push(tripId);

      // People already in this trip (not cancelled) — and, as rows are saved, the ones from this file —
      // so a re-uploaded file or a repeated row is skipped instead of duplicated.
      const known = (await client.query(
        "SELECT name, id_number, passport_number FROM passengers WHERE trip_id = $1 AND payment_status <> 'Cancelled'", [tripId]
      )).rows.map((x) => ({ name: normName(x.name), id: normId(x.id_number || x.passport_number) }));

      for (const r of g.rows) {
        const who = { name: normName(r.name), id: normId(r.idNumber || r.passportNumber) };
        if (known.some((k) => isSamePerson(k, who))) { skippedCount += 1; continue; }
        known.push(who);
        // Same payment-status rule as PUT /passengers/:id/payments. A deposit larger than the package is ignored.
        const amount = Math.round((r.amount || 0) * 100) / 100;
        let deposit = Math.round((r.deposit || 0) * 100) / 100;
        if (amount > 0 && deposit > amount) deposit = 0;
        const payStatus = (amount > 0 && deposit >= amount) ? 'Paid' : deposit > 0 ? 'Deposit' : 'Pending';
        await client.query(
          `INSERT INTO passengers
             (trip_id, name, dob, phone, id_number, medical_condition, passport_number, passport_expiry, pic_id, notes, submitted_at, ticket_purchaser,
              amount, deposit_amount, payment_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            tripId, r.name, r.dob || null, r.phone || null, r.idNumber || null,
            r.medicalCondition || null, r.passportNumber || null, r.passportExpiry || null,
            req.user.id, r.notes || null, r.timestamp || null, r.ticketPurchaser || null,
            amount, deposit, payStatus,
          ]
        );
        importedCount += 1;
      }
    }

    return { importedCount, skippedCount, createdTripCount, tripIds: [...new Set(tripIds)] };
  });

  // Remember any route that came with the file (after the transaction — the pool has a single connection).
  for (const g of groups.values()) {
    if (g.route && g.location !== 'Unspecified destination') await ensureItem({ kind: 'route', country: g.location, name: g.route, userId: req.user.id }).catch(() => {});
  }
  res.status(201).json(result);
  logActivity({ actor: req.user, action: 'trip.bulk_import', entityType: 'bulk_import', entityId: null, entityLabel: `Bulk import (${result.importedCount} passenger${result.importedCount===1?'':'s'})`, details: result });
}));

module.exports = router;
