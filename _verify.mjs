import "./scripts/load-env.mjs";
import { loadEnvLocal } from "./scripts/load-env.mjs";
import { Pool } from "pg";
loadEnvLocal();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const want = {
  system_settings: ["setting_key","setting_value"],
  service_types: ["service_name","description","sort_order","default_category_id","status"],
  booking_channels: ["channel_name","source_system","description","status"],
  notification_preferences: ["employee_id","event_key","channel","enabled"],
  transportation_requests: ["external_booking_id","source_system","booking_reference","guest_name","pickup_location","dropoff_location","pickup_datetime","passenger_count","special_requests","service_type_id","priority","booking_status","fleet_status","reservation_number","requested_category_id","estimated_distance","estimated_duration","vehicle_id","driver_id","reviewed_by","reviewed_at","approved_by","approved_at","is_vip","created_at"],
  dispatchschedules: ["dispatch_number","vehicle_id","driver_id","route_id","request_id","scheduled_departure","scheduled_arrival","actual_departure","actual_arrival","status","priority","notes","created_by","created_at"],
  trips: ["vehicle_id","driver_id","dispatch_id","route_id","start_time","end_time","distance","actual_duration","trip_status","start_odometer","end_odometer","fuel_consumed","avg_speed","max_speed","idle_time","notes","fuel_cost","toll_fees","parking_fees","driver_cost","maintenance_cost","miscellaneous_cost","total_cost","cost_per_km","on_time_completion","time_variance","fuel_efficiency","smooth_driving_score","customer_rating","created_by","created_at"],
  fuelrecords: ["vehicle_id","driver_id","trip_id","liters","amount","price_per_liter","odometer","fuel_type","fuel_date","station_name","status","approved_by","approved_at","created_by","created_at"],
  driverincidents: ["driver_id","vehicle_id","trip_id","incident_type","incident_date","description","location","severity","is_at_fault","status","expense_amount"],
  driverattendance: ["driver_id","date","time_in","time_out","check_in_method","face_confidence","face_verified","status","remarks"],
  vehiclemaintenance: ["vehicle_id","maintenance_type","description","maintenance_date","completed_date","cost","mileage_at_service","service_provider","status","priority","remarks","created_by"],
  vehicleinspection: ["vehicle_id","driver_id","inspection_type","inspection_date","checklist","findings","severity","status"],
  uvvrp_violations: ["vehicle_id","dispatch_id","scheduled_departure","weekday","plate_digit","action","reason","created_by"],
  ai_insights: ["insight_type","title","description","impact","category","confidence_score","status"],
  ai_recommendations: ["recommendation_type","reference_type","reference_id","recommendation_data","confidence_score","explanation","user_id"],
  routes: ["origin","destination","estimated_distance","estimated_duration","deleted_at"],
  vehiclecategories: ["category_name","seating_capacity","deleted_at"],
  drivers: ["deleted_at"],
};

console.log("=== MISSING COLUMNS (script would fail) ===");
let bad = 0;
for (const [t, cols] of Object.entries(want)) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t]
  );
  const have = new Set(rows.map(r => r.column_name));
  if (!rows.length) { console.log(`  TABLE MISSING: ${t}`); bad++; continue; }
  const miss = cols.filter(c => !have.has(c));
  if (miss.length) { console.log(`  ${t}: ${miss.join(", ")}`); bad++; }
}
if (!bad) console.log("  none — all columns exist");

console.log("\n=== NOT-NULL columns with no default that I am NOT supplying ===");
for (const [t, cols] of Object.entries(want)) {
  if (["routes","vehiclecategories","drivers","system_settings"].includes(t)) continue;
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
        AND is_nullable='NO' AND column_default IS NULL AND is_identity='NO'`, [t]
  );
  const supplied = new Set(cols);
  const gaps = rows.map(r => r.column_name).filter(c => !supplied.has(c));
  if (gaps.length) console.log(`  ${t}: ${gaps.join(", ")}`);
}

console.log("\n=== PRIMARY KEYS ===");
for (const t of Object.keys(want)) {
  const { rows } = await pool.query(
    `SELECT a.attname FROM pg_constraint c
       JOIN pg_class r ON r.oid=c.conrelid
       JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=ANY(c.conkey)
      WHERE c.contype='p' AND r.relname=$1 AND r.relnamespace='public'::regnamespace`, [t]
  );
  console.log(`  ${t}: ${rows.map(r=>r.attname).join(", ") || "(none)"}`);
}

console.log("\n=== CHECK CONSTRAINTS on the seeded tables ===");
const { rows: checks } = await pool.query(
  `SELECT r.relname AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
    WHERE c.contype='c' AND r.relnamespace='public'::regnamespace
      AND r.relname = ANY($1::text[]) ORDER BY r.relname, c.conname`,
  [Object.keys(want)]
);
for (const c of checks) console.log(`  ${c.tbl}.${c.conname}: ${c.def}`);

console.log("\n=== numeric precision/scale on seeded numeric cols ===");
const { rows: nums } = await pool.query(
  `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
     FROM information_schema.columns
    WHERE table_schema='public' AND table_name = ANY($1::text[])
      AND data_type IN ('numeric','integer','smallint')
    ORDER BY table_name, column_name`, [Object.keys(want)]
);
for (const n of nums) {
  const cap = n.data_type === "numeric" && n.numeric_precision
    ? ` max ${"9".repeat(n.numeric_precision - n.numeric_scale)}.${"9".repeat(n.numeric_scale)}` : "";
  console.log(`  ${n.table_name}.${n.column_name} ${n.data_type}(${n.numeric_precision ?? ""},${n.numeric_scale ?? ""})${cap}`);
}

console.log("\n=== system_settings shape + existing seed ledger ===");
const { rows: ssc } = await pool.query(
  `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='system_settings' ORDER BY ordinal_position`);
for (const c of ssc) console.log(`  ${c.column_name} ${c.data_type} null=${c.is_nullable} def=${c.column_default ?? "-"}`);
const { rows: ssu } = await pool.query(
  `SELECT c.conname, pg_get_constraintdef(c.oid) d FROM pg_constraint c
     JOIN pg_class r ON r.oid=c.conrelid WHERE r.relname='system_settings'`);
for (const c of ssu) console.log(`  ${c.conname}: ${c.d}`);
const { rows: led } = await pool.query(`SELECT setting_key FROM system_settings WHERE setting_key LIKE 'seed%'`);
console.log(`  existing seed keys: ${led.map(r=>r.setting_key).join(", ") || "(none)"}`);

await pool.end();
