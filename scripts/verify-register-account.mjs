// Does the admin Add User screen's endpoint behave the way the UI assumes?
//
// The screen at /settings/users/new posts to POST /api/auth/register and
// branches on the status code: 409 means "email taken", 400 means "invalid
// role", 403 means "not an admin". If any of those drift, the form shows the
// wrong message. This runs the REAL handler in-process against the live DB.
//
// Creates one throwaway employee row and hard-deletes it at the end, including
// on failure, so the table is left exactly as it was found.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-register-account.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const appModule = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);

const { query } = await appModule("lib/db.js");
const { ROLE_IDS } = await appModule("lib/constants.js");
const registerRoute = await appModule("app/api/auth/register/route.js");

let pass = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) pass++;
  else failures.push(detail ? `${label} — ${detail}` : label);
  console.log(`  ${condition ? "✓" : "✗"} ${label}${condition ? "" : detail ? ` — ${detail}` : ""}`);
}

const post = async (body) => {
  const req = new Request("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await registerRoute.POST(req);
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
};

// A fixed local-part keeps the cleanup query exact; the row is removed below.
const TEST_EMAIL = "harness-adduser-probe@local.invalid";
const VALID = {
  email: TEST_EMAIL,
  password: "Str0ng!Passw0rd",
  first_name: "Probe",
  last_name: "Account",
  role_id: ROLE_IDS.dispatcher,
};

const cleanup = async () => {
  await query(`DELETE FROM employees WHERE lower(email) = lower($1)`, [TEST_EMAIL]);
};

async function findAdmin() {
  const { rows } = await query(
    `SELECT e.employee_id FROM employees e
       LEFT JOIN roles r ON r.role_id = e.role_id
      WHERE e.deleted_at IS NULL AND r.role_name IN ('system_admin','admin')
      LIMIT 1`
  );
  return rows[0]?.employee_id ?? null;
}

const asAdmin = (employeeId) => {
  globalThis.__HARNESS_SESSION__ = {
    user: { employeeId, role: "system_admin", email: "harness-admin@local" },
  };
};

try {
  await cleanup(); // in case a previous aborted run left the row behind

  const adminId = await findAdmin();
  console.log(`\nAdmin employee_id for session: ${adminId ?? "(none found)"}\n`);

  // ── 1. Authorization boundary ──────────────────────────────────────────────
  console.log("1. Only an admin may create accounts");
  globalThis.__HARNESS_SESSION__ = null;
  const anon = await post(VALID);
  check("unauthenticated caller is rejected", anon.status === 401 || anon.status === 403,
    `got ${anon.status}`);

  globalThis.__HARNESS_SESSION__ = {
    user: { employeeId: adminId, role: "dispatcher", email: "harness-dispatcher@local" },
  };
  const asDispatcher = await post(VALID);
  check("dispatcher is refused with 403", asDispatcher.status === 403, `got ${asDispatcher.status}`);

  const { rows: leaked } = await query(
    `SELECT employee_id FROM employees WHERE lower(email) = lower($1)`, [TEST_EMAIL]
  );
  check("no account was created by the refused calls", leaked.length === 0,
    `found ${leaked.length} row(s)`);

  // ── 2. Validation mirrors the client schema ────────────────────────────────
  console.log("\n2. Server rejects what the form's schema rejects");
  asAdmin(adminId);

  const weak = await post({ ...VALID, password: "short" });
  check("weak password is rejected (400)", weak.status === 400, `got ${weak.status}`);

  const badEmail = await post({ ...VALID, email: "not-an-email" });
  check("malformed email is rejected (400)", badEmail.status === 400, `got ${badEmail.status}`);

  const badRole = await post({ ...VALID, role_id: 9999 });
  check("out-of-range role_id is rejected (400)", badRole.status === 400, `got ${badRole.status}`);
  check("invalid-role message is the one the form shows",
    badRole.status === 400 && typeof badRole.data?.error === "string",
    `error field was ${JSON.stringify(badRole.data)}`);

  // The client schema applies PATTERNS.NAME to both name fields because the
  // server's type:"name" rule does. If the server ever stopped enforcing it the
  // form would be stricter than the API for no reason.
  const digitName = await post({ ...VALID, first_name: "Probe2" });
  check("name containing a digit is rejected (400)", digitName.status === 400,
    `got ${digitName.status} — client schema enforces PATTERNS.NAME, server should too`);

  const shortName = await post({ ...VALID, first_name: "P" });
  check("single-character name is rejected (400)", shortName.status === 400,
    `got ${shortName.status} — NAME_MIN is ${2}`);

  const { rows: stillNone } = await query(
    `SELECT employee_id FROM employees WHERE lower(email) = lower($1)`, [TEST_EMAIL]
  );
  check("no account created by invalid payloads", stillNone.length === 0,
    `found ${stillNone.length} row(s)`);

  // ── 3. Happy path ──────────────────────────────────────────────────────────
  console.log("\n3. Valid payload creates the account");
  const created = await post(VALID);
  check("returns 201", created.status === 201, `got ${created.status} ${JSON.stringify(created.data)}`);
  check("returns an employee_id", Number.isInteger(created.data?.employee_id),
    JSON.stringify(created.data));

  const { rows: row } = await query(
    `SELECT employee_id, email, first_name, last_name, role_id, password_hash
       FROM employees WHERE lower(email) = lower($1)`, [TEST_EMAIL]
  );
  check("exactly one row exists", row.length === 1, `found ${row.length}`);
  check("email stored lowercased", row[0]?.email === TEST_EMAIL.toLowerCase(), row[0]?.email);
  check("role_id is the one submitted", row[0]?.role_id === ROLE_IDS.dispatcher,
    String(row[0]?.role_id));
  check("password is hashed, not stored in plaintext",
    typeof row[0]?.password_hash === "string" &&
      row[0].password_hash !== VALID.password &&
      row[0].password_hash.startsWith("$2"),
    "password_hash did not look like a bcrypt digest");

  // ── 4. The 409 path the form specifically handles ──────────────────────────
  console.log("\n4. Duplicate email answers 409 without touching the existing account");
  const originalHash = row[0]?.password_hash;
  const dupe = await post({ ...VALID, password: "An0ther!Password", first_name: "Attacker" });
  check("returns 409", dupe.status === 409, `got ${dupe.status}`);
  check("message matches what the form surfaces",
    dupe.data?.error === "An account with this email already exists.",
    JSON.stringify(dupe.data));

  const { rows: after } = await query(
    `SELECT first_name, password_hash FROM employees WHERE lower(email) = lower($1)`, [TEST_EMAIL]
  );
  check("still exactly one row (no duplicate inserted)", after.length === 1, `found ${after.length}`);
  check("existing password was NOT overwritten", after[0]?.password_hash === originalHash,
    "the duplicate request changed the stored credential — account-takeover path");
  check("existing name was NOT overwritten", after[0]?.first_name === "Probe",
    `first_name is now ${after[0]?.first_name}`);
} finally {
  await cleanup();
  const { rows: leftover } = await query(
    `SELECT employee_id FROM employees WHERE lower(email) = lower($1)`, [TEST_EMAIL]
  );
  console.log(`\nCleanup: ${leftover.length === 0 ? "test row removed" : "WARNING leftover row!"}`);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
