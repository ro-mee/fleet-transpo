// Read-only incident queue verification.
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-incident-summary.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();
const app = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);
const { query, getPool } = await app("lib/db.js");
const incidents = await app("app/api/incidents/route.js");
const acknowledge = await app("app/api/incidents/[id]/acknowledge/route.js");

const call = async (handler, role, url, method = "GET") => {
  globalThis.__HARNESS_SESSION__ = role ? { user: { employeeId: 8, role } } : null;
  const req = new Request(url, { method });
  const restore = console.error;
  console.error = () => {};
  try {
    return await handler(req, { params: Promise.resolve({ id: "99999999" }) });
  } finally {
    console.error = restore;
  }
};

const summary = await call(incidents.GET, "system_admin", "http://localhost/api/incidents?summary=true");
if (summary.status !== 200) throw new Error(`summary returned ${summary.status}`);
const body = await summary.json();
for (const key of ["total", "open", "unacknowledged", "critical_major_open", "assistance_open", "grounding_failed", "maintenance_pending", "attention"]) {
  if (!Number.isInteger(Number(body[key]))) throw new Error(`summary.${key} is not an integer`);
}

const independent = (await query(
  `SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'Open')::int AS open,
          COUNT(*) FILTER (WHERE status = 'Open' AND acknowledged_at IS NULL)::int AS unacknowledged
     FROM driverincidents WHERE deleted_at IS NULL`
)).rows[0];
for (const key of ["total", "open", "unacknowledged"]) {
  if (Number(body[key]) !== Number(independent[key])) throw new Error(`${key}: route ${body[key]} vs SQL ${independent[key]}`);
}

const maintenanceIntegrity = (await query(
  `SELECT COUNT(*) FILTER (WHERE status = 'Open' AND requires_vehicle_maintenance AND maintenance_id IS NULL)::int AS missing,
          COUNT(*) FILTER (WHERE status = 'Open' AND requires_vehicle_maintenance AND grounding_status IN ('Pending', 'Failed'))::int AS unsafe
     FROM driverincidents WHERE deleted_at IS NULL`
)).rows[0];
if (Number(maintenanceIntegrity.missing) > 0) throw new Error("open vehicle incidents are missing maintenance work orders");
if (Number(maintenanceIntegrity.unsafe) > 0) throw new Error("open vehicle incidents still have incomplete grounding actions");

for (const params of ["summary=true&status=Open", "summary=true&from=2026-01-01&to=2100-01-01", "limit=1"]) {
  const response = await call(incidents.GET, "management", `http://localhost/api/incidents?${params}`);
  if (response.status !== 200) throw new Error(`${params} returned ${response.status}`);
}

const denied = await call(acknowledge.POST, "management", "http://localhost/api/incidents/99999999/acknowledge", "POST");
if (denied.status !== 403) throw new Error(`management acknowledgement returned ${denied.status}`);
const unauthenticated = await call(incidents.GET, null, "http://localhost/api/incidents");
if (unauthenticated.status !== 401) throw new Error(`unauthenticated incident read returned ${unauthenticated.status}`);

console.log(`incident summary verified: total=${body.total}, open=${body.open}, attention=${body.attention}`);
await getPool().end();
