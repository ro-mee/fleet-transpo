// AI report-narrative engine (pure, no I/O).
//
// Turns a computed report snapshot into a short executive analysis: a narrative
// paragraph, 1-3 recommended actions, and a flag. Two paths:
//   - LLM ("generative", via /api/ai/report-narrative) when a provider is set.
//   - Deterministic ("rules") here, so the feature degrades cleanly and is
//     unit-testable without a network or DB.
//
// Both read from the same snapshot builder so the UI, the prompt, and the
// fallback all agree on what the numbers are.

export const REPORT_TYPES = ["fleet", "fuel", "maintenance", "drivers", "financial", "analytics"];

/** Flag labels so consumers and the LLM share one vocabulary. */
export const FLAG = {
  SUCCESS: "success",
  WATCH: "watch",
  RISK: "risk",
};

/**
 * Detect a demo/empty payload so the analyst never synthesizes a story from
 * missing or explicitly marked non-production data.
 */
export function isDemoPayload(data) {
  if (!data) return true;
  if (data.demo === true) return true;
  if (typeof data !== "object") return true;
  return Object.keys(data).length === 0;
}

/** Normalize to a number, defaulting to 0 for missing/NaN values. */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pct = (v) => Math.max(0, Math.min(100, num(v)));
const round1 = (v) => Math.round(num(v) * 10) / 10;

export const REPORT_SCHEMAS = {
  fleet: ["utilization", "totalTrips", "totalDistance"],
  fuel: ["totalLiters", "totalCost", "avgCost"],
  maintenance: ["totalCost", "totalRecords"],
  drivers: ["totalDrivers", "avgScore"],
  financial: ["totalCost", "tripCost", "fuelCost", "maintCost", "costPerKm"],
  analytics: ["utilization", "totalTrips", "totalDistance", "totalCost", "costPerKm", "maintDue"],
};

/**
 * Whether a client-side report payload is real enough to justify an AI
 * narrative request. `{}` is truthy in JS, so a bare `Boolean(data)` gate
 * fires the narrative query before the active report tab has loaded and the
 * server answers `mode: "no-data"` (narrative: null) — which the UI then
 * backfills with copy from the wrong report. Gate on this instead: the
 * payload must be a non-empty object carrying at least one field the active
 * report type actually reasons over.
 */
export function isValidReportPayload(report, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (data.demo === true) return false;
  if (Object.keys(data).length === 0) return false;
  const schema = REPORT_SCHEMAS[report];
  if (!schema) return true;
  const carriers = new Set([...schema, "byVehicle", "byCategory", "byType", "topDrivers", "vehicleRoster", "monthlyData", "fuelRecords"]);
  return Object.keys(data).some((key) => carriers.has(key) && data[key] !== undefined && data[key] !== null);
}

/**
 * Strict render guard: an AI card for `report` may only render a narrative
 * whose server-echoed `report` identity matches. While switching tabs the
 * previous tab's cached narrative must never render under the new title —
 * the caller shows a loading skeleton instead.
 */
export function isNarrativeForReport(narrative, report) {
  return Boolean(narrative) && narrative.report === report && typeof narrative.narrative === "string" && narrative.narrative.length > 0;
}

/**
 * Build a compact text snapshot of a report's headline numbers. This is what we
 * hand the LLM (kept small to avoid blowing the context window) AND roughly what
 * the deterministic fallback reasons over.
 */
export function buildReportSnapshot(report, data) {
  const base = { report, range: data?.range || null };
  switch (report) {
    case "fleet":
      return {
        ...base,
        utilization_pct: round1(data?.utilization),
        total_trips: Math.round(num(data?.totalTrips)),
        total_distance_km: Math.round(num(data?.totalDistance)),
        top_vehicles: (data?.byVehicle || []).slice(0, 4).map((v) => ({
          plate: v?.plate,
          trips: num(v?.trips),
          distance_km: Math.round(num(v?.distance)),
        })),
      };
    case "fuel":
      return {
        ...base,
        total_liters: round1(data?.totalLiters),
        total_cost: Math.round(num(data?.totalCost)),
        avg_cost_per_liter: round1(data?.avgCost),
        by_category: (data?.byCategory || []).slice(0, 4).map((c) => ({
          category: c?.category,
          liters: Math.round(num(c?.liters)),
          cost: Math.round(num(c?.cost)),
        })),
      };
    case "maintenance":
      return {
        ...base,
        total_cost: Math.round(num(data?.totalCost)),
        total_records: Math.round(num(data?.totalRecords)),
        vehicles_due: Math.round(num(data?.vehiclesDue)),
        by_type: (data?.byType || []).slice(0, 4).map((t) => ({
          type: t?.type,
          count: num(t?.count),
          cost: Math.round(num(t?.cost)),
        })),
      };
    case "drivers":
      return {
        ...base,
        total_drivers: Math.round(num(data?.totalDrivers)),
        avg_score: round1(data?.avgScore),
        top_drivers: (data?.topDrivers || []).slice(0, 4).map((d) => ({
          name: d?.name,
          score: num(d?.score),
          trips: num(d?.trips),
        })),
      };
    case "financial":
      return {
        ...base,
        total_cost: Math.round(num(data?.totalCost)),
        trip_cost: Math.round(num(data?.tripCost)),
        fuel_cost: Math.round(num(data?.fuelCost)),
        maint_cost: Math.round(num(data?.maintCost)),
        cost_per_km: round1(data?.costPerKm),
        total_distance_km: Math.round(num(data?.totalDistance)),
      };
    case "analytics":
      return {
        ...base,
        utilization_pct: round1(data?.utilization),
        total_trips: Math.round(num(data?.totalTrips)),
        total_distance_km: Math.round(num(data?.totalDistance)),
        total_cost: Math.round(num(data?.totalCost)),
        cost_per_km: round1(data?.costPerKm),
        maint_due: Math.round(num(data?.maintDue)),
        fuel_cost: Math.round(num(data?.fuelCost) ?? num(data?.totalCost)),
      };
    default:
      return { report, data };
  }
}

