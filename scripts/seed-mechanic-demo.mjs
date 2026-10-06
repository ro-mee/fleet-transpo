// Reversible mechanic-workshop demo seeder.
//
// A Today's Line with no assigned work is a plausible-looking empty state, so
// the mechanic workspace (`/mechanic/*`, Tasks 2–6) cannot be exercised against
// the live database as it stands: no employee holds role_id 10 and no
// vehiclemaintenance row carries an assigned_mechanic_id. This script plants one
// mechanic employee plus three assigned work orders (Scheduled, In Progress,
// Pending Inspection) so the queue, detail, four-eyes approval, and problem
// queue paths are all walkable in one sign-in. (UI sign-in itself is out of
// scope — the scoped-endpoint tests prove what the pages render.)
//
// Same mechanism as scripts/seed-demo.mjs, not a parallel one:
//   node scripts/seed-mechanic-demo.mjs status   live counts + ledger claim
//   node scripts/seed-mechanic-demo.mjs plan      resolve + validate, write nothing
//   node scripts/seed-mechanic-demo.mjs up        insert the demo set
//   node scripts/seed-mechanic-demo.mjs down      delete exactly what `up` inserted
//
// Why a separate ledger key instead of extending the phase4 seed: the
// `seed:phase4` ledger is already planted live, so `seed:up` refuses; downing
// it to re-plant would destroy existing demo data. The rows here are also
// fixed (not PRNG-generated), so they do not belong in that deterministic
// window. Properties match all the same:
//
// 1. REVERSIBLE. Every inserted primary key is recorded in a ledger row in
//    `system_settings` under SEED_KEY. `down` deletes by id in FK order, then
//    the ledger. Nothing is matched by heuristic, so `down` cannot take a row
//    it did not create. It also sweeps the `Maintenance Due Soon` rows the
//    `trigger_notify_maintenance_due` trigger writes in response to the
//    inserts (maintenance_date is within 7 days by design, so it fires).
//
// 2. DETERMINISTIC. All values are hardcoded constants below. Reference ids
//    (vehicles, creator) are resolved live — never invented — because a seed
//    that makes up its own vehicles tests nothing about this database.
import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";

loadEnvLocal();

const SEED_KEY = "seed:mechanic-demo";
const MARK = "[seed:mechanic]";

// Fixed demo identity. Clearly synthetic address so it can never collide with
// a real hire; no password_hash, so nothing can sign in as it (sign-in is out
// of scope — the row exists so work orders have an assignee to scope to).
const MECHANIC = {
  first_name: "Demo",
  last_name: "Mechanic",
  email: "mechanic.demo@fleetops.test",
  position: "Mechanic",
};

// Fixed work orders. Dates sit on/around the workshop build date so the queue
// ordering (Emergency/High first, then oldest) and the overdue rule
// (Scheduled/In Progress + maintenance_date < CURRENT_DATE) read honestly.
// The Pending Inspection row carries repair_completed_by = the mechanic, which
// is what makes the four-eyes demo path exercisable: the completer cannot
// approve their own work, so a manager must.
const WORK_ORDERS = [
  {
    key: "scheduled",
    maintenance_type: "Brake Service",
    description: `Grinding noise when braking downhill. ${MARK}`,
    maintenance_date: "2026-10-06",
    status: "Scheduled",
    priority: "Normal",
    cost: 4500,
    mileage_at_service: 87250,
    service_provider: "Fleet Care Manila",
    diagnosis: null,
    parts_replaced: null,
    labor_hours: null,
    stamp_started: false,
    stamp_completed: false,
  },
  {
    key: "in_progress",
    maintenance_type: "Oil Change",
    description: `Engine oil past interval; filter clogged. ${MARK}`,
    maintenance_date: "2026-10-06",
    status: "In Progress",
    priority: "High",
    cost: 1800,
    mileage_at_service: 91300,
    service_provider: "Fleet Care Manila",
    diagnosis: "Oil degraded past interval; oil filter clogged.",
    parts_replaced: null,
    labor_hours: null,
    stamp_started: true,
    stamp_completed: false,
  },
  {
    key: "pending_inspection",
    maintenance_type: "Tire Replacement",
    description: `Front tires at wear bar; sidewall cracking on right front. ${MARK}`,
    maintenance_date: "2026-10-05",
    status: "Pending Inspection",
    priority: "Normal",
    cost: 12500,
    mileage_at_service: 88500,
    service_provider: "Fleet Care Manila",
    diagnosis: "Front tires at wear bar; sidewall cracking on right front.",
    parts_replaced: ["2x 265/65R17 all-terrain tire", "wheel balancing"],
    labor_hours: 2.5,
    stamp_started: true,
    stamp_completed: true,
  },
];

async function readLedger(pool) {
  const { rows } = await pool.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
    [SEED_KEY]
  );
  return rows[0]?.setting_value ?? null;
}

/**
 * Reference rows the seed hangs off. Vehicles cycle from the front of the
 * fleet so each order sits on a plated vehicle; the creator is the first
 * fleet_manager (falling back down the staff ladder) so `created_by` names a
 * real author rather than the mechanic grading their own queue.
 */
