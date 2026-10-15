/**
 * CampusPool API — Cloudflare Worker (fetch handler).
 *
 * Routes:
 *   GET    /api/health
 *   GET    /api/college
 *   GET    /api/rides?vehicle=car|bike&q=&date=
 *   POST   /api/rides
 *   GET    /api/rides/:id
 *   POST   /api/rides/:id/bookings
 *   GET    /api/routes
 *   GET    /api/stats
 *   GET    /api/bookings?contact=
 *   POST   /api/bookings/:id/cancel
 *
 * Anything that is not /api/* falls through to the static asset handler.
 */

/* ------------------------------------------------------------------ *
 * Schema + seed
 * ------------------------------------------------------------------ */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rides (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     driver_name   TEXT    NOT NULL,
     driver_contact TEXT   NOT NULL,
     vehicle_type  TEXT    NOT NULL CHECK (vehicle_type IN ('car','bike')),
     vehicle_model TEXT    NOT NULL DEFAULT '',
     seats_total   INTEGER NOT NULL,
     origin_name   TEXT    NOT NULL,
     origin_lat    REAL    NOT NULL,
     origin_lng    REAL    NOT NULL,
     depart_time   TEXT    NOT NULL,
     days          TEXT    NOT NULL DEFAULT 'Mon-Fri',
     notes         TEXT    NOT NULL DEFAULT '',
     path          TEXT    NOT NULL DEFAULT '[]',
     created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS bookings (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     ride_id      INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
     student_name TEXT    NOT NULL,
     contact      TEXT    NOT NULL,
     seats        INTEGER NOT NULL DEFAULT 1,
     status       TEXT    NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
     created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_ride ON bookings(ride_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_contact ON bookings(contact)`,
];

// The college every route ends at.
const COLLEGE = {
  name: 'COEP Technological University, Pune',
  short: 'COEP Tech',
  lat: 18.5293,
  lng: 73.856,
};

/** Slightly bent line so a route reads as a path rather than a ruler line. */
function pathBetween(a, b, bend = 0.12) {
  const mx = (a.lat + b.lat) / 2;
  const my = (a.lng + b.lng) / 2;
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  return [
    [a.lat, a.lng],
    [mx + dx * bend, my - dy * bend],
    [b.lat, b.lng],
  ];
}

const SEED_RIDES = [
  {
    driver_name: 'Aarav Deshpande',
    driver_contact: 'aarav.d@college.edu',
    vehicle_type: 'car',
    vehicle_model: 'Maruti Swift (MH12 AB 4412)',
    seats_total: 3,
    origin: { name: 'Kothrud Depot', lat: 18.5074, lng: 73.8077 },
    depart_time: '08:15',
    days: 'Mon-Fri',
    notes: 'Leaves sharp at 8:15. Boot space for one backpack only.',
  },
  {
    driver_name: 'Ishita Rane',
    driver_contact: 'ishita.rane@college.edu',
    vehicle_type: 'car',
    vehicle_model: 'Hyundai i20 (MH14 CD 7781)',
    seats_total: 4,
    origin: { name: 'Wakad Bridge', lat: 18.5983, lng: 73.7625 },
    depart_time: '07:45',
    days: 'Mon-Sat',
    notes: 'Takes the Expressway service road. AC always on, no smoking.',
  },
  {
    driver_name: 'Rohit Kamble',
    driver_contact: 'rohit.k@college.edu',
    vehicle_type: 'bike',
    vehicle_model: 'Royal Enfield Classic 350',
    seats_total: 1,
    origin: { name: 'Katraj Chowk', lat: 18.4529, lng: 73.8563 },
    depart_time: '08:30',
    days: 'Mon-Fri',
    notes: 'One pillion seat. Helmet required — I carry a spare.',
  },
  {
    driver_name: 'Sneha Iyer',
    driver_contact: 'sneha.iyer@college.edu',
    vehicle_type: 'car',
    vehicle_model: 'Tata Nexon EV (MH12 EV 2201)',
    seats_total: 3,
    origin: { name: 'Hinjewadi Phase 1', lat: 18.5913, lng: 73.7389 },
    depart_time: '07:30',
    days: 'Mon-Fri',
    notes: 'Electric, so it is cheap — ₹30 per seat per trip.',
  },
  {
    driver_name: 'Kabir Sheikh',
    driver_contact: 'kabir.s@college.edu',
    vehicle_type: 'bike',
    vehicle_model: 'Honda Activa 6G',
    seats_total: 1,
    origin: { name: 'Baner Road', lat: 18.559, lng: 73.7868 },
    depart_time: '08:45',
    days: 'Tue-Sat',
    notes: 'Short hop, 20 minutes door to gate.',
  },
  {
    driver_name: 'Meera Joshi',
    driver_contact: 'meera.joshi@college.edu',
    vehicle_type: 'car',
    vehicle_model: 'Honda City (MH12 EF 9034)',
    seats_total: 4,
    origin: { name: 'Hadapsar Gadital', lat: 18.5089, lng: 73.926 },
    depart_time: '07:50',
    days: 'Mon-Fri',
    notes: 'Returns by 5:30pm too — return leg available for regulars.',
  },
  {
    driver_name: 'Vikram Patil',
    driver_contact: 'vikram.p@college.edu',
    vehicle_type: 'car',
    vehicle_model: 'Maruti Ertiga (MH14 GH 1180)',
    seats_total: 5,
    origin: { name: 'Pimpri Chinchwad', lat: 18.6279, lng: 73.8009 },
    depart_time: '07:20',
    days: 'Mon-Fri',
    notes: 'Big car, splits the toll equally between riders.',
  },
  {
    driver_name: 'Ananya Ghosh',
    driver_contact: 'ananya.g@college.edu',
    vehicle_type: 'bike',
    vehicle_model: 'TVS Ntorq 125',
    seats_total: 1,
    origin: { name: 'Viman Nagar', lat: 18.5679, lng: 73.9143 },
    depart_time: '08:05',
    days: 'Mon-Sat',
    notes: 'Avoids the Koregaon Park traffic, never late.',
  },
];

let schemaReady = null;

async function seedIfEmpty(env) {
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS c FROM rides').all();
  if (Number(results?.[0]?.c || 0) > 0) return;

  const stmt = env.DB.prepare(
    `INSERT INTO rides
       (driver_name, driver_contact, vehicle_type, vehicle_model, seats_total,
        origin_name, origin_lat, origin_lng, depart_time, days, notes, path)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  await env.DB.batch(
    SEED_RIDES.map((r) =>
      stmt.bind(
        r.driver_name,
        r.driver_contact,
        r.vehicle_type,
        r.vehicle_model,
        r.seats_total,
        r.origin.name,
        r.origin.lat,
        r.origin.lng,
        r.depart_time,
        r.days,
        r.notes,
        JSON.stringify(pathBetween(r.origin, COLLEGE)),
      ),
    ),
  );
}

function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
      await seedIfEmpty(env);
    })().catch((err) => {
      schemaReady = null; // allow a retry on the next request
      throw err;
    });
  }
  return schemaReady;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

