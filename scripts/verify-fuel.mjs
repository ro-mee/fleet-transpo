import { loadEnvLocal } from './load-env.mjs';
import pg from 'pg';
const { Pool } = pg;

loadEnvLocal();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  try {
    // 1. fuelrecords columns
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name='fuelrecords'
      ORDER BY ordinal_position
    `);
    console.log('=== fuelrecords columns ===');
    console.table(cols.rows);

    // 2. row counts
    for (const t of ['fuelrecords', 'fuelrequests', 'fuelallocations']) {
      const { rows } = await pool.query(`SELECT count(*) AS n FROM ${t}`);
      console.log(`${t} rows: ${rows[0].n}`);
    }
    // fuelconsumption may not exist
    try {
      const { rows } = await pool.query(`SELECT count(*) AS n FROM fuelconsumption`);
      console.log(`fuelconsumption rows: ${rows[0].n}`);
    } catch {
      console.log('fuelconsumption: TABLE DOES NOT EXIST');
    }

    // 3. station_id column existence
    const stationId = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='fuelrecords' AND column_name='station_id'
    `);
    console.log('\nstation_id column exists:', stationId.rows.length > 0);

    // 4. fuelstations table existence
    const fuelStations = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name='fuelstations'
    `);
    console.log('fuelstations table exists:', fuelStations.rows.length > 0);

    // 5. fuelrecords constraints
    const constraints = await pool.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = 'fuelrecords'::regclass
    `);
    console.log('\n=== fuelrecords constraints ===');
    console.table(constraints.rows);

    // 6. fuelrecords indexes
    const indexes = await pool.query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'fuelrecords'
    `);
    console.log('\n=== fuelrecords indexes ===');
    console.table(indexes.rows);

    // 7. sample vehicles fuel profile
    const vehicleFuel = await pool.query(`
      SELECT vehicle_id, plate_number, fuel_type, tank_capacity_l, fuel_efficiency_kmpl, fuel_level, mileage
      FROM vehicles WHERE deleted_at IS NULL ORDER BY vehicle_id LIMIT 5
    `);
    console.log('\n=== sample vehicles fuel profile ===');
    console.table(vehicleFuel.rows);

    // 8. fuelrequests columns
    const reqCols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns WHERE table_name='fuelrequests'
      ORDER BY ordinal_position
    `);
    console.log('\n=== fuelrequests columns ===');
    console.table(reqCols.rows);

    // 9. Existing fuelrecords data
    const records = await pool.query(`SELECT * FROM fuelrecords ORDER BY fuel_record_id`);
    console.log('\n=== existing fuelrecords data ===');
    for (const r of records.rows) {
      console.log(JSON.stringify({
        id: r.fuel_record_id,
        vehicle_id: r.vehicle_id,
        driver_id: r.driver_id,
        trip_id: r.trip_id,
        fuel_request_id: r.fuel_request_id,
        liters: r.liters,
        amount: r.amount,
        price_per_liter: r.price_per_liter,
        station_name: r.station_name,
        fuel_type: r.fuel_type,
        receipt_fuel_type: r.receipt_fuel_type,
        status: r.status,
        receipt_url: r.receipt_url ? 'present' : null,
        odometer: r.odometer,
        fuel_date: r.fuel_date,
        client_submission_id: r.client_submission_id,
      }));
    }

    // 10. Existing fuelrequests data
    const reqs = await pool.query(`SELECT * FROM fuelrequests ORDER BY fuel_request_id`);
    console.log('\n=== existing fuelrequests data ===');
    for (const r of reqs.rows) {
      console.log(JSON.stringify({
        id: r.fuel_request_id,
        vehicle_id: r.vehicle_id,
        driver_id: r.driver_id,
        trip_id: r.trip_id,
        status: r.status,
        requested_liters: r.requested_liters,
        approved_liters: r.approved_liters,
        gauge_photo_url: r.gauge_photo_url ? 'present' : null,
        allocation_month: r.allocation_month,
      }));
    }

  } finally {
    await pool.end();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
