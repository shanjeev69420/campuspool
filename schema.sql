-- CampusPool schema. The Worker also applies this on first request, so this
-- file is only needed when provisioning a fresh remote D1 database.
--
--   wrangler d1 create campuspool
--   wrangler d1 execute campuspool --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS rides (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_name    TEXT    NOT NULL,
  driver_contact TEXT    NOT NULL,
  vehicle_type   TEXT    NOT NULL CHECK (vehicle_type IN ('car','bike')),
  vehicle_model  TEXT    NOT NULL DEFAULT '',
  seats_total    INTEGER NOT NULL,
  origin_name    TEXT    NOT NULL,
  origin_lat     REAL    NOT NULL,
  origin_lng     REAL    NOT NULL,
  depart_time    TEXT    NOT NULL,
  days           TEXT    NOT NULL DEFAULT 'Mon-Fri',
  notes          TEXT    NOT NULL DEFAULT '',
  path           TEXT    NOT NULL DEFAULT '[]',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id      INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  student_name TEXT    NOT NULL,
  contact      TEXT    NOT NULL,
  seats        INTEGER NOT NULL DEFAULT 1,
  status       TEXT    NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_ride ON bookings(ride_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_contact ON bookings(contact);
