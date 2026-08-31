// Does START REVIEW touch the AI provider?
//
// Runs the REAL PUT /api/integration/transport-requests/:id/review handler
// in-process and watches the ailogs table, which is the definitive detector:
// executeLlmCompletion() ALWAYS writes a row there — on success, on error, and
// even when no key is configured ("Deterministic Fallback (No Key)"). The
// rule-based advisor never writes there at all.
//
//   ailogs row appears  -> an LLM/provider path ran
//   no ailogs row       -> no LLM/provider path ran
//
// A negative result only means something if the instrument works, so the test
// ends with a POSITIVE CONTROL: a route that genuinely calls the provider must
// produce a row. If the control fires and review does not, review is clean.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-start-review-ai.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const appModule = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);

const { query } = await appModule("lib/db.js");
const { RESERVATION_LIFECYCLE: L } = await appModule("lib/constants.js");
const ingestRoute = await appModule("app/api/integration/transport-requests/route.js");
const reviewRoute = await appModule("app/api/integration/transport-requests/[id]/review/route.js");
const recRoute = await appModule("app/api/integration/transport-requests/[id]/recommendation/route.js");
const insightsRoute = await appModule("app/api/ai/insights/route.js");

let pass = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) pass++;
  else failures.push(detail ? `${label} — ${detail}` : label);
  console.log(`  ${condition ? "✓" : "✗"} ${label}${condition ? "" : detail ? ` — ${detail}` : ""}`);
}

const makeRequest = (url, { method = "GET", body = null } = {}) =>
  new Request(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });

const ctx = (params) => ({ params: Promise.resolve(params) });

// Network tap. An ailogs row can be written by anyone; an actual HTTPS call to
// the provider cannot be faked. This is the ground truth for "connected".
const seenFetches = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  seenFetches.push(url);
  return realFetch(input, init);
};
const fetchesTo = (needle) => seenFetches.filter((u) => u.includes(needle));

async function callRoute(handler, request, params) {
  const res = await handler(request, params ? ctx(params) : undefined);
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

const aiLogCount = async () => {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM ailogs`);
  return rows[0].n;
};
const outboundCount = async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM integration_log WHERE direction = 'outbound'`
  );
  return rows[0].n;
};

globalThis.__HARNESS_SESSION__ = {
  user: { employeeId: null, role: "dispatcher", email: "harness@local" },
};
const { rows: dispatchers } = await query(
  `SELECT e.employee_id FROM employees e
     LEFT JOIN roles r ON r.role_id = e.role_id
    WHERE e.deleted_at IS NULL
      AND r.role_name IN ('dispatcher','fleet_manager','admin','system_admin')
    ORDER BY CASE r.role_name WHEN 'dispatcher' THEN 1 ELSE 2 END LIMIT 1`
);
if (dispatchers[0]) globalThis.__HARNESS_SESSION__.user.employeeId = dispatchers[0].employee_id;

const { rows: prov } = await query(
  `SELECT display_name, model_name, timeout_ms,
          (api_key IS NOT NULL AND length(api_key) > 0) AS has_key
     FROM aiproviders WHERE is_enabled AND is_default LIMIT 1`
);

console.log("\n=== Is START REVIEW wired to the AI provider? ===\n");
console.log(`actor:    employee ${globalThis.__HARNESS_SESSION__.user.employeeId ?? "(none)"} as dispatcher`);
console.log(
  prov[0]
    ? `provider: ${prov[0].display_name} / ${prov[0].model_name} (key=${prov[0].has_key}, timeout=${prov[0].timeout_ms}ms)`
    : "provider: (none configured)"
);

const EXT_ID = `TEST-REVIEW-AI-${Date.now()}`;
let requestId = null;

