import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";
loadEnvLocal();
const p = new Pool({ connectionString: process.env.DATABASE_URL });
const r = await p.query(
  `SELECT vehicle_id, plate_number, vehicle_name, model, manufacturer, vehicle_status, deleted_at IS NULL AS active
     FROM vehicles ORDER BY vehicle_id`
);
console.table(r.rows);
await p.end();