const fail = (status, message) => json({ error: message }, status);

function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin form post / curl / tests
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function trim(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

const SEAT_LIMITS = { car: 6, bike: 1 };

function validateRide(body) {
  const errors = [];
  const vehicle_type = trim(body.vehicle_type, 8).toLowerCase();
  if (!SEAT_LIMITS[vehicle_type]) errors.push('vehicle_type must be "car" or "bike"');

  const driver_name = trim(body.driver_name, 60);
  if (driver_name.length < 2) errors.push('driver_name is required');

  const driver_contact = trim(body.driver_contact, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(driver_contact) && !/^[\d+\-\s()]{7,20}$/.test(driver_contact)) {
    errors.push('driver_contact must be an email or phone number');
  }

  const origin_name = trim(body.origin_name, 80);
  if (origin_name.length < 2) errors.push('origin_name is required');

  const origin_lat = num(body.origin_lat);
  const origin_lng = num(body.origin_lng);
  if (origin_lat === null || origin_lat < -90 || origin_lat > 90) errors.push('origin_lat must be a latitude');
  if (origin_lng === null || origin_lng < -180 || origin_lng > 180) errors.push('origin_lng must be a longitude');

  const depart_time = trim(body.depart_time, 20);
  if (!/^\d{2}:\d{2}$/.test(depart_time)) errors.push('depart_time must be HH:MM');

  const seats_total = num(body.seats_total);
  const limit = SEAT_LIMITS[vehicle_type] ?? 0;
  if (!Number.isInteger(seats_total) || seats_total < 1 || seats_total > limit) {
    errors.push(`seats_total must be between 1 and ${limit} for a ${vehicle_type || 'vehicle'}`);
  }

  return {
    errors,
    value: {
      driver_name,
      driver_contact,
      vehicle_type,
      vehicle_model: trim(body.vehicle_model, 80),
      seats_total,
      origin_name,
      origin_lat,
      origin_lng,
      depart_time,
      days: trim(body.days, 40) || 'Mon-Fri',
      notes: trim(body.notes, 300),
    },
  };
}

/** Ride row + live seat accounting + route geometry. */
function decorate(row, booked) {
  const seats_taken = Number(booked || 0);
  const path = safePath(row.path);
  return {
    id: row.id,
    driver_name: row.driver_name,
    driver_contact: row.driver_contact,
    vehicle_type: row.vehicle_type,
    vehicle_model: row.vehicle_model,
    seats_total: row.seats_total,
    seats_taken,
    seats_available: Math.max(0, row.seats_total - seats_taken),
    origin_name: row.origin_name,
    origin_lat: row.origin_lat,
    origin_lng: row.origin_lng,
    depart_time: row.depart_time,
    days: row.days,
    notes: row.notes,
    path,
    destination: COLLEGE,
    created_at: row.created_at,
  };
}

function safePath(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed) && parsed.length >= 2) return parsed;
  } catch {
    /* fall through to the straight line below */
  }
  return null;
}

