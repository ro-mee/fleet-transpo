const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envFile = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
let dbUrl = '';
for (const line of envFile.split('\n')) {
  if (line.startsWith('DATABASE_URL=')) dbUrl = line.replace('DATABASE_URL=', '').trim();
}
const pool = new Pool({ connectionString: dbUrl });
const q = (text, params) => pool.query(text, params).then((r) => r.rows);

// Mirror of syncVehicleStatus (Reserved removed), via pg instead of the
// supabase SDK. A vehicle is Available unless conditionally grounded.
function isBeforeToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return !Number.isNaN(d.getTime()) && d.getTime() < today.getTime();
}

async function syncVehicleStatus(vehicleId) {
  const vehicle = (await q(`SELECT vehicle_id, vehicle_status, registration_expiry FROM vehicles WHERE vehicle_id = $1`, [vehicleId]))[0];
  if (!vehicle || vehicle.vehicle_status === 'Decommissioned') return null;

  const maintenance = await q(
    `SELECT maintenance_id, status, maintenance_date FROM vehiclemaintenance
      WHERE vehicle_id = $1 AND status IN ('Scheduled','In Progress') AND deleted_at IS NULL`, [vehicleId]);
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const hasActiveMaintenance = (maintenance || []).some((m) => {
    if (m.status === 'In Progress') return true;
    const d = new Date(`${String(m.maintenance_date).slice(0,10)}T00:00:00`);
    return !Number.isNaN(d.getTime()) && d.getTime() <= todayStart.getTime();
  });
  if (hasActiveMaintenance) return 'Under Maintenance';

  const trip = await q(
    `SELECT trip_id FROM trips WHERE vehicle_id = $1 AND trip_status IN ('Trip Started','En Route','Arrived','In Progress') AND deleted_at IS NULL LIMIT 1`, [vehicleId]);
  if (trip.length) return 'In Use';

  if (isBeforeToday(vehicle.registration_expiry)) return 'Registration Expired';

  return 'Available';
}

async function main() {
  const vehicles = await q(`SELECT vehicle_id, plate_number, vehicle_status FROM vehicles WHERE deleted_at IS NULL ORDER BY vehicle_id`);
  for (const v of vehicles) {
    const next = await syncVehicleStatus(v.vehicle_id);
    if (next && next !== v.vehicle_status) {
      await q(`UPDATE vehicles SET vehicle_status = $1, updated_at = NOW() WHERE vehicle_id = $2`, [next, v.vehicle_id]);
      console.log(`${v.vehicle_id} ${v.plate_number}: ${v.vehicle_status} -> ${next}`);
    } else {
      console.log(`${v.vehicle_id} ${v.plate_number}: stays ${v.vehicle_status}`);
    }
  }
  const r = await q(`SELECT vehicle_id, plate_number, vehicle_status FROM vehicles WHERE vehicle_status='Reserved'`);
  console.log('\nSTILL RESERVED:', JSON.stringify(r));
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); });