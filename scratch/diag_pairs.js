const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const envFile = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
let dbUrl = '';
for (const line of envFile.split('\n')) if (line.startsWith('DATABASE_URL=')) dbUrl = line.replace('DATABASE_URL=', '').trim();
const pool = new Pool({ connectionString: dbUrl });
const q = (text, params) => pool.query(text, params).then((r) => r.rows);

async function main() {
  // Pick a pickup window (the request they're assigning). Use one recent request.
  const req = (await q(`SELECT request_id, pickup_datetime, requested_category_id, passenger_count FROM transportation_requests WHERE deleted_at IS NULL ORDER BY pickup_datetime DESC LIMIT 1`))[0];
  if (!req) { console.log('no requests'); await pool.end(); return; }
  const pickup = req.pickup_datetime ? new Date(req.pickup_datetime).toISOString() : null;
  const cat = req.requested_category_id ?? null;
  const pax = Number(req.passenger_count) || 1;
  console.log('=== REQUEST', req.request_id, 'pickup', pickup, 'cat', cat, 'pax', pax);

  // 1) vehicles that pass the WINDOWED gate (statuses + NOT EXISTS overlap).
  const vehicles = await q(
    `SELECT v.vehicle_id, v.plate_number, v.vehicle_status, v.category_id, v.seating_capacity,
            v.registration_expiry, v.insurance_expiry
       FROM vehicles v
      WHERE v.vehicle_status IN ('Available','Reserved') AND v.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM dispatchschedules ds
           WHERE ds.vehicle_id = v.vehicle_id AND ds.deleted_at IS NULL
             AND ds.status IN ('Scheduled','In Progress')
             AND ds.scheduled_departure < $1::timestamptz
             AND COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $2::timestamptz
        )`,
    [pickup, pickup]
  );
  console.log('\nvehicles windowed-available (pre reg/ins):', vehicles.length);

  // 2) drivers Available + not overlapping the window.
  const drivers = await q(
    `SELECT d.driver_id, d.driver_status, d.license_expiry FROM drivers d
      WHERE d.deleted_at IS NULL AND d.driver_status='Available'
        AND NOT EXISTS (
          SELECT 1 FROM dispatchschedules ds
           WHERE ds.driver_id = d.driver_id AND ds.deleted_at IS NULL
             AND ds.status IN ('Scheduled','In Progress')
             AND ds.scheduled_departure < $1::timestamptz
             AND COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $2::timestamptz
        )`,
    [pickup, pickup]
  );
  console.log('drivers Available + window-free:', drivers.length, drivers.map((d) => d.driver_id + ':' + d.driver_status).join(', '));

  // 3) active pairings.
  const pairings = await q(`SELECT assignment_id, vehicle_id, driver_id FROM driver_vehicle_assignments WHERE assigned_until IS NULL`);
  console.log('active pairings:', pairings.length, JSON.stringify(pairings));

  const vById = new Map(vehicles.map((v) => [v.vehicle_id, v]));
  const dById = new Map(drivers.map((d) => [d.driver_id, d]));

  console.log('\n=== PER-PAIRING: why each is or isnt offered ===');
  for (const a of pairings) {
    const v = vById.get(a.vehicle_id);
    const d = dById.get(a.driver_id);
    const reasons = [];
    if (!v) reasons.push(`vehicle not windowed-available (status/overlap/reg-ins)`);
    else {
      if (v.registration_expiry && String(v.registration_expiry).slice(0,10) < String(pickup).slice(0,10)) reasons.push(`reg expired ${String(v.registration_expiry).slice(0,10)}`);
      if (v.insurance_expiry && String(v.insurance_expiry).slice(0,10) < String(pickup).slice(0,10)) reasons.push(`insurance expired ${String(v.insurance_expiry).slice(0,10)}`);
      if (cat != null && v.category_id !== cat) reasons.push(`category ${v.category_id} != ${cat}`);
      if (v.seating_capacity && v.seating_capacity < pax) reasons.push(`seats ${v.seating_capacity} < ${pax}`);
    }
    if (!d) reasons.push('driver not Available/window-free');
    else if (d.license_expiry && String(d.license_expiry).slice(0,10) < String(pickup).slice(0,10)) reasons.push(`driver license expired ${String(d.license_expiry).slice(0,10)}`);
    console.log(`pairing veh=${a.vehicle_id}(v=${v ? v.plate_number : '?'}) drv=${a.driver_id} -> ${reasons.length ? 'DROPPED: ' + reasons.join('; ') : 'OFFERED'}`);
  }

  // Count free-but-not-offered (the footnote) among windowed-available vehicles.
  const offeredVeh = new Set(pairings.map((a) => a.vehicle_id));
  const freeNotOffered = vehicles.filter((v) => !offeredVeh.has(v.vehicle_id));
  console.log('\nfree vehicles NOT offered (footnote):', freeNotOffered.length, freeNotOffered.map((v) => v.plate_number).join(', '));

  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); });