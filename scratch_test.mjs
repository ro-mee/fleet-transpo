import dotenv from 'dotenv';
dotenv.config();

import { query } from './src/lib/db.js';

async function test() {
  try {
    const id = 65;
    const status = 'Resolved';
    const finalActions = 'FWSEFWEFWE';
    const employeeId = 1;

    const { rows } = await query(
      `UPDATE driverincidents
          SET status = $1,
              actions_taken = $2,
              acknowledged_at = CASE
                WHEN $1 = 'Resolved' THEN COALESCE(acknowledged_at, NOW())
                WHEN $1 = 'Open' AND status = 'Resolved' THEN NULL
                ELSE acknowledged_at
              END,
              acknowledged_by = CASE
                WHEN $1 = 'Resolved' THEN COALESCE(acknowledged_by, $4)
                WHEN $1 = 'Open' AND status = 'Resolved' THEN NULL
                ELSE acknowledged_by
              END,
              resolved_at = CASE
                WHEN $1 = 'Resolved' THEN COALESCE(resolved_at, NOW())
                ELSE NULL
              END,
              resolved_by = CASE
                WHEN $1 = 'Resolved' THEN COALESCE(resolved_by, $4)
                ELSE NULL
              END,
              updated_at = NOW()
        WHERE incident_id = $3 AND deleted_at IS NULL
        RETURNING incident_id, status, actions_taken, acknowledged_at,
                  acknowledged_by, resolved_at, resolved_by`,
      [status, finalActions, id, employeeId]
    );
    console.log("Success:", rows[0]);
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
