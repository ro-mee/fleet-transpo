// Generate a mermaid erDiagram from the live database's foreign keys.
//
// Why this exists: the ERD note in the vault (Capstone/03 - Database/ERD.md)
// is the readable summary of the schema, but it was hand-drawn and drifted —
// it claimed an integration_log -> transportation_requests FK that does not
// exist and pointed mobile_refresh_tokens at drivers when it actually
// references employees. The reliable source is the database itself, so this
// reads the FK graph the same way dump-schema.mjs reads the structure and
// emits the mermaid block, instead of trusting a human to keep it in sync.
//
// The note deliberately shows only the main business line, because the full
// graph (38 tables, 77 FKs) is unreadable. That selectivity is reproduced
// here as a focus set; --all emits every relationship for review.
//
// Run: node scripts/generate-erd.mjs [--all] [--out FILE]

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";
import pg from "pg";

loadEnvLocal();

const outArgIndex = process.argv.indexOf("--out");
const OUT = outArgIndex !== -1 ? process.argv[outArgIndex + 1] : null;
const ALL = process.argv.includes("--all");

// The "main business line" tables the ERD note shows. A relationship appears
// in the focused diagram only when both of its tables are in this set; leaf /
// cross-cutting tables stay out so the diagram stays readable.
const FOCUS = new Set([
  "employees",
  "drivers",
  "roles",
  "vehiclecategories",
  "vehicles",
  "transportation_requests",
  "reservation_events",
  "dispatchschedules",
  "trips",
  "driver_vehicle_assignments",
  "driver_consents",
  "mobile_refresh_tokens",
  "integration_log",
]);

// Semantic edge labels, keyed by the referencing (child) table and column.
// The default is the FK column name, which is honest but dull; these replace
// the noisy audit columns (created_by, updated_by, ...) with the role the
// relationship plays in the business line.
const LABELS = {
  "drivers.employee_id": "is a",
  "employees.role_id": "has role",
  "vehicles.category_id": "categorises",
  "reservation_events.request_id": "timeline",
  "dispatchschedules.request_id": "request_id",
  "transportation_requests.requested_category_id": "requested_category_id",
  "dispatchschedules.vehicle_id": "assigned",
  "dispatchschedules.driver_id": "assigned",
  "trips.dispatch_id": "executes",
  "driver_vehicle_assignments.driver_id": "pairing",
  "driver_vehicle_assignments.vehicle_id": "pairing",
  "driver_consents.driver_id": "consent",
};

const labelFor = (child, column) => LABELS[`${child}.${column}`] ?? column;

// Audit / review metadata columns. They are real FKs but add noise to the
// readable diagram: who created, updated or approved a row is not a business
// relationship. Kept only by --all, where the point is completeness.
const AUDIT_COLUMNS = new Set([
  "created_by",
  "updated_by",
  "approved_by",
  "reviewed_by",
  "actor_id",
]);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env.local or .env).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  // Foreign keys: referencing table/column -> referenced table/column.
  const { rows: fks } = await client.query(`
    SELECT tc.table_name        AS child,
           kcu.column_name      AS child_column,
           ccu.table_name       AS parent,
           ccu.column_name      AS parent_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY ccu.table_name, tc.table_name, kcu.column_name
  `);

  // Uniqueness of the referencing column(s), used to decide one-to-one vs
  // one-to-many: if the FK columns already form a primary/unique key in the
  // child table, each child row matches at most one... no — the reverse. A
  // unique FK column means at most one child row points at a given parent, so
  // the parent side is one-to-one (||--o|) rather than one-to-many (||--o{).
  const { rows: uniqueCols } = await client.query(`
    SELECT tc.table_name AS table_name, kcu.column_name AS column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    WHERE tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      AND tc.table_schema = 'public'
  `);
  const uniqueByTable = new Map();
  for (const u of uniqueCols) {
    if (!uniqueByTable.has(u.table_name)) uniqueByTable.set(u.table_name, new Set());
    uniqueByTable.get(u.table_name).add(u.column_name);
  }

  const visible = fks.filter(
    (f) =>
      ALL ||
      (FOCUS.has(f.child) && FOCUS.has(f.parent) && !AUDIT_COLUMNS.has(f.child_column))
  );

  const lines = ["erDiagram"];
  for (const f of visible) {
    const unique = uniqueByTable.get(f.child)?.has(f.child_column);
    // parent one | child: o{ many  |  o| zero-or-one
    const childMarker = unique ? "o|" : "o{";
    lines.push(
      `    ${f.parent} ||--${childMarker} ${f.child} : "${labelFor(f.child, f.child_column)}"`
    );
  }

  const out = lines.join("\n") + "\n";

  if (OUT) {
    writeFileSync(resolve(process.cwd(), OUT), out, "utf8");
    console.log(`Wrote ${OUT}`);
  } else {
    process.stdout.write(out);
  }
  console.log(`${visible.length}/${fks.length} relationships shown`);
}

main()
  .catch((e) => {
    console.error(`ERD generation failed: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => client.end());