/**
 * Deterministic narration. Reasons directly over the report payload so it can
 * run without an LLM and produces actionable, number-grounded copy.
 */
export function deterministicNarrative(report, data) {
  const flagFor = (hit) => (hit ? FLAG.WATCH : FLAG.SUCCESS);

  switch (report) {
    case "fleet": {
      const utilization = pct(data?.utilization);
      const trips = Math.round(num(data?.totalTrips));
      const km = Math.round(num(data?.totalDistance));
      const busy = Math.max(...(data?.byVehicle || []).map((v) => num(v?.trips)), 0);
      const idle = (data?.byVehicle || []).filter((v) => num(v?.trips) === 0).length;
      const risk = utilization < 60 || idle > 0;
      return {
        narrative:
          `Fleet utilization is at ${utilization}% across the period, with ${trips} trips ` +
          `covering ${km.toLocaleString()} km. The busiest unit logged ${busy} trips` +
          (idle > 0 ? `, while ${idle} vehicle${idle === 1 ? " is" : "s are"} idle with no dispatches.` : "."),
        actions: [
          utilization < 60
            ? "Raise utilization by redistributing workload toward the idle units."
            : "Maintain the current dispatch-to-capacity ratio to sustain utilization.",
          idle > 0 ? "Review standby assets for reassignment or short-term redeployment." : "No idle assets detected; continue monitoring low-utilization vehicles.",
        ].filter(Boolean),
        flag: risk ? FLAG.WATCH : FLAG.SUCCESS,
      };
    }
    case "fuel": {
      const liters = round1(data?.totalLiters);
      const cost = Math.round(num(data?.totalCost));
      const avg = round1(data?.avgCost);
      const cats = (data?.byCategory || []).map((c) => ({ ...c, liters: num(c?.liters), cost: num(c?.cost) }));
      const top = cats.sort((a, b) => b.cost - a.cost)[0];
      const risk = avg > 60;
      return {
        narrative:
          `${liters.toFixed(1)} L of fuel were consumed for a total of PHP ${cost.toLocaleString()} ` +
          `at an average of PHP ${avg}/L.` +
          (top ? ` ${top.category} is the largest fuel draw at ${Math.round(top.cost).toLocaleString()}.` : ""),
        actions: [
          risk ? "Investigate below-target fuel price variance across suppliers and odometer catches." : "Fuel pricing is within expected band; keep current sourcing.",
          top ? `Audit fuel log accuracy for the ${top.category} segment, the largest cost center.` : null,
        ].filter(Boolean),
        flag: risk ? FLAG.WATCH : FLAG.SUCCESS,
      };
    }
    case "maintenance": {
      const cost = Math.round(num(data?.totalCost));
      const records = Math.round(num(data?.totalRecords));
      const due = Math.round(num(data?.vehiclesDue));
      const byType = (data?.byType || []).map((t) => ({ ...t, cost: num(t?.cost) }));
      const top = byType.sort((a, b) => b.cost - a.cost)[0];
      const risk = due > 0;
      return {
        narrative:
          `Maintenance totaled PHP ${cost.toLocaleString()} across ${records} work orders` +
          (due > 0 ? `, and ${due} vehicle${due === 1 ? " is" : "s are"} currently due for service.` : ".") +
          (top ? ` ${top.type} accounts for the largest share of spend.` : ""),
        actions: [
          due > 0 ? `Schedule the ${due} vehicle${due === 1 ? "" : "s"} due for service before next dispatch.` : "No vehicles are overdue — retain the planned service cadence.",
          top ? `Review ${top.type} frequency for a possible root-cause or parts-quality issue.` : null,
        ].filter(Boolean),
        flag: risk ? FLAG.RISK : FLAG.SUCCESS,
      };
    }
    case "drivers": {
      const total = Math.round(num(data?.totalDrivers));
      const avg = round1(data?.avgScore);
      const top = (data?.topDrivers || [])[0];
      const low = (data?.topDrivers || []).filter((d) => num(d?.score) < 80).length;
      const risk = avg < 85 || low > 0;
      return {
        narrative:
          `${total} driver${total === 1 ? "" : "s"} are on the roster with an average safety performance score of ${avg}/100` +
          (top ? `; the top performer is ${top.name} (${num(top?.score)}/100).` : "."),
        actions: [
          avg < 90 ? "Reinforce defensive-driving training to lift the fleet average score." : "Fleet-wide performance is strong — preserve current coaching cadence.",
          low > 0 ? `Flag ${low} driver${low === 1 ? "" : "s"} scoring below 80 for a performance review.` : null,
        ].filter(Boolean),
        flag: risk ? FLAG.WATCH : FLAG.SUCCESS,
      };
    }
    case "financial": {
      const total = Math.round(num(data?.totalCost));
      const trip = Math.round(num(data?.tripCost));
      const fuel = Math.round(num(data?.fuelCost));
      const maint = Math.round(num(data?.maintCost));
      const ck = round1(data?.costPerKm);
      const share = total > 0 ? Math.round((fuel / total) * 100) : 0;
      const risk = ck > 15 || share > 50;
      return {
        narrative:
          `Total operational cost was PHP ${total.toLocaleString()} — fuel PHP ${fuel.toLocaleString()} (${share}%), ` +
          `maintenance PHP ${maint.toLocaleString()}, trip costs PHP ${trip.toLocaleString()} — at PHP ${ck}/km run.`,
        actions: [
          share > 50 ? `Fuel is ${share}% of cost; target sourcing and route economy to rebalance spend.` : "Cost allocation is balanced across fuel, maintenance, and trips.",
          ck > 15 ? "Drive cost-per-km below the PHP 15 threshold by trimming fuel and maintenance waste." : null,
        ].filter(Boolean),
        flag: risk ? FLAG.WATCH : FLAG.SUCCESS,
      };
    }
    case "analytics": {
      const utilization = pct(data?.utilization);
      const total = Math.round(num(data?.totalCost) ?? num(data?.fuelCost));
      const ck = round1(data?.costPerKm);
      const due = Math.round(num(data?.maintDue));
      const trips = Math.round(num(data?.totalTrips));
      const risk = due > 0 || ck > 15;
      return {
        narrative:
          `Executive snapshot shows ${trips} trips at ${utilization}% utilization and PHP ${total.toLocaleString()} ` +
          `total cost (PHP ${ck}/km).` +
          (due > 0 ? ` ${due} vehicle${due === 1 ? " is" : "s are"} due for maintenance and need attention.` : ""),
        actions: [
          due > 0 ? `Dispatch the ${due} overdue unit${due === 1 ? "" : "s"} to service immediately.` : "No maintenance units are currently due.",
          ck > 15 ? "Focus on lowering cost-per-km through fuel economy and preventive maintenance." : "Cost-per-km is within a healthy band.",
        ].filter(Boolean),
        flag: risk ? FLAG.RISK : FLAG.SUCCESS,
      };
    }
    default:
      return { narrative: "Report data is not available for analysis.", actions: [], flag: FLAG.SUCCESS };
  }
}

