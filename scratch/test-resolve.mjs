import { query } from "../src/lib/db.js";

async function run() {
  try {
    const { rows } = await query(
        `UPDATE driverincidents
            SET status = $1::varchar,
                actions_taken = $2,
                acknowledged_at = CASE
                  WHEN $1::varchar = 'Resolved' THEN COALESCE(acknowledged_at, NOW())
                  WHEN $1::varchar = 'Open' AND status = 'Resolved' THEN NULL
                  ELSE acknowledged_at
                END,
                acknowledged_by = CASE
                  WHEN $1::varchar = 'Resolved' THEN COALESCE(acknowledged_by, $4::int)
                  WHEN $1::varchar = 'Open' AND status = 'Resolved' THEN NULL
                  ELSE acknowledged_by
                END,
                resolved_at = CASE
                  WHEN $1::varchar = 'Resolved' THEN COALESCE(resolved_at, NOW())
                  ELSE NULL
                END,
                resolved_by = CASE
                  WHEN $1::varchar = 'Resolved' THEN COALESCE(resolved_by, $4::int)
                  ELSE NULL
                END,
                updated_at = NOW()
          WHERE incident_id = $3 AND deleted_at IS NULL
          RETURNING incident_id, status, actions_taken, acknowledged_at,
                    acknowledged_by, resolved_at, resolved_by`,
        ['Resolved', 'wwefw', 61, 1]
    );
    console.log("Success:", rows);
  } catch (e) {
    console.error("SQL Error:", e);
  }
  process.exit(0);
}

run();
