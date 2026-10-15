# CampusPool

Vehicle pooling for college students. Students driving to campus post their spare
seats; other students search, book a seat, and see the route the driver actually
takes to college.

- **Cars** — up to 6 passenger seats per ride
- **Bikes** — 1 pillion seat per ride
- **Routes** — every posted ride drawn on an OpenStreetMap map, colour coded by
  vehicle type, with free-seat counts per pickup point
- **My bookings** — look bookings up by the email/phone used to book, and cancel

## Stack

| Layer     | Choice                                                              |
| --------- | ------------------------------------------------------------------- |
| Runtime   | Cloudflare Worker (plain `fetch` handler, no framework, no build)   |
| Storage   | D1 (SQLite) — schema created and seeded by the Worker on first hit  |
| Frontend  | Static SPA in `public/` (vanilla JS, hash routing, no build step)   |
| Map       | Leaflet 1.9.4 + OpenStreetMap tiles, from unpkg                     |
| Geocoding | Nominatim/OpenStreetMap place search (optional, for the offer form) |

There is no bundler and no framework: `wrangler dev` serves `public/` as static
assets and routes `/api/*` to `worker/index.js`.

## Layout

```
worker/index.js   API + schema + seed data
public/index.html SPA shell
public/app.js     routing, ride listing, booking, offer form, map
public/styles.css
schema.sql        standalone DDL for provisioning a remote D1 database
wrangler.jsonc    Worker, assets and D1 binding config
```

## Run locally

```bash
npm install
npm run dev          # http://localhost:3001
```

The Worker creates the tables and inserts eight sample Pune rides the first time
it handles a request, so the app is populated immediately. Local data lives in
`.wrangler/state/` (gitignored).

```bash
npm run check                                  # syntax-check worker + front-end
npm run db:local                               # apply schema.sql to local D1
npx wrangler d1 execute campuspool --local \
  --command "DELETE FROM bookings; DELETE FROM rides;"   # reset to empty, re-seeds on next request
```

## API

| Method | Path                        | Purpose                                            |
| ------ | --------------------------- | -------------------------------------------------- |
| GET    | `/api/health`               | Liveness probe                                      |
| GET    | `/api/college`              | Campus name and coordinates                         |
| GET    | `/api/stats`                | Ride / seat counters for the dashboard strip        |
| GET    | `/api/rides`                | `?vehicle=car\|bike`, `?q=`, `?date=Mon`            |
| POST   | `/api/rides`                | Publish a ride                                      |
| GET    | `/api/rides/:id`            | Ride detail plus confirmed passenger list           |
| POST   | `/api/rides/:id/bookings`   | Book seat(s) — rejects when the ride is full        |
| GET    | `/api/routes`               | Every ride with its polyline, for the map           |
| GET    | `/api/bookings?contact=`    | A student's bookings                                |
| POST   | `/api/bookings/:id/cancel`  | Cancel a booking (contact must match the booking)   |

Seat allocation is enforced server-side: a booking is rejected with `422` if the
requested seats exceed what is left on the ride. Non-GET requests with a foreign
`Origin` header are rejected with `403`.

## Deploy

```bash
npx wrangler d1 create campuspool     # copy the printed database_id into wrangler.jsonc
npx wrangler d1 execute campuspool --remote --file=./schema.sql
npx wrangler deploy
```

## Notes

Route polylines are drawn as an approximate bent line from each pickup point to
campus, not a turn-by-turn road path. Swap in a routing API (or store real GPX
traces) if you want road-accurate geometry — the `rides.path` column already
holds a JSON array of `[lat, lng]` points that the map renders verbatim.