/**
 * Build the strict-JSON user prompt for an LLM completion. The schema is shared
 * with the parser (parseNarrativeJson) so both paths produce the same shape.
 */
export function buildNarrativePrompt(report, snapshot) {
  const rangeLine = snapshot.range ? `Period: ${snapshot.range}\n` : "";
  return `You are a Fleet Operations analyst. Based ONLY on the report numbers below, write a short executive analysis.

CRITICAL RULE: Output ONLY valid JSON — no markdown, no prose outside the object. Match this exact schema:
{
  "narrative": "2-4 sentences analyzing the numbers, name concrete figures.",
  "actions": ["One actionable recommendation", "One more recommendation"],
  "flag": "success" | "watch" | "risk"
}
flag meanings: success = healthy, watch = needs monitoring, risk = immediate attention.
Base every claim strictly on the numbers. Do NOT invent figures.

Report type: ${report}
${rangeLine}
Data:
${JSON.stringify(snapshot)}`;
}

/** Extract and validate the LLM's JSON into { narrative, actions, flag }. */
export function parseNarrativeJson(raw) {
  if (!raw) return null;
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const narrative = typeof parsed?.narrative === "string" ? parsed.narrative.trim() : null;
    if (!narrative) return null;
    const actions = Array.isArray(parsed?.actions)
      ? parsed.actions.map((a) => String(a).trim()).filter(Boolean).slice(0, 3)
      : [];
    const flag = [FLAG.SUCCESS, FLAG.WATCH, FLAG.RISK].includes(parsed?.flag) ? parsed.flag : FLAG.SUCCESS;
    if (!narrative) return null;
    return { narrative, actions, flag };
  } catch {
    return null;
  }
}
