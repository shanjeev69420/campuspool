/* CampusPool front-end — hash-routed single page app, no build step. */

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');
const toastEl = document.getElementById('toast');

const state = {
  college: { name: 'your campus', short: 'campus', lat: 18.5293, lng: 73.856 },
  rides: [],
  routes: [],
  filters: { vehicle: 'all', q: '', day: '' },
  myContact: localStorage.getItem('campuspool.contact') || '',
};

let map = null;
let routeLayer = null;
let activeRouteId = null;

/* ---------------------------- tiny helpers ---------------------------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Unexpected response (${res.status})`);
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message, bad = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('bad', bad);
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.hidden = true; }, 3600);
}

const vehicleLabel = (v) => (v === 'car' ? 'Car' : 'Bike');
const initials = (name) =>
  String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');

function openModal(html) {
  modalBody.innerHTML = html;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.hidden = true;
  modalBody.innerHTML = '';
  document.body.style.overflow = '';
}

modal.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-modal]')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.hidden) closeModal();
});

/* ---------------------------- rendering ---------------------------- */

function seatDots(ride) {
  const dots = [];
  for (let i = 0; i < ride.seats_total; i += 1) {
    dots.push(`<i class="${i < ride.seats_available ? 'on' : ''}"></i>`);
  }
  return `<span class="seat-dots" title="${ride.seats_available} of ${ride.seats_total} seats free">${dots.join('')}</span>`;
}

function rideCard(ride) {
  const full = ride.seats_available <= 0;
  return `
    <article class="card ride" data-ride="${ride.id}">
      <div class="ride-head">
        <div>
          <div class="ride-driver">${esc(ride.driver_name)}</div>
          <div class="ride-sub">${esc(ride.vehicle_model || vehicleLabel(ride.vehicle_type))}</div>
        </div>
        <span class="badge ${ride.vehicle_type}">${vehicleLabel(ride.vehicle_type)}</span>
      </div>

      <div class="route-line">
        <span class="dot"></span>
        <span class="origin-name">${esc(ride.origin_name)}</span>
        <span class="dash"></span>
        <span class="dot end"></span>
        <span class="end-name">${esc(state.college.short)}</span>
      </div>

      <div class="route-line" style="gap:8px">
        <span class="pill">Departs <b>${esc(ride.depart_time)}</b></span>
        <span class="pill">${esc(ride.days)}</span>
      </div>

      <div class="seat-row">
        ${seatDots(ride)}
        <span>${full ? 'Full' : `${ride.seats_available} seat${ride.seats_available === 1 ? '' : 's'} free`}</span>
      </div>

      ${ride.notes ? `<p class="ride-notes">${esc(ride.notes)}</p>` : ''}

      <div class="ride-actions">
        <button data-book="${ride.id}" ${full ? 'disabled' : ''}>${full ? 'No seats left' : 'Book a seat'}</button>
        <button class="ghost" data-map="${ride.id}">View route</button>
      </div>
    </article>`;
}

async function loadStats() {
  try {
    return await api('/api/stats');
  } catch {
    return null;
  }
}

function statStrip(s) {
  if (!s) return '';
  return `<div class="stat-strip">
    <div class="stat"><b>${s.rides}</b><span>Rides posted</span></div>
    <div class="stat"><b>${s.car_rides}</b><span>Cars</span></div>
    <div class="stat"><b>${s.bike_rides}</b><span>Bikes</span></div>
    <div class="stat"><b>${Math.max(0, s.seats_offered - s.seats_taken)}</b><span>Seats open</span></div>
  </div>`;
}

/* ---------------------------- find a ride ---------------------------- */

