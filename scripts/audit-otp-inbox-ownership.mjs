// Deployment readiness: which accounts can actually receive an email OTP, and
// which would silently mail a login code to somebody else.
//
// Mandatory email OTP makes `employees.email` a security-critical field. A
// placeholder domain fails CLOSED — no code is sent, the login is refused, and
// nothing leaks. A deliverable address the company does NOT own is worse: the
// code is delivered to a stranger, and the real user still cannot sign in.
//
// Addresses confirmed as ours live in .env.local (gitignored) under OTP_FIX_*,
// so ownership is recorded without committing personal addresses.
//
// Read-only. Writes nothing.
//
// Run: node --import ./scripts/alias-loader.mjs scripts/audit-otp-inbox-ownership.mjs

import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();
const { query } = await import("@/lib/db");

// Reserved / non-routable domains: mail to these cannot be delivered, so the
// failure is loud rather than silent.
const PLACEHOLDER = /(^|\.)(example\.com|example\.org|example\.net|invalid|test|localhost|local|fleetops\.com|harness)$/i;

// Every address the project has explicitly claimed as its own.
const OWNED = new Set(
  Object.entries(process.env)
    .filter(([k, v]) => k.startsWith("OTP_FIX_") && v)
    .map(([, v]) => v.trim().toLowerCase())
);

const { rows } = await query(
  `SELECT e.employee_id, e.email, e.status,
          coalesce(r.role_name, '(no role)') AS role_name,
          trim(concat_ws(' ', e.first_name, e.last_name)) AS name,
          (d.employee_id IS NOT NULL) AS is_driver
     FROM employees e
     LEFT JOIN roles r ON r.role_id = e.role_id
     LEFT JOIN drivers d ON d.employee_id = e.employee_id
    WHERE e.deleted_at IS NULL AND e.status = 'Active'
    ORDER BY (r.role_name IS NULL), r.role_name, e.employee_id`
);

const verdict = (email) => {
  if (!email || !String(email).trim()) return "NO EMAIL";
  const addr = String(email).trim().toLowerCase();
  if (OWNED.has(addr)) return "OWNED";
  const domain = addr.split("@")[1] || "";
  if (PLACEHOLDER.test(domain)) return "FAILS CLOSED";
  return "VERIFY OWNERSHIP";
};

const buckets = { OWNED: [], "VERIFY OWNERSHIP": [], "FAILS CLOSED": [], "NO EMAIL": [] };
for (const r of rows) buckets[verdict(r.email)].push(r);

const show = (label, list, note) => {
  console.log(`\n=== ${label} (${list.length}) — ${note} ===`);
  if (!list.length) return void console.log("  (none)");
  for (const r of list) {
    console.log(
      `  id=${String(r.employee_id).padStart(4)}  ${r.role_name.padEnd(12)}  ` +
        `${String(r.email ?? "(null)").padEnd(32)}  ${r.name}`
    );
  }
};

show("OWNED", buckets.OWNED, "confirmed as ours — codes reach the real user");
show(
  "VERIFY OWNERSHIP",
  buckets["VERIFY OWNERSHIP"],
  "deliverable, but unconfirmed: a code sent here may reach a stranger"
);
show(
  "FAILS CLOSED",
  buckets["FAILS CLOSED"],
  "undeliverable — login refused, nothing leaks; needs a real address"
);
show("NO EMAIL", buckets["NO EMAIL"], "cannot sign in at all");

const total = rows.length;
const blocked =
  buckets["FAILS CLOSED"].length + buckets["NO EMAIL"].length;
const risk = buckets["VERIFY OWNERSHIP"].length;

console.log(
  `\n${total} active accounts: ${buckets.OWNED.length} owned, ` +
    `${risk} unverified, ${blocked} unreachable.`
);
if (blocked || risk) {
  console.log(
    "Mandatory email OTP ships only when every account is OWNED — add confirmed\n" +
      "addresses as OTP_FIX_* keys in .env.local (see scripts/apply-otp-employee-emails.mjs)."
  );
}