const RIDES_QUERY = `
  SELECT r.*, COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.seats END), 0) AS booked
  FROM rides r
  LEFT JOIN bookings b ON b.ride_id = r.id
`;

/* ------------------------------------------------------------------ *
 * Route handlers
 * ------------------------------------------------------------------ */

async function listRides(request, env) {
  const url = new URL(request.url);
  const vehicle = trim(url.searchParams.get('vehicle'), 8).toLowerCase();
  const q = trim(url.searchParams.get('q'), 60).toLowerCase();
  const date = trim(url.searchParams.get('date'), 40);

  let sql = `${RIDES_QUERY} WHERE 1 = 1`;
  const params = [];
  if (vehicle === 'car' || vehicle === 'bike') {
    sql += ' AND r.vehicle_type = ?';
    params.push(vehicle);
  }
  if (date && /^[A-Za-z]{3}/.test(date)) {
    sql += ' AND lower(r.days) LIKE ?';
    params.push(`%${date.slice(0, 3).toLowerCase()}%`);
  }
  sql += ' GROUP BY r.id ORDER BY r.depart_time ASC, r.id ASC';

  const { results } = await env.DB.prepare(sql).bind(...params).all();
  let rides = results.map((r) => decorate(r, r.booked));

  if (q) {
    rides = rides.filter((r) =>
      [r.origin_name, r.driver_name, r.vehicle_model, r.days].join(' ').toLowerCase().includes(q),
    );
  }
  rides = rides.filter((r) => r.path || (r.path = pathBetween(r, COLLEGE)));
  return json({ college: COLLEGE, count: rides.length, rides });
}

async function getRide(env, id) {
  const row = await env.DB.prepare(`${RIDES_QUERY} WHERE r.id = ? GROUP BY r.id`).bind(id).first();
  if (!row) return fail(404, 'Ride not found');

  const { results: passengers } = await env.DB.prepare(
    `SELECT id, student_name, seats, status, created_at FROM bookings
     WHERE ride_id = ? AND status = 'confirmed' ORDER BY created_at ASC`,
  ).bind(id).all();

  const ride = decorate(row, row.booked);
  ride.path ||= pathBetween(ride, COLLEGE);
  return json({ ride, passengers });
}

async function createRide(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Request body must be JSON');
  }

  const { errors, value } = validateRide(body);
  if (errors.length) return fail(422, errors.join('; '));

  const mid = { lat: value.origin_lat, lng: value.origin_lng };
  const path = JSON.stringify(pathBetween(mid, COLLEGE));

  const inserted = await env.DB.prepare(
    `INSERT INTO rides
       (driver_name, driver_contact, vehicle_type, vehicle_model, seats_total,
        origin_name, origin_lat, origin_lng, depart_time, days, notes, path)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     RETURNING *`,
  ).bind(
    value.driver_name, value.driver_contact, value.vehicle_type, value.vehicle_model, value.seats_total,
    value.origin_name, value.origin_lat, value.origin_lng, value.depart_time, value.days, value.notes, path,
  ).first();

  return json({ ride: decorate(inserted, 0) }, 201);
}

async function bookSeat(request, env, rideId) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is tolerated so we can report field errors below */
  }

  const student_name = trim(body.student_name, 60);
  const contact = trim(body.contact, 80);
  const seats = num(body.seats ?? 1);

  const errors = [];
  if (student_name.length < 2) errors.push('student_name is required');
  if (!contact) errors.push('contact is required');
  if (!Number.isInteger(seats) || seats < 1 || seats > 4) errors.push('seats must be between 1 and 4');

  const row = await env.DB.prepare(`${RIDES_QUERY} WHERE r.id = ? GROUP BY r.id`).bind(rideId).first();
  if (!row) return fail(404, 'Ride not found');
  if (!errors.length && Number(row.booked) + seats > row.seats_total) {
    errors.push(`Only ${Math.max(0, row.seats_total - row.booked)} seat(s) left on this ride`);
  }
  if (errors.length) return fail(422, errors.join('; '));

  const booking = await env.DB.prepare(
    `INSERT INTO bookings (ride_id, student_name, contact, seats) VALUES (?,?,?,?) RETURNING *`,
  ).bind(rideId, student_name, contact, seats).first();

  const ride = decorate(row, Number(row.booked) + seats);
  return json({ booking, ride }, 201);
}