async function renderFind() {
  view.innerHTML = `
    <section class="hero">
      <div>
        <h1>Share the ride to ${esc(state.college.name)}</h1>
        <p>Students driving in from across the city post their spare seats here — cars and bikes. Pick one, book, and ride together.</p>
      </div>
      <div id="stats"></div>
    </section>

    <form class="card toolbar" id="filters">
      <div class="seg" id="vehicle-seg">
        <button type="button" data-vehicle="all" class="active">All</button>
        <button type="button" data-vehicle="car">Cars</button>
        <button type="button" data-vehicle="bike">Bikes</button>
      </div>
      <div class="field grow">
        <label for="q">Search</label>
        <input id="q" name="q" placeholder="Area, driver or vehicle" value="${esc(state.filters.q)}" />
      </div>
      <div class="field">
        <label for="day">Day</label>
        <select id="day" name="day">
          <option value="">Any day</option>
          ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            .map((d) => `<option value="${d}" ${state.filters.day === d ? 'selected' : ''}>${d}</option>`)
            .join('')}
        </select>
      </div>
      <button class="ghost" type="button" id="clear">Reset</button>
    </form>

    <div id="ride-grid"><div class="skeleton">Loading rides…</div></div>`;

  loadStats().then((s) => {
    const el = document.getElementById('stats');
    if (el) el.innerHTML = statStrip(s);
  });

  const seg = document.getElementById('vehicle-seg');
  seg.querySelectorAll('button').forEach((btn) => {
    if (btn.dataset.vehicle === state.filters.vehicle) btn.classList.add('active');
    else btn.classList.remove('active');
    btn.addEventListener('click', () => {
      state.filters.vehicle = btn.dataset.vehicle;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      refreshRides();
    });
  });

  const form = document.getElementById('filters');
  let debounce;
  form.addEventListener('input', (e) => {
    if (e.target.name === 'q') {
      state.filters.q = e.target.value;
      clearTimeout(debounce);
      debounce = setTimeout(refreshRides, 220);
    }
    if (e.target.name === 'day') {
      state.filters.day = e.target.value;
      refreshRides();
    }
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('click', (e) => {
    if (e.target.id !== 'clear') return;
    state.filters = { vehicle: 'all', q: '', day: '' };
    renderFind();
  });

  await refreshRides();
}

async function refreshRides() {
  const grid = document.getElementById('ride-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="skeleton">Loading rides…</div>';
  try {
    const params = new URLSearchParams();
    if (state.filters.vehicle !== 'all') params.set('vehicle', state.filters.vehicle);
    if (state.filters.q) params.set('q', state.filters.q);
    if (state.filters.day) params.set('date', state.filters.day);
    const data = await api(`/api/rides?${params}`);
    state.rides = data.rides;
    if (data.college) applyCollege(data.college);
  } catch (err) {
    grid.innerHTML = `<div class="error-box">Could not load rides: ${esc(err.message)}</div>`;
    return;
  }
  if (!state.rides.length) {
    grid.innerHTML = `<div class="empty card"><h3>No rides match that</h3><p>Try clearing the filters, or post your own ride.</p><a class="pill" href="#/offer">Offer a ride →</a></div>`;
  } else {
    grid.innerHTML = `<div class="grid">${state.rides.map(rideCard).join('')}</div>`;
  }
  loadStats().then((s) => {
    const el = document.getElementById('stats');
    if (el) el.innerHTML = statStrip(s);
  });
}

function applyCollege(college) {
  state.college = college;
  document.getElementById('brand-sub').textContent = `Ride sharing for ${college.short}`;
  document.getElementById('foot-college').textContent = college.name;
}

/* ---------------------------- booking ---------------------------- */

function openBooking(rideId) {
  const ride = state.rides.find((r) => r.id === Number(rideId));
  if (!ride) return;
  const max = Math.min(4, ride.seats_available);

  openModal(`
    <h2 id="modal-title">Book a seat with ${esc(ride.driver_name)}</h2>
    <p class="hint">${esc(ride.origin_name)} → ${esc(state.college.name)} · departs ${esc(ride.depart_time)} (${esc(ride.days)})</p>
    <div id="booking-error"></div>
    <form id="booking-form" class="form-grid">
      <div class="field span-2">
        <label for="student_name">Your name</label>
        <input id="student_name" name="student_name" required placeholder="e.g. Priya Nair" />
      </div>
      <div class="field span-2">
        <label for="contact">Email or phone</label>
        <input id="contact" name="contact" required value="${esc(state.myContact)}" placeholder="you@college.edu" />
      </div>
      <div class="field">
        <label for="seats">Seats</label>
        <select id="seats" name="seats">
          ${Array.from({ length: max }, (_, i) => i + 1)
            .map((n) => `<option value="${n}">${n}</option>`)
            .join('')}
        </select>
      </div>
      <div class="field span-2 row-gap" style="align-items:flex-end">
        <button type="submit" id="book-submit">Confirm booking (${ride.seats_available} left)</button>
        <button type="button" class="ghost" data-close-modal>Cancel</button>
      </div>
    </form>`);

  document.getElementById('booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = document.getElementById('book-submit');
    const errBox = document.getElementById('booking-error');
    const payload = Object.fromEntries(new FormData(form));
    payload.seats = Number(payload.seats);

    btn.disabled = true;
    btn.textContent = 'Booking…';
    errBox.innerHTML = '';
    try {
      const data = await api(`/api/rides/${ride.id}/bookings`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      state.myContact = payload.contact;
      localStorage.setItem('campuspool.contact', payload.contact);
      closeModal();
      toast(`Seat booked with ${data.ride.driver_name} — ${data.ride.seats_available} left on that ride.`);
      refreshRides();
    } catch (err) {
      errBox.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Confirm booking';
    }
  });
}

/* ---------------------------- offer a ride ---------------------------- */

function renderOffer() {
  view.innerHTML = `
    <section class="hero">
      <div>
        <h1>Offer a ride</h1>
        <p>Driving to ${esc(state.college.name)}? Post your empty seats. Cars can offer up to 6 seats, bikes offer 1 pillion seat.</p>
      </div>
      <div class="pill-row">
        <span class="pill">Free to post</span>
        <span class="pill">Cancel anytime</span>
      </div>
    </section>

    <form class="card form-card" id="offer-form">
      <div id="offer-error"></div>
      <div class="form-grid">
        <div class="field">
          <label for="driver_name">Your name</label>
          <input id="driver_name" name="driver_name" required placeholder="e.g. Aarav Deshpande" />
        </div>
        <div class="field">
          <label for="driver_contact">Email or phone</label>
          <input id="driver_contact" name="driver_contact" required placeholder="you@college.edu" />
        </div>

        <div class="field">
          <label for="vehicle_type">Vehicle</label>
          <select id="vehicle_type" name="vehicle_type">
            <option value="car">Car</option>
            <option value="bike">Bike</option>
          </select>
        </div>
        <div class="field">
          <label for="vehicle_model">Model / plate</label>
          <input id="vehicle_model" name="vehicle_model" placeholder="Maruti Swift (MH12 AB 1234)" />
        </div>
        <div class="field">
          <label for="seats_total">Seats to offer</label>
          <select id="seats_total" name="seats_total"></select>
          <span class="hint" id="seats-hint">Cars: up to 6 seats besides you.</span>
        </div>

        <div class="field span-2">
          <label for="origin_name">Pickup point</label>
          <div class="row-gap">
            <input id="origin_name" name="origin_name" required placeholder="e.g. Kothrud Depot" style="flex:1 1 240px" />
            <button type="button" class="ghost" id="geocode">Find on map</button>
          </div>
          <div id="suggestions"></div>
          <span class="hint" id="origin-status">We need a pickup point so riders can see your route.</span>
        </div>

        <div class="field">
          <label for="origin_lat">Latitude</label>
          <input id="origin_lat" name="origin_lat" type="number" step="0.000001" required />
        </div>
        <div class="field">
          <label for="origin_lng">Longitude</label>
          <input id="origin_lng" name="origin_lng" type="number" step="0.000001" required />
        </div>

        <div class="field">
          <label for="depart_time">Departure time</label>
          <input id="depart_time" name="depart_time" type="time" required value="08:00" />
        </div>
        <div class="field">
          <label for="days">Days</label>
          <select id="days" name="days">
            ${['Mon-Fri', 'Mon-Sat', 'Weekdays', 'Tue-Sat', 'Mon-Thu', 'Weekends', 'Daily']
              .map((d) => `<option>${d}</option>`)
              .join('')}
          </select>
        </div>

        <div class="field span-2">
          <label for="notes">Notes for riders</label>
          <textarea id="notes" name="notes" placeholder="Pickup spot, return trip, cost sharing, luggage space…"></textarea>
        </div>

        <div class="field span-2 row-gap" style="align-items:flex-end">
          <button type="submit" id="offer-submit">Publish ride</button>
          <button type="button" class="ghost" id="prefill">Use a sample pickup point</button>
        </div>
      </div>
    </form>`;

  const typeSel = document.getElementById('vehicle_type');
  const seatSel = document.getElementById('seats_total');
  const hint = document.getElementById('seats-hint');
  const syncSeats = () => {
    const max = typeSel.value === 'bike' ? 1 : 6;
    seatSel.innerHTML = Array.from({ length: max }, (_, i) => {
      const n = i + 1;
      return `<option value="${n}" ${n === Math.min(2, max) ? 'selected' : ''}>${n}</option>`;
    }).join('');
    hint.textContent = typeSel.value === 'bike'
      ? 'A bike carries 1 pillion rider.'
      : 'Cars: up to 6 seats besides you.';
  };
  syncSeats();
  typeSel.addEventListener('change', syncSeats);

  document.getElementById('prefill').addEventListener('click', () => {
    document.getElementById('origin_lat').value = '18.5074';
    document.getElementById('origin_lng').value = '73.8077';
    document.getElementById('origin_name').value ||= 'Kothrud Depot';
    document.getElementById('origin-status').textContent = 'Pickup point set (18.5074, 73.8077).';
  });

  document.getElementById('geocode').addEventListener('click', geocodeOrigin);

  document.getElementById('offer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.currentTarget));
    payload.seats_total = Number(payload.seats_total);
    payload.origin_lat = Number(payload.origin_lat);
    payload.origin_lng = Number(payload.origin_lng);

    const btn = document.getElementById('offer-submit');
    const errBox = document.getElementById('offer-error');
    btn.disabled = true;
    btn.textContent = 'Publishing…';
    errBox.innerHTML = '';
    try {
      const data = await api('/api/rides', { method: 'POST', body: JSON.stringify(payload) });
      toast(`Ride published from ${data.ride.origin_name} at ${data.ride.depart_time}.`);
      location.hash = '#/find';
    } catch (err) {
      errBox.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Publish ride';
    }
  });
}

async function geocodeOrigin() {
  const name = document.getElementById('origin_name').value.trim();
  const status = document.getElementById('origin-status');
  const box = document.getElementById('suggestions');

  if (name.length < 3) {
    status.textContent = 'Type at least three characters of the area name first.';
    return;
  }

  status.textContent = 'Searching…';
  box.innerHTML = '';
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(name)}`,
      { headers: { accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`search failed (${res.status})`);
    const places = await res.json();
    if (!places.length) {
      status.textContent = 'No match found — you can type the latitude and longitude directly.';
      return;
    }
    status.textContent = 'Pick the closest match:';
    box.innerHTML = `<div class="suggestions">${places
      .map(
        (p, i) =>
          `<button type="button" data-place="${i}">${esc(p.display_name)}</button>`,
      )
      .join('')}</div>`;
    box.querySelectorAll('button[data-place]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = places[Number(btn.dataset.place)];
        document.getElementById('origin_lat').value = Number(p.lat).toFixed(6);
        document.getElementById('origin_lng').value = Number(p.lon).toFixed(6);
        document.getElementById('origin_name').value = name;
        box.innerHTML = '';
        status.textContent = `Pickup point set to ${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)}.`;
      });
    });
  } catch (err) {
    status.textContent = `Place search unavailable (${err.message}). Enter latitude and longitude manually.`;
  }
}

/* ---------------------------- routes map ---------------------------- */

function renderRoutes() {
  view.innerHTML = `
    <section class="hero">
      <div>
        <h1>Routes students are taking</h1>
        <p>Every posted ride drawn on the map, colour-coded by vehicle type. Click a route to zoom in, or hover a line to see who drives it.</p>
      </div>
      <div id="route-stats"></div>
    </section>

    <div class="routes-layout">
      <div>
        <div id="map"></div>
        <div class="map-legend">
          <span><i class="swatch" style="background:#2563eb"></i> Car route</span>
          <span><i class="swatch" style="background:#ea580c"></i> Bike route</span>
          <span><i class="swatch" style="background:#0f9d58"></i> ${esc(state.college.short)} campus</span>
        </div>
      </div>
      <div>
        <h2>Routes (${state.routes.length || '—'})</h2>
        <div class="route-list" id="route-list"><div class="skeleton">Loading…</div></div>
      </div>
    </div>`;

  loadRoutes();
}

async function loadRoutes() {
  const list = document.getElementById('route-list');
  try {
    const data = await api('/api/routes');
    state.routes = data.routes;
    if (data.college) applyCollege(data.college);
  } catch (err) {
    if (list) list.innerHTML = `<div class="error-box">Could not load routes: ${esc(err.message)}</div>`;
    return;
  }

  const statsEl = document.getElementById('route-stats');
  if (statsEl) {
    const withSeats = state.routes.filter((r) => r.seats_available > 0).length;
    statsEl.innerHTML = `<div class="stat-strip">
      <div class="stat"><b>${state.routes.length}</b><span>Active routes</span></div>
      <div class="stat"><b>${withSeats}</b><span>With free seats</span></div>
    </div>`;
  }

  drawMap();
  renderRouteList();
}

function drawMap() {
  if (typeof L === 'undefined') {
    document.getElementById('map').innerHTML =
      '<div class="empty">Map library could not load. Route details are listed beside the map.</div>';
    return;
  }

  map = L.map('map', { scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  routeLayer = L.layerGroup().addTo(map);
  const bounds = [];

  state.routes.forEach((r) => {
    const color = r.vehicle_type === 'car' ? '#2563eb' : '#ea580c';
    const line = L.polyline(r.path, { color, weight: 4, opacity: 0.75 })
      .bindTooltip(`${r.driver_name} · ${r.origin_name} · ${r.depart_time}`, { sticky: true })
      .on('click', () => focusRoute(r.id))
      .addTo(routeLayer);

    L.circleMarker([r.origin_lat, r.origin_lng], {
      radius: 6,
      color: '#fff',
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
    })
      .bindTooltip(`${r.origin_name} — ${r.seats_available} seat(s) free`, { direction: 'top' })
      .addTo(routeLayer);

    r._line = line;
    bounds.push(...r.path);
  });

  L.circleMarker([state.college.lat, state.college.lng], {
    radius: 9,
    color: '#fff',
    weight: 2,
    fillColor: '#0f9d58',
    fillOpacity: 1,
  })
    .bindTooltip(state.college.name, { direction: 'top' })
    .addTo(routeLayer);

  if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.15));
  else map.setView([state.college.lat, state.college.lng], 12);

  map.on('click', () => setActiveRoute(null));
}

function renderRouteList() {
  const list = document.getElementById('route-list');
  if (!list) return;
  if (!state.routes.length) {
    list.innerHTML = `<div class="empty card"><p>No routes yet. <a href="#/offer">Offer the first ride.</a></p></div>`;
    return;
  }
  list.innerHTML = state.routes
    .map(
      (r) => `
      <div class="route-item" data-route-item="${r.id}">
        <div class="row">
          <span class="from">${esc(r.origin_name)}</span>
          <span class="badge ${r.vehicle_type}">${vehicleLabel(r.vehicle_type)}</span>
        </div>
        <div class="meta">${esc(r.driver_name)} · ${esc(r.depart_time)} · ${esc(r.days)}</div>
        <div class="meta">${r.seats_available} of ${r.seats_total} seats free</div>
      </div>`,
    )
    .join('');

  list.querySelectorAll('[data-route-item]').forEach((el) => {
    el.addEventListener('click', () => focusRoute(Number(el.dataset.routeItem)));
  });
}

function focusRoute(id) {
  setActiveRoute(id);
  const route = state.routes.find((r) => r.id === Number(id));
  if (!route || !map) return;
  map.fitBounds(L.latLngBounds(route.path).pad(0.25), { animate: true });
  route._line?.setStyle({ weight: 6, opacity: 1 });
}

function setActiveRoute(id) {
  state.routes.forEach((r) => {
    const on = r.id === Number(id);
    if (r._line) {
      r._line.setStyle({
        weight: on ? 6 : 4,
        opacity: on ? 1 : 0.75,
      });
    }
  });
  document.querySelectorAll('[data-route-item]').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.routeItem) === Number(id));
  });
  activeRouteId = id;
}

/* ---------------------------- my bookings ---------------------------- */

function renderBookings() {
  view.innerHTML = `
    <section class="hero">
      <div>
        <h1>My bookings</h1>
        <p>Enter the email or phone number you booked with to see and cancel your seats.</p>
      </div>
    </section>
    <form class="card toolbar" id="bookings-form">
      <div class="field grow">
        <label for="bk-contact">Email or phone</label>
        <input id="bk-contact" name="contact" value="${esc(state.myContact)}" placeholder="you@college.edu" />
      </div>
      <button type="submit">Look up</button>
    </form>
    <div id="bookings-list"></div>`;

  document.getElementById('bookings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const contact = new FormData(e.currentTarget).get('contact').trim();
    if (!contact) return;
    state.myContact = contact;
    localStorage.setItem('campuspool.contact', contact);
    await loadBookings(contact);
  });

  if (state.myContact) loadBookings(state.myContact);
}

async function loadBookings(contact) {
  const list = document.getElementById('bookings-list');
  list.innerHTML = '<div class="skeleton">Loading…</div>';
  try {
    const data = await api(`/api/bookings?contact=${encodeURIComponent(contact)}`);
    if (!data.bookings.length) {
      list.innerHTML = `<div class="empty card"><h3>No bookings for ${esc(contact)}</h3><p>Find a ride and book a seat to see it here.</p></div>`;
      return;
    }
    list.innerHTML = `<div class="grid">${data.bookings
      .map(
        (b) => `
      <article class="card ride">
        <div class="ride-head">
          <div>
            <div class="ride-driver">${esc(b.origin_name)} → ${esc(state.college.short)}</div>
            <div class="ride-sub">${esc(b.driver_name)} · ${esc(b.vehicle_model || vehicleLabel(b.vehicle_type))}</div>
          </div>
          <span class="badge ${b.status === 'confirmed' ? 'ok' : 'full'}">${esc(b.status)}</span>
        </div>
        <div class="route-line" style="gap:8px">
          <span class="pill">Departs <b>${esc(b.depart_time)}</b></span>
          <span class="pill">${esc(b.days)}</span>
          <span class="pill"><b>${b.seats}</b> seat(s)</span>
        </div>
        <div class="ride-sub">Booked for ${esc(b.student_name)} on ${esc(b.created_at)}</div>
        ${b.status === 'confirmed'
          ? `<div class="ride-actions"><button class="danger small" data-cancel="${b.id}">Cancel booking</button></div>`
          : ''}
      </article>`,
      )
      .join('')}</div>`;

    list.querySelectorAll('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Cancel this booking?')) return;
        btn.disabled = true;
        try {
          await api(`/api/bookings/${btn.dataset.cancel}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ contact }),
          });
          toast('Booking cancelled.');
          loadBookings(contact);
        } catch (err) {
          btn.disabled = false;
          toast(err.message, true);
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

/* ---------------------------- router ---------------------------- */

const ROUTES = {
  find: renderFind,
  offer: renderOffer,
  routes: renderRoutes,
  bookings: renderBookings,
};

async function route() {
  const key = (location.hash.replace(/^#\/?/, '') || 'find').split('/')[0];
  const render = ROUTES[key] || renderFind;

  tabs.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  if (map) {
    map.remove();
    map = null;
    routeLayer = null;
  }
  window.scrollTo({ top: 0 });

  try {
    await render();
  } catch (err) {
    view.innerHTML = `<div class="error-box">Something went wrong: ${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);

document.body.addEventListener('click', (e) => {
  const book = e.target.closest('[data-book]');
  if (book) return openBooking(book.dataset.book);
  const mapBtn = e.target.closest('[data-map]');
  if (mapBtn) {
    location.hash = '#/routes';
    setTimeout(() => focusRoute(Number(mapBtn.dataset.map)), 450);
  }
});

(async function boot() {
  try {
    const { college } = await api('/api/college');
    applyCollege(college);
  } catch {
    /* fall back to the built-in defaults */
  }
  route();
})();