async function readReference(pool) {
  const ref = {};
  ref.role = (
    await pool.query(`SELECT role_id, role_name FROM roles WHERE role_id = 10`)
  ).rows[0];
  ref.vehicles = (
    await pool.query(
      `SELECT vehicle_id, plate_number FROM vehicles WHERE deleted_at IS NULL ORDER BY vehicle_id`
    )
  ).rows;
  ref.creator = (
    await pool.query(
      `SELECT e.employee_id, r.role_name FROM employees e
         JOIN roles r ON r.role_id = e.role_id
        WHERE e.deleted_at IS NULL
          AND r.role_name IN ('fleet_manager', 'admin', 'super_admin', 'dispatcher')
        ORDER BY CASE r.role_name
          WHEN 'fleet_manager' THEN 0 WHEN 'admin' THEN 1
          WHEN 'super_admin' THEN 2 ELSE 3 END,
          e.employee_id
        LIMIT 1`
    )
  ).rows[0];
  ref.existing = (
    await pool.query(`SELECT employee_id FROM employees WHERE email = $1`, [
      MECHANIC.email,
    ])
  ).rows[0];
  return ref;
}

function validate(ref) {
  const problems = [];
  if (!ref.role || ref.role.role_name !== "mechanic") {
    problems.push("role_id 10 is not a 'mechanic' row (migration 143 not applied?)");
  }
  if (!ref.vehicles.length) problems.push("no non-deleted vehicles to link orders to");
  if (!ref.creator) problems.push("no staff employee to author created_by");
  if (ref.existing) problems.push(`demo email already taken by employee ${ref.existing.employee_id}`);
  return problems;
}

function describePlan(ref) {
  console.log(`\nWould plant the mechanic demo set:\n`);
  console.log(
    `  employee  ${MECHANIC.first_name} ${MECHANIC.last_name} <${MECHANIC.email}> role_id=10 (${ref.role?.role_name})`
  );
  WORK_ORDERS.forEach((wo, i) => {
    const v = ref.vehicles[i % ref.vehicles.length];
    console.log(
      `  wo[${wo.key}]  ${wo.status} / ${wo.priority} / ${wo.maintenance_type} on vehicle ${v.vehicle_id} (${v.plate_number}), created_by=${ref.creator.employee_id} (${ref.creator.role_name})`
    );
  });
  console.log(
    `\nPending Inspection row stamps repair_completed_by = the new mechanic (four-eyes path).`
  );
  console.log(`Trigger note: maintenance_dates are within 7 days, so`);
  console.log(`trigger_notify_maintenance_due will fan out 'Maintenance Due Soon' rows,`);
  console.log(`which \`down\` sweeps by reference id. Nothing written.\n`);
}

async function cmdStatus(pool) {
  const ledger = await readLedger(pool);
  const mech = (
    await pool.query(
      `SELECT e.employee_id, e.email, r.role_name FROM employees e
         JOIN roles r ON r.role_id = e.role_id
        WHERE e.role_id = 10 AND e.deleted_at IS NULL ORDER BY e.employee_id`
    )
  ).rows;
  const assigned = (
    await pool.query(
      `SELECT vm.maintenance_id, vm.status, vm.assigned_mechanic_id, v.plate_number
         FROM vehiclemaintenance vm
         JOIN vehicles v ON v.vehicle_id = vm.vehicle_id
        WHERE vm.assigned_mechanic_id IS NOT NULL AND vm.deleted_at IS NULL
        ORDER BY vm.maintenance_id`
    )
  ).rows;
  console.log(`\nLive mechanic surface\n`);
  console.log(`  ${mech.length} employee(s) with role_id 10`);
  for (const m of mech) console.log(`    employee ${m.employee_id} <${m.email}> (${m.role_name})`);
  console.log(`  ${assigned.length} assigned work order(s)`);
  for (const a of assigned) {
    console.log(`    wo ${a.maintenance_id} ${a.status} -> mechanic ${a.assigned_mechanic_id} (${a.plate_number})`);
  }
  if (!ledger) {
    console.log(`\nNo seed ledger (${SEED_KEY}). Nothing planted by this script.\n`);
    return;
  }
  console.log(`\nSeed ledger ${SEED_KEY} — planted ${ledger.planted_at}`);
  console.log(`  employee ${ledger.ids.employee}`);
  console.log(`  work orders ${(ledger.ids.workOrders ?? []).join(", ")}`);
  console.log(`\nRun \`node scripts/seed-mechanic-demo.mjs down\` to remove exactly these rows.\n`);
}

