// Which of the address states the runbook's section D describes are actually reachable.
//
// WHY THIS EXISTS. `Capstone/07 - Development/Driver Address Verification Runbook.md` names
// five screens for a legacy address and tells the reader what to expect on each. Three of them
// turned out to be unreachable — they need rows no operator can produce — leaving the step
// asserting the opposite of the one behaviour anyone can actually see. That was settled by
// counting, not by reading, and the counts move every time the browser pass writes an address:
// creating one driver in step 1 takes `addr_total` from 4 to 6 and `drv_linked` from 1 to 2.
//
// So the runbook owns the command rather than a paragraph of remembered numbers. It is
// tracked here rather than kept in `scratch/` for the obvious reason: a gitignored file cannot
// be referenced by a committed document.
//
// COUNTS ONLY. It selects no row contents, no names and no addresses, so unlike
// `verify-driver-addresses.mjs` its output is safe to paste into the Capstone notes. That is
// the point — the runbook quotes these numbers, and evidence that cannot be recorded is
// evidence nobody can check.
//
// NOT A GATE. It reports; it does not judge. "No `no-psgc-code` row exists" is a fact about
// the data, not a defect, so there is no pass or fail here and no exit code but 0 — or 3 if
// the read could not happen at all.
//
// Run: npm run probe:addresses

import { loadEnvLocal } from "./load-env.mjs";
import pg from "pg";

loadEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env.local or .env). Nothing to read.");
  process.exit(3);
}

// One statement, not two round trips: an ECONNRESET between two queries loses the first
// result as well as the second, and there is nothing here that needs a second connection.
const Q = `
  SELECT
    (SELECT count(*) FROM addresses WHERE psgc_barangay_code IS NULL) AS addr_no_psgc,
    (SELECT count(*) FROM addresses)                                  AS addr_total,
    (SELECT count(*) FROM addresses WHERE latitude IS NOT NULL)       AS addr_with_pin,
    (SELECT count(*) FROM drivers   WHERE address_id IS NULL)         AS drv_legacy,
    (SELECT count(*) FROM drivers   WHERE address_id IS NOT NULL)     AS drv_linked,
    (SELECT count(*) FROM locations WHERE address_id IS NULL)         AS loc_legacy,
    (SELECT count(*) FROM locations
      WHERE address_id IS NULL AND address IS NOT NULL)               AS loc_legacy_with_text,
    (SELECT count(*) FROM locations WHERE address_id IS NOT NULL)     AS loc_linked,
    (SELECT count(*) FROM locations)                                  AS loc_total
`;

// A fresh client per attempt: an ECONNRESET leaves the previous one unusable, so reusing it
// would turn a transient drop into a permanent failure. Measured 2026-09-25 — the first run
// of this query against live died mid-TLS and succeeded on the retry.
let lastError = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const { rows } = await client.query(Q);
    console.log(JSON.stringify(rows[0], null, 2));
    await client.end();
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log(`attempt ${attempt} failed: ${error.code ?? error.message}`);
    try {
      await client.end();
    } catch {
      // The socket is already gone; nothing to close.
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
  }
}

console.error(`\nCould not run after 3 attempts: ${lastError?.message}`);
process.exit(3);