try {
  // ---------------------------------------------------------------- ingest --
  console.log("\n1. Ingest a fresh Pending request");
  const ingest = await callRoute(
    ingestRoute.POST,
    makeRequest("/api/integration/transport-requests", {
      method: "POST",
      body: {
        external_booking_id: EXT_ID,
        source_system: "PMS",
        booking_reference: "AI-PROBE-001",
        guest_name: "AI Probe",
        pickup_location: "Main Lobby",
        dropoff_location: "NAIA Terminal 3 - Arrivals (Bay 9)",
        pickup_datetime: "2026-09-01T10:00:00+08:00",
        passenger_count: 2,
        special_requests: null,
        requested_vehicle_type: "Airport Transfer Van",
        service_type_id: null,
        priority: "Normal",
        booking_status: "Approved",
      },
    })
  );
  requestId = ingest.data?.request_id ?? ingest.data?.request?.request_id ?? null;
  check("ingest returned 2xx", ingest.ok, `status ${ingest.status}`);
  check("got a request_id", requestId != null, JSON.stringify(ingest.data)?.slice(0, 160));
  if (requestId == null) throw new Error("cannot continue without a request_id");
  check(`landed in ${L.PENDING}`, ingest.data?.fleet_status === L.PENDING, `got ${ingest.data?.fleet_status}`);

  // ------------------------------------------------- THE TEST: start review --
  console.log("\n2. START REVIEW — watching ailogs for any provider call");
  const aiBefore = await aiLogCount();
  const outBefore = await outboundCount();
  const netBefore = seenFetches.length;
  console.log(`   ailogs before: ${aiBefore}`);

  const t0 = Date.now();
  const review = await callRoute(
    reviewRoute.PUT,
    makeRequest(`/api/integration/transport-requests/${requestId}/review`, { method: "PUT" }),
    { id: String(requestId) }
  );
  const reviewMs = Date.now() - t0;

  const aiAfterReview = await aiLogCount();
  const outAfterReview = await outboundCount();
  const netDuringReview = seenFetches.slice(netBefore).filter((u) => !u.includes("/api/"));
  console.log(`   external network calls during review: ${netDuringReview.length}`);
  for (const u of netDuringReview) console.log(`     -> ${u}`);

  check("review returned 2xx", review.ok, `status ${review.status}`);
  check(`moved to ${L.UNDER_REVIEW}`, review.data?.fleet_status === L.UNDER_REVIEW, `got ${review.data?.fleet_status}`);
  check("reviewed_by was stamped", review.data?.reviewed_by != null);
  console.log(`   ailogs after:  ${aiAfterReview}   (delta ${aiAfterReview - aiBefore})`);
  console.log(`   review took:   ${reviewMs}ms`);

  check(
    "START REVIEW made ZERO external network calls — no provider round-trip",
    netDuringReview.length === 0,
    `${netDuringReview.length} call(s): ${netDuringReview.join(", ")}`
  );
  check(
    "review is far too fast to have made a network AI call",
    reviewMs < 2000,
    `${reviewMs}ms`
  );
  check(
    "it DID notify Booking (outbound integration_log +1)",
    outAfterReview === outBefore + 1,
    `delta ${outAfterReview - outBefore}`
  );

  check(
    "START REVIEW wrote NO ailogs row — it never claims an LLM call it didn't make",
    aiAfterReview === aiBefore,
    `delta ${aiAfterReview - aiBefore}`
  );

  // If review DID write an ailogs row, show what it claims so the mismatch
  // between the claim and what the tap observed is visible, not just a number.
  if (aiAfterReview > aiBefore) {
    const { rows: claim } = await query(
      `SELECT feature_used, provider_name, model_name, total_tokens, duration_ms, status
         FROM ailogs ORDER BY log_id DESC LIMIT 1`
    );
    const c = claim[0];
    console.log(`\n   !! review wrote an ailogs row claiming:`);
    console.log(`      feature=${c.feature_used} provider=${c.provider_name} model=${c.model_name}`);
    console.log(`      tokens=${c.total_tokens} duration=${c.duration_ms}ms status=${c.status}`);
    console.log(`      ...while the network tap saw ${netDuringReview.length} outbound call(s).`);
  }

  const { rows: ev } = await query(
    `SELECT event_type, from_status, to_status FROM reservation_events
      WHERE request_id = $1 ORDER BY event_id`,
    [requestId]
  );
  check(
    "timeline recorded a plain status change",
    ev.some((e) => e.event_type === "reviewed" && e.to_status === L.UNDER_REVIEW),
    ev.map((e) => e.event_type).join(", ")
  );

  // ------------------------------------- control: the "AI" advisor endpoint --
  // The instant GET: rule-based pick, no provider call, narration null.
  console.log("\n3. Control — the AI recommendation panel (the real 'AI' feature)");
  const netBeforeRec = seenFetches.length;
  const rec = await callRoute(
    recRoute.GET,
    makeRequest(`/api/integration/transport-requests/${requestId}/recommendation`),
    { id: String(requestId) }
  );
  const netDuringRec = seenFetches.slice(netBeforeRec).filter((u) => !u.includes("/api/"));
  check("recommendation returned 2xx", rec.ok, `status ${rec.status}`);
  check(
    "it produced a scored recommendation",
    rec.data?.vehicle !== undefined || rec.data?.driver !== undefined,
    JSON.stringify(rec.data)?.slice(0, 120)
  );
  check(
    "the instant GET made no provider call — the pick never waits on prose",
    netDuringRec.length === 0,
    `${netDuringRec.length} external call(s)`
  );
  check(
    "its narration is null until asked for — that is the seam, not an error",
    rec.data?.narration == null,
    JSON.stringify(rec.data?.narration)?.slice(0, 120)
  );

  // --------------------------------------------- the LLM narration control --
  // ?narrate=1 is the only path that pays for the provider round-trip. Whether
  // the provider answers is NOT the assertion — that the call is real, and the
  // log row is backed by it, is.
  console.log("\n4. LLM narration — advisory rationale over that same pick");
  const aiBeforeNar = await aiLogCount();
  const netBeforeNar = seenFetches.length;
  const t2 = Date.now();
  const nar = await callRoute(
    recRoute.GET,
    makeRequest(`/api/integration/transport-requests/${requestId}/recommendation?narrate=1`),
    { id: String(requestId) }
  );
  const narMs = Date.now() - t2;
  const netDuringNar = seenFetches.slice(netBeforeNar).filter((u) => !u.includes("/api/"));
  const aiAfterNar = await aiLogCount();
  check("narrate=1 returned 2xx", nar.ok, `status ${nar.status}`);
  check(
    "it DID reach the provider — a real outbound call, not a fake log",
    netDuringNar.length > 0,
    `${netDuringNar.length} external call(s)`
  );
  for (const u of netDuringNar) console.log(`     -> ${u}`);
  console.log(`   ailogs delta: ${aiAfterNar - aiBeforeNar}   (took ${narMs}ms)`);
  check(
    "the narration's ailogs row is backed by the call that just happened",
    aiAfterNar > aiBeforeNar && netDuringNar.length > 0,
    `ailogs +${aiAfterNar - aiBeforeNar}, network ${netDuringNar.length}`
  );
  console.log(
    nar.data?.narration
      ? `   narration: "${String(nar.data.narration.text).slice(0, 140)}..."`
      : "   narration: null — provider down/slow/overloaded; rule-based payload still returned"
  );
  check(
    "the rule-based recommendation survives regardless of what the LLM did",
    nar.data?.vehicle !== undefined && nar.data?.trip !== undefined,
    "payload lost its deterministic core"
  );

  // --------------------------------------------------- POSITIVE CONTROL -----
  // Prove the detector actually fires: a route that really calls the provider.
  console.log("\n5. Positive control — /api/ai/insights, which DOES call the provider");
  const aiBeforeIns = await aiLogCount();
  const t1 = Date.now();
  const ins = await callRoute(insightsRoute.GET, makeRequest("/api/ai/insights"));
  const insMs = Date.now() - t1;
  const aiAfterIns = await aiLogCount();
  console.log(`   status ${ins.status} in ${insMs}ms; ailogs delta ${aiAfterIns - aiBeforeIns}`);
  check(
    "the LLM route DID write an ailogs row — the detector works",
    aiAfterIns > aiBeforeIns,
    `delta ${aiAfterIns - aiBeforeIns}`
  );

  const { rows: last } = await query(
    `SELECT provider_name, model_name, status, duration_ms, error_message
       FROM ailogs ORDER BY log_id DESC LIMIT 1`
  );
  if (last[0]) {
    const r = last[0];
    console.log(`   newest ailogs row: ${r.provider_name} / ${r.model_name} -> ${r.status} (${r.duration_ms}ms)`);
    if (r.error_message) console.log(`   error: ${String(r.error_message).slice(0, 200)}`);
    console.log(
      r.status === "Success" && r.provider_name !== "Rule-Based"
        ? "   => provider is LIVE and answering"
        : "   => provider did NOT answer; app fell back to rule-based output"
    );
  }
} finally {
  // ------------------------------------------------------------- cleanup ----
  if (requestId != null) {
    await query(`DELETE FROM reservation_events WHERE request_id = $1`, [requestId]).catch(() => {});
    await query(`DELETE FROM integration_log WHERE external_booking_id = $1`, [EXT_ID]).catch(() => {});
    await query(`DELETE FROM transportation_requests WHERE request_id = $1`, [requestId]).catch(() => {});
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM transportation_requests WHERE external_booking_id = $1`,
      [EXT_ID]
    );
    console.log(`\ncleanup: ${rows[0].n} probe row(s) remain (expect 0)`);
  }
}

console.log(`\nstart-review AI probe: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nfailures:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