/** Resolve references and validate without writing anything. */
async function cmdPlan(pool) {
  const ref = await readReference(pool);
  describePlan(ref);
  const problems = validate(ref);
  if (problems.length) {
    console.log(`${problems.length} problem(s) — resolve before planting:`);
    for (const p of problems) console.log(`  ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`All references resolve. Nothing written.\n`);
  }
}

async function cmdUp(pool) {
  if (await readLedger(pool)) {
    console.error(`\nAlready seeded — ledger ${SEED_KEY} exists.`);
    console.error(`Run \`down\` first if you want to re-seed.\n`);
    process.exitCode = 1;
    return;
  }
  const ref = await readReference(pool);
  const problems = validate(ref);
  if (problems.length) {
    console.error(`\nRefusing to seed:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const emp = await client.query(
      `INSERT INTO employees (first_name, last_name, email, position, role_id, status)
       VALUES ($1, $2, $3, $4, 10, 'Active') RETURNING employee_id`,
      [MECHANIC.first_name, MECHANIC.last_name, MECHANIC.email, MECHANIC.position]
    );
    const mechanicId = emp.rows[0].employee_id;

    const workOrderIds = [];
    for (let i = 0; i < WORK_ORDERS.length; i++) {
      const wo = WORK_ORDERS[i];
      const vehicle = ref.vehicles[i % ref.vehicles.length];
      // Conditionals are resolved in JS, not in CASE expressions: reusing one
      // parameter in two differently-typed positions makes Postgres deduce
      // conflicting types for it ("text versus integer" on $10).
      const now = new Date();
      const res = await client.query(
        `INSERT INTO vehiclemaintenance
           (vehicle_id, maintenance_type, description, maintenance_date, status,
            priority, cost, mileage_at_service, service_provider,
            assigned_mechanic_id, assigned_at, repair_started_at,
            diagnosis, parts_replaced, labor_hours,
            repair_completed_by, repair_completed_at,
            remarks, created_by)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            NOW(), $11,
            $12, $13::jsonb, $14,
            $15, $16,
            $17, $18)
         RETURNING maintenance_id`,
        [
          vehicle.vehicle_id,
          wo.maintenance_type,
          wo.description,
          wo.maintenance_date,
          wo.status,
          wo.priority,
          wo.cost,
          wo.mileage_at_service,
          wo.service_provider,
          mechanicId,
          wo.stamp_started ? now : null,
          wo.diagnosis,
          JSON.stringify(wo.parts_replaced ?? []),
          wo.labor_hours,
          wo.stamp_completed ? mechanicId : null,
          wo.stamp_completed ? now : null,
          MARK,
          ref.creator.employee_id,
        ]
      );
      workOrderIds.push(res.rows[0].maintenance_id);
    }

    // Ledger inside the same transaction as the data (see seed-demo.mjs: a
    // separately-committed ledger could describe rolled-back rows).
    const ledger = {
      planted_at: new Date().toISOString(),
      marker: MARK,
      ids: { employee: mechanicId, workOrders: workOrderIds },
    };
    await client.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
      [SEED_KEY, JSON.stringify(ledger)]
    );

    await client.query("COMMIT");
    console.log(`\nPlanted mechanic demo set:`);
    console.log(`  employee ${mechanicId} <${MECHANIC.email}> role_id=10`);
    WORK_ORDERS.forEach((wo, i) =>
      console.log(`  wo ${workOrderIds[i]} ${wo.status} (${wo.key})`)
    );
    console.log(`\nLedger written to system_settings['${SEED_KEY}'].`);
    console.log(`Reverse with: node scripts/seed-mechanic-demo.mjs down\n`);
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function cmdDown(pool) {
  const ledger = await readLedger(pool);
  if (!ledger) {
    console.log(`\nNo seed ledger (${SEED_KEY}) — nothing to remove.\n`);
    return;
  }
  const ids = ledger.ids ?? {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Notifications the due-soon trigger wrote in response to the inserts.
    // Matched on the exact reference ids, so nothing else is touched.
    if (ids.workOrders?.length) {
      const n = await client.query(
        `DELETE FROM notifications WHERE reference_type IN ('maintenance','mechanic_maintenance') AND reference_id = ANY($1::int[])`,
        [ids.workOrders]
      );
      if (n.rowCount) console.log(`  ${String(n.rowCount).padStart(6)}  notifications (maintenance)`);
    }
    if (ids.workOrders?.length) {
      const w = await client.query(
        `DELETE FROM vehiclemaintenance WHERE maintenance_id = ANY($1::int[])`,
        [ids.workOrders]
      );
      console.log(`  ${String(w.rowCount).padStart(6)}  vehiclemaintenance`);
    }
    if (ids.employee) {
      const e = await client.query(
        `DELETE FROM employees WHERE employee_id = $1`,
        [ids.employee]
      );
      console.log(`  ${String(e.rowCount).padStart(6)}  employees`);
    }

    await client.query(`DELETE FROM system_settings WHERE setting_key = $1`, [SEED_KEY]);
    await client.query("COMMIT");
    console.log(`\nLedger ${SEED_KEY} removed. The seed is fully reversed.\n`);
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

const COMMANDS = { status: cmdStatus, plan: cmdPlan, up: cmdUp, down: cmdDown };

const cmd = process.argv[2] ?? "status";
if (!COMMANDS[cmd]) {
  console.error(`Unknown command "${cmd}". Use: status | plan | up | down`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env.local or .env).");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await COMMANDS[cmd](pool);
} catch (e) {
  console.error(`\n${cmd} failed: ${e.message}\n`);
  if (e.detail) console.error(`  detail: ${e.detail}`);
  if (e.constraint) console.error(`  constraint: ${e.constraint}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