async function listBookings(request, env) {
  const url = new URL(request.url);
  const contact = trim(url.searchParams.get('contact'), 80).toLowerCase();
  if (!contact) return fail(400, 'contact query parameter is required');

  const { results } = await env.DB.prepare(
    `SELECT b.id, b.ride_id, b.student_name, b.seats, b.status, b.created_at,
            r.driver_name, r.vehicle_type, r.vehicle_model, r.origin_name,
            r.depart_time, r.days, r.origin_lat, r.origin_lng
     FROM bookings b JOIN rides r ON r.id = b.ride_id
     WHERE lower(b.contact) = ?
     ORDER BY b.created_at DESC`,
  ).bind(contact).all();

  const bookings = results.map((b) => ({
    ...b,
    path: pathBetween({ lat: b.origin_lat, lng: b.origin_lng }, COLLEGE),
    destination: COLLEGE,
  }));
  return json({ count: bookings.length, bookings });
}

async function cancelBooking(request, env, bookingId) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* reported below */
  }
  const contact = trim(body.contact, 80).toLowerCase();
  if (!contact) return fail(400, 'contact is required to cancel a booking');

  const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
  if (!booking) return fail(404, 'Booking not found');
  if (booking.contact.toLowerCase() !== contact) return fail(403, 'That contact did not make this booking');
  if (booking.status === 'cancelled') return json({ booking });

  const updated = await env.DB.prepare(
    `UPDATE bookings SET status = 'cancelled' WHERE id = ? RETURNING *`,
  ).bind(bookingId).first();
  return json({ booking: updated });
}

async function stats(env) {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM rides) AS rides,
       (SELECT COUNT(*) FROM rides WHERE vehicle_type = 'car') AS car_rides,
       (SELECT COUNT(*) FROM rides WHERE vehicle_type = 'bike') AS bike_rides,
       (SELECT COALESCE(SUM(seats_total),0) FROM rides) AS seats,
       (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed') AS confirmed_bookings,
       (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed' AND seats >= 1) AS riders`,
  ).first();

  const { results: seatsTaken } = await env.DB.prepare(
    `SELECT COALESCE(SUM(seats),0) AS taken FROM bookings WHERE status = 'confirmed'`,
  ).all();

  return json({
    college: COLLEGE,
    rides: Number(row.rides),
    car_rides: Number(row.car_rides),
    bike_rides: Number(row.bike_rides),
    seats_offered: Number(row.seats),
    seats_taken: Number(seatsTaken?.[0]?.taken || 0),
    confirmed_bookings: Number(row.confirmed_bookings),
  });
}

async function listRoutes(env) {
  const { results } = await env.DB.prepare(`${RIDES_QUERY} GROUP BY r.id ORDER BY r.depart_time`).all();
  const routes = results.map((r) => {
    const ride = decorate(r, r.booked);
    ride.path ||= pathBetween(ride, COLLEGE);
    return ride;
  });
  return json({ college: COLLEGE, count: routes.length, routes });
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (!pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }

    // Mutations must come from our own origin.
    if (request.method !== 'GET' && request.method !== 'HEAD' && !isSameOrigin(request)) {
      return fail(403, 'Cross-origin request rejected');
    }

    try {
      await ensureSchema(env);

      const segments = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
      const [resource, id, action] = segments;

      if (resource === 'health') {
        return json({ ok: true, service: 'campuspool', time: new Date().toISOString() });
      }
      if (resource === 'college') {
        return json({ college: COLLEGE });
      }
      if (resource === 'stats' && request.method === 'GET') {
        return stats(env);
      }
      if (resource === 'routes' && request.method === 'GET') {
        return listRoutes(env);
      }

      if (resource === 'rides') {
        if (!id && request.method === 'GET') return listRides(request, env);
        if (!id && request.method === 'POST') return createRide(request, env);
        if (id && !action && request.method === 'GET') return getRide(env, Number(id));
        if (id && action === 'bookings' && request.method === 'POST') return bookSeat(request, env, Number(id));
      }

      if (resource === 'bookings') {
        if (!id && request.method === 'GET') return listBookings(request, env);
        if (id && action === 'cancel' && request.method === 'POST') return cancelBooking(request, env, Number(id));
      }

      return fail(404, `No route for ${request.method} ${pathname}`);
    } catch (err) {
      console.error('API error', pathname, err?.stack || err);
      return fail(500, 'Internal error: ' + (err?.message || 'unknown'));
    }
  },
};
