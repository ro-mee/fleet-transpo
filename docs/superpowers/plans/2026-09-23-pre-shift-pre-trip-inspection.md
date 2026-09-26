# FleetOps Pre-Shift + Quick Pre-Trip Inspection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single 7-point per-trip inspection into a full Pre-Shift baseline (once per day, no trip) and a 4-item Quick Pre-Trip safety re-check per trip, with the backend remaining the final trip-start authority.

**Architecture:** Reuse `vehicleinspection` (no migration, no new table, no new screen). One route learns `inspection_type` and validates checklists per type; the start gate and `pre_trip_status` gain an `inspection_type = 'Pre-Trip'` filter; `inspection.js` becomes dual-mode (derives mode from params); Home/Trips/Trip-Detail enforce Pre-Shift flow on the client while the server hard-gate stays per-trip Pre-Trip only.

**Tech Stack:** Next.js 16 route handlers, `pg` via `@/lib/db`, Expo Router mobile app, Vitest (`npm run test:run`), ESLint (`npm run lint`).

## Global Constraints

- **No migration.** `trip_id` is already nullable (048) and `inspection_type` is free `varchar(50)`; a CHECK constraint would break `scripts/seed-demo.mjs:501` (`Post-Trip`, `Monthly`).
- **No new table, no third inspection type.** Quick checks keep `inspection_type = "Pre-Trip"`; baseline uses `"Pre-Shift"`.
- **Preserve unchanged:** `requireDriver`, driver/vehicle/trip ownership server-side resolution, `client_submission_id` idempotency (migration 060 index), offline outbox queue, failed-inspection notifications to `trips.update_all` roles, the trip-scoped start gate, departure window, pair check, odometer, license/registration/driver-status validations.
- **Pre-Shift enforcement is mobile-only** (Home/Trips UI); server start gate checks per-trip Pre-Trip only.
- **Inspection failure never flips `vehicle_status`** — no calls to `groundIncident()` / `syncVehicleStatus()`; severity only (`High`/`Medium`/`None`).
- **No bypass UI:** no "Ignore"/"Continue Anyway"; no auto reassignment; no fake data; no new libraries.
- **Ship-together:** server accepts only 4-item Pre-Trip payloads; old 7-item bodies 400. An offline replay of a pre-upgrade 7-item queue entry is therefore **discarded** by `mobile/lib/sync.js`, not retried — a 400 is a permanent failure there (`sync.js:255-266`) unless the action is an incident report, which is quarantined instead. That is existing outbox policy for non-incident actions, but the driver-visible effect belongs on the record: they believe the inspection was submitted, the trip will not start, and their only signal is the Pre-Trip CTA reappearing on the trip detail. The exposure window is "driver queued an inspection, then updated the app before it synced".
- **Mobile:** follow existing claymorphism/`ClayCard`/`ClayButton` patterns, dark/light, one action per state; consult Expo v57 docs (`mobile/AGENTS.md`) before any new Expo API (this plan uses only existing patterns).
- **Coach marks are governed by `Capstone/02 - Features/Driver In-App Guide.md` and it is binding, not background reading.** §3 is titled "Six Core Operational Guides" — there are six and no seventh (§2's first-launch introduction is separate); one coach mark targets one exact control, never a screen or a parent card (§9); protected actions must never become tutorial-required (§7 Rule 3); one guide at a time, and a refused trigger stays incomplete and returns (§7 Rule 5); a guide never mutates production state (§7 Rule 4). Task 7b implements against these; any addition that breaks one is a defect, not a tradeoff.
- **Commands:** tests `npm run test:run`; lint `npm run lint`; commit after every task.

## Execution override (user ruling, 2026-09-23)

- **DO NOT COMMIT.** Skip every commit step in this plan. All changes stay uncommitted in the working tree for user review.

## File Structure

| File | Responsibility |
|---|---|
| Create `src/lib/inspections/checklists.js` | Server-side type→item-set + validation (single source for the API) |
| Create `src/lib/inspections/checklists.test.js` | Unit tests for the module |
| Create `src/lib/trips/status-groups.js` | Shared `PRE_START_TRIP_STATUSES` / `LIVE_TRIP_STATUSES` — stops this plan adding a third copy of the lifecycle list |
| Rewrite `src/app/api/mobile/driver/inspections/route.js` | Type-aware POST + filtered GET |
| Create `src/app/api/mobile/driver/inspections/route.test.js` | Full §24 API matrix (file does not exist today) |
| Modify `src/app/api/trips/[id]/start/route.js:60-76` | Gate adds `inspection_type = 'Pre-Trip'` |
| Modify `src/app/api/mobile/driver/trips/route.js:38-49` | `preTripStatus()` adds same filter |
| Modify `src/app/api/trips/[id]/start/route.test.js` | Gate-deny + type-filter tests |
| Create `mobile/lib/inspection-checklist.js` | UI checklist constants (mirror of server module) |
| Create `mobile/lib/inspection-checklist.test.js` | Unit tests |
| Modify `mobile/app/(app)/inspection.js` | Dual-mode screen |
| Modify `mobile/lib/inspection-tour.test.js` | Import shared lists; guard tires∈quick |
| Create `mobile/lib/use-pre-shift.js` | Today's Pre-Shift status hook (home + trip detail) |
| Modify `mobile/lib/trip-detail.js:37-53` | `readinessFor` + `preShiftPassed` |
| Modify `mobile/lib/trip-detail.test.js` | New readiness cases |
| Modify `mobile/app/(app)/trip/[id].js` | Readiness copy + navigable CTA |
| Modify `mobile/lib/home-trips.js:21-26` + `home-trips.test.js` | `homeTripAction` pre-shift gate |
| Modify `mobile/app/(app)/(tabs)/index.js` | Start-Shift banner + status + prop threading |
| Modify `mobile/components/home/DriverHomeCards.jsx:190,205` | `preShiftPassed` prop |
| Modify `mobile/lib/trips-queue.js` + `trips-queue.test.js` | `preTripChipLabel()` |
| Modify `mobile/app/(app)/(tabs)/trips.js` | Pre-Trip chip on cards |
| Modify `mobile/lib/coach-marks.js` + `coach-marks.test.js` | Guide-1 copy for two types + the `preshift` milestone |
| Modify `mobile/app/(app)/inspection.js`, `(tabs)/index.js`, `trip/[id].js` | `triggerMilestone(key, ctx)` call sites + the banner target |
| Modify `mobile/README.md:41` | Stale description |
| Verify `src/app/(dashboard)/driver/vehicle/page.js`, `driver/page.js` | Handle 4-item/typed inspections |
| Docs: `Capstone/02 - Features/Trips.md`, `Driver In-App Guide.md`, `Maintenance.md`, `SYSTEM.md` | Vault sync |

---

### Task 1: Server checklist module

**Files:**
- Create: `src/lib/inspections/checklists.js`
- Test: `src/lib/inspections/checklists.test.js`

**Interfaces:**
- Produces (consumed by Task 2): `INSPECTION_TYPES: string[]`, `PRE_SHIFT_ITEMS: string[]` (7), `PRE_TRIP_ITEMS: string[]` (4), `CRITICAL_ITEM_IDS: string[]`, `itemsForType(type): string[] | null`, `validateChecklist(type, items): { ok: true } | { ok: false, error: string }`

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/inspections/checklists.test.js
import { describe, it, expect } from "vitest";
import {
  INSPECTION_TYPES, PRE_SHIFT_ITEMS, PRE_TRIP_ITEMS, CRITICAL_ITEM_IDS,
  itemsForType, validateChecklist,
} from "./checklists";

const items = (ids, status = "PASS", remarks = "") =>
  ids.map((item_id) => ({ item_id, label: item_id, status, remarks }));

describe("checklists", () => {
  it("exposes exactly the two spec types", () => {
    expect(INSPECTION_TYPES).toEqual(["Pre-Shift", "Pre-Trip"]);
  });
  it("Pre-Shift is the full 7-point set; Pre-Trip is the 4 critical items", () => {
    expect(PRE_SHIFT_ITEMS).toEqual(["cabin", "aircon", "dashboard", "exterior", "brakes", "tires", "fuel"]);
    expect(PRE_TRIP_ITEMS).toEqual(["dashboard", "brakes", "tires", "exterior"]);
    expect(CRITICAL_ITEM_IDS).toEqual(PRE_TRIP_ITEMS);
    expect(PRE_TRIP_ITEMS.every((id) => PRE_SHIFT_ITEMS.includes(id))).toBe(true);
  });
  it("itemsForType returns null for unknown types", () => {
    expect(itemsForType("Pre-Shift")).toEqual(PRE_SHIFT_ITEMS);
    expect(itemsForType("Pre-Trip")).toEqual(PRE_TRIP_ITEMS);
    expect(itemsForType("Post-Trip")).toBeNull();
  });
  it("rejects unknown inspection_type", () => {
    expect(validateChecklist("Monthly", items(PRE_TRIP_ITEMS))).toEqual({
      ok: false, error: "inspection_type must be Pre-Shift or Pre-Trip",
    });
  });
  it("rejects empty and wrong-count item lists per type", () => {
    expect(validateChecklist("Pre-Trip", []).ok).toBe(false);
    expect(validateChecklist("Pre-Trip", items(PRE_SHIFT_ITEMS)).error)
      .toBe("exactly 4 inspection items are required for Pre-Trip");
    expect(validateChecklist("Pre-Shift", items(PRE_TRIP_ITEMS)).error)
      .toBe("exactly 7 inspection items are required for Pre-Shift");
  });
  it("rejects ids outside the type set, duplicates, and missing ids", () => {
    const withCabin = [...PRE_TRIP_ITEMS.slice(0, 3), "cabin"];
    expect(validateChecklist("Pre-Trip", items(withCabin)).ok).toBe(false);
    const dup = [...PRE_TRIP_ITEMS.slice(0, 3), PRE_TRIP_ITEMS[0]];
    expect(validateChecklist("Pre-Trip", items(dup)).ok).toBe(false);
    const missingTires = PRE_TRIP_ITEMS.filter((id) => id !== "tires").concat("cabin");
    expect(validateChecklist("Pre-Trip", items(missingTires)).ok).toBe(false);
  });
  it("requires FAIL remarks, caps length, accepts all-PASS", () => {
    const failNoRemarks = PRE_TRIP_ITEMS.map((item_id) =>
      ({ item_id, status: item_id === "brakes" ? "FAIL" : "PASS", remarks: "  " }));
    expect(validateChecklist("Pre-Trip", failNoRemarks)).toEqual({
      ok: false, error: "remarks are required for failed item 'brakes'",
    });
    const long = items(PRE_SHIFT_ITEMS, "PASS").map((i) => ({ ...i, remarks: "x".repeat(1001) }));
    expect(validateChecklist("Pre-Shift", long).error).toBe("inspection remarks must be 1000 characters or fewer");
    expect(validateChecklist("Pre-Shift", items(PRE_SHIFT_ITEMS))).toEqual({ ok: true });
    expect(validateChecklist("Pre-Trip", items(PRE_TRIP_ITEMS, "FAIL", "noise"))).toEqual({ ok: true });
  });
  it("rejects invalid statuses and non-array input", () => {
    expect(validateChecklist("Pre-Trip", items(PRE_TRIP_ITEMS).map((i, idx) =>
      idx === 0 ? { ...i, status: "MAYBE" } : i)).ok).toBe(false);
    expect(validateChecklist("Pre-Trip", null).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/inspections/checklists.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/lib/inspections/checklists.js
export const INSPECTION_TYPES = ["Pre-Shift", "Pre-Trip"];

export const PRE_SHIFT_ITEMS = [
  "cabin", "aircon", "dashboard", "exterior", "brakes", "tires", "fuel",
];

export const PRE_TRIP_ITEMS = ["dashboard", "brakes", "tires", "exterior"];

export const CRITICAL_ITEM_IDS = [...PRE_TRIP_ITEMS];

export function itemsForType(type) {
  if (type === "Pre-Shift") return PRE_SHIFT_ITEMS;
  if (type === "Pre-Trip") return PRE_TRIP_ITEMS;
  return null;
}

export function validateChecklist(type, items) {
  if (!INSPECTION_TYPES.includes(type)) {
    return { ok: false, error: "inspection_type must be Pre-Shift or Pre-Trip" };
  }
  const expected = itemsForType(type);
  if (!Array.isArray(items) || !items.length) {
    return { ok: false, error: "items is required and must not be empty" };
  }
  if (items.length !== expected.length) {
    return { ok: false, error: `exactly ${expected.length} inspection items are required for ${type}` };
  }
  const validIds = new Set(expected);
  const seen = new Set();
  const validStatuses = new Set(["PASS", "FAIL"]);
  for (const item of items) {
    if (!validIds.has(item?.item_id) || seen.has(item.item_id) || !validStatuses.has(item?.status)) {
      return { ok: false, error: "each item needs item_id and a PASS|FAIL status" };
    }
    if (typeof item.remarks !== "undefined" && String(item.remarks).length > 1000) {
      return { ok: false, error: "inspection remarks must be 1000 characters or fewer" };
    }
    if (item.status === "FAIL" && !String(item.remarks || "").trim()) {
      return { ok: false, error: `remarks are required for failed item '${item.item_id}'` };
    }
    seen.add(item.item_id);
  }
  return { ok: true };
}
```

(Count + set-membership + no-dups ⇒ every expected id present exactly once.)

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/inspections/checklists.test.js` → PASS.

- [ ] **Step 5: Commit**

(SKIPPED — user ruling: no commits. Leave changes uncommitted.)

---

### Task 2: Type-aware inspections API (POST + GET)

**Files:**
- Create: `src/lib/trips/status-groups.js`
- Modify: `src/app/api/mobile/driver/inspections/route.js` (full POST rewrite, GET filter)
- Modify: `src/app/api/mobile/driver/me/route.js` (adopt the shared live-status list — behavior-preserving)
- Test: `src/app/api/mobile/driver/inspections/route.test.js` (new)

**Interfaces:**
- Consumes: Task 1 exports (`INSPECTION_TYPES`, `CRITICAL_ITEM_IDS`, `validateChecklist` from `@/lib/inspections/checklists`).
- Produces (Tasks 3/5/6/7): `POST` body `{ inspection_type, trip_id, client_submission_id, items, inspected_at }`; Pre-Trip ⇒ `trip_id` positive int + 4 quick items; Pre-Shift ⇒ `trip_id` null + 7 items; GET `?inspection_type=Pre-Shift` returns driver-scoped rows newest-first (plain array via `ok(rows)`).

- [ ] **Step 1: Write the failing test file**

```js
// src/app/api/mobile/driver/inspections/route.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", () => ({
  requireDriver: vi.fn(),
  parseBody: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  err: (message, status) => Response.json({ error: message }, { status }),
  handleError: (e) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
  AuthError: class extends Error {
    constructor(message, status) { super(message); this.status = status; }
  },
}));
vi.mock("@/services/push.service", () => ({ sendPush: vi.fn() }));
vi.mock("@/lib/notifications/recipients", () => ({ notificationRolesFor: vi.fn(() => ["admin"]) }));

import { query } from "@/lib/db";
import { requireDriver, parseBody } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { PRE_SHIFT_ITEMS as FULL_IDS, PRE_TRIP_ITEMS as QUICK_IDS } from "@/lib/inspections/checklists";
import { POST, GET } from "./route";

// The ids are imported rather than hand-copied so the route test cannot drift
// from the module it exercises; their literal values are pinned by Task 1's
// checklists.test.js, which is where the "is this the right set?" assertion
// belongs.
const CID = "abc123def456ghi7"; // 16 chars, matches /^[0-9a-z-]{16,64}$/i

const build = (ids, overrides = {}) =>
  ids.map((item_id) => ({ item_id, label: item_id, status: "PASS", remarks: "", ...overrides[item_id] }));

const baseBody = (extra = {}) => ({
  inspection_type: "Pre-Trip",
  trip_id: 7,
  client_submission_id: CID,
  items: build(QUICK_IDS),
  ...extra,
});

const post = () => POST(new Request("http://localhost/api/mobile/driver/inspections", { method: "POST" }));

function getInsertParams(call) {
  const sql = call[0], values = call[1];
  // The INSERT template breaks the line between the table name and the column
  // list, so the match must tolerate whitespace there, and `[^)]*` keeps the
  // capture inside the parens instead of running on to a later `)`. Written as
  // `/...vehicleinspection \(/` this never matches — `match` returns null and
  // every caller dies on a TypeError instead of letting its assertion fail.
  const cols = sql.match(/INSERT INTO vehicleinspection\s*\(([^)]*)\)/)[1].split(",").map((c) => c.trim());
  return Object.fromEntries(cols.map((c, i) => [c, values[i]]));
}

const defaultQuery = async (sql) => {
  if (sql.includes("t.trip_id = $1")) return { rows: [{ trip_id: 7, vehicle_id: 3, plate_number: "ABC-1234" }] };
  if (sql.includes("FROM driver_vehicle_assignments")) return { rows: [{ vehicle_id: 4, plate_number: "XYZ-987" }] };
  if (sql.includes("trip_status IN")) return { rows: [] };
  if (sql.startsWith("INSERT INTO vehicleinspection")) return { rows: [{ inspection_id: 9, trip_id: 7, status: "Passed" }] };
  if (sql.includes("FROM employees")) return { rows: [{ employee_id: 5 }] };
  if (sql.startsWith("INSERT INTO notifications")) return { rows: [] };
  if (sql.includes("SELECT inspection_id, trip_id, status FROM vehicleinspection")) return { rows: [] };
  return { rows: [] };
};

beforeEach(() => {
  vi.clearAllMocks();
  requireDriver.mockResolvedValue({ user: { driverId: 2, employeeId: 1 } });
  query.mockImplementation(defaultQuery);
});
afterEach(() => vi.clearAllMocks());

const insertCall = () => query.mock.calls.find((c) => c[0].startsWith("INSERT INTO vehicleinspection"));

// The notifications INSERT is (employee_id, title, message, type,
// reference_type, reference_id) — so in a recorded call, values[1] is the TITLE
// and values[2] is the MESSAGE. values[3] is the literal "Alert". Reading [2]
// as the title and [3] as the message is off by one and fails both
// FAIL-notification tests below.
const notifCall = () => query.mock.calls.find((c) => c[0].startsWith("INSERT INTO notifications"));

describe("POST /api/mobile/driver/inspections — Pre-Trip", () => {
  it("rejects a missing or unknown inspection_type", async () => {
    parseBody.mockResolvedValue({ ...baseBody(), inspection_type: "Monthly" });
    expect((await post()).status).toBe(400);
    parseBody.mockResolvedValue({ ...baseBody(), inspection_type: undefined });
    expect((await post()).status).toBe(400);
  });
  it("rejects Pre-Trip with null trip_id (regression: Number(null)===0)", async () => {
    parseBody.mockResolvedValue(baseBody({ trip_id: null }));
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("trip_id is required for a Pre-Trip inspection");
  });
  it("accepts 4 quick items all PASS and inserts type Pre-Trip", async () => {
    parseBody.mockResolvedValue(baseBody());
    const res = await post();
    expect(res.status).toBe(201);
    const params = getInsertParams(insertCall());
    expect(params.inspection_type).toBe("Pre-Trip");
    expect(params.trip_id).toBe(7);
    expect(params.vehicle_id).toBe(3);
    expect(params.status).toBe("Passed");
    expect(params.severity).toBe("None");
    expect(sendPush).not.toHaveBeenCalled();
  });
  it("rejects the legacy 7-item payload for Pre-Trip", async () => {
    parseBody.mockResolvedValue(baseBody({ items: build(FULL_IDS) }));
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("exactly 4 inspection items are required for Pre-Trip");
  });
  it("requires remarks on FAIL", async () => {
    parseBody.mockResolvedValue(baseBody({
      items: build(QUICK_IDS, { brakes: { status: "FAIL", remarks: "" } }),
    }));
    expect((await post()).status).toBe(400);
  });
  it("FAIL inserts Failed + High severity and notifies dispatch", async () => {
    parseBody.mockResolvedValue(baseBody({
      items: build(QUICK_IDS, { brakes: { status: "FAIL", remarks: "pedal soft" } }),
    }));
    const res = await post();
    expect(res.status).toBe(201);
    const params = getInsertParams(insertCall());
    expect(params.status).toBe("Failed");
    expect(params.severity).toBe("High");
    expect(params.findings).toContain("brakes");
    expect(notifCall()[1][1]).toBe("Failed Pre-Trip Inspection");
    expect(notifCall()[1][2]).toMatch(/ABC-1234 failed the quick pre-trip safety check for Trip #7/);
    expect(notifCall()[1][2]).toMatch(/brakes/);
    expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed Pre-Trip Inspection" }));
  });
  it("404s a trip the driver does not own", async () => {
    query.mockImplementation(async (sql) =>
      sql.includes("t.trip_id = $1") ? { rows: [] } : defaultQuery(sql));
    parseBody.mockResolvedValue(baseBody());
    expect((await post()).status).toBe(404);
  });
  it("404s (not 400s) a non-owned trip even when the payload is also invalid", async () => {
    // Ownership is answered before payload validity, as it was before this
    // change — answering 400 here would confirm the trip exists to a driver
    // who does not own it.
    query.mockImplementation(async (sql) =>
      sql.includes("t.trip_id = $1") ? { rows: [] } : defaultQuery(sql));
    parseBody.mockResolvedValue(baseBody({ items: build(FULL_IDS) }));
    expect((await post()).status).toBe(404);
  });
  it("400s when the trip has no vehicle assigned", async () => {
    query.mockImplementation(async (sql) =>
      sql.includes("t.trip_id = $1") ? { rows: [{ trip_id: 7, vehicle_id: null }] } : defaultQuery(sql));
    parseBody.mockResolvedValue(baseBody());
    expect((await post()).status).toBe(400);
  });
  it("replayed client_submission_id returns the original row without a second insert or notification", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("t.trip_id = $1")) return { rows: [{ trip_id: 7, vehicle_id: 3, plate_number: "ABC-1234" }] };
      if (sql.startsWith("INSERT INTO vehicleinspection")) return { rows: [] };
      if (sql.includes("SELECT inspection_id, trip_id, status FROM vehicleinspection")) {
        return { rows: [{ inspection_id: 9, trip_id: 7, status: "Failed", inspection_type: "Pre-Trip" }] };
      }
      return { rows: [] };
    });
    parseBody.mockResolvedValue(baseBody({
      items: build(QUICK_IDS, { tires: { status: "FAIL", remarks: "low" } }),
    }));
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).inspection_id).toBe(9);
    expect(sendPush).not.toHaveBeenCalled();
  });
  it("409s when the submission id was already used for another trip", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("t.trip_id = $1")) return { rows: [{ trip_id: 7, vehicle_id: 3, plate_number: "ABC-1234" }] };
      if (sql.startsWith("INSERT INTO vehicleinspection")) return { rows: [] };
      if (sql.includes("SELECT inspection_id, trip_id, status FROM vehicleinspection")) {
        return { rows: [{ inspection_id: 9, trip_id: 8, status: "Passed", inspection_type: "Pre-Trip" }] };
      }
      return { rows: [] };
    });
    parseBody.mockResolvedValue(baseBody());
    expect((await post()).status).toBe(409);
  });
  it("rejects a malformed client_submission_id", async () => {
    parseBody.mockResolvedValue(baseBody({ client_submission_id: "short" }));
    expect((await post()).status).toBe(400);
  });
});

describe("POST — Pre-Shift", () => {
  const shiftBody = (extra = {}) => baseBody({ inspection_type: "Pre-Shift", trip_id: null, items: build(FULL_IDS), ...extra });

  it("accepts without trip_id and inserts trip_id NULL", async () => {
    parseBody.mockResolvedValue(shiftBody());
    const res = await post();
    expect(res.status).toBe(201);
    const params = getInsertParams(insertCall());
    expect(params.inspection_type).toBe("Pre-Shift");
    expect(params.trip_id).toBeNull();
    expect(params.vehicle_id).toBe(4); // assignment fallback (no live trip)
    expect(params.status).toBe("Passed");
    expect(params.severity).toBe("None");
  });
  it("resolves the vehicle from a live trip when one exists", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("trip_status IN")) return { rows: [{ vehicle_id: 3, plate_number: "ABC-1234" }] };
      return defaultQuery(sql);
    });
    parseBody.mockResolvedValue(shiftBody());
    await post();
    expect(getInsertParams(insertCall()).vehicle_id).toBe(3);
  });
  it("rejects trip_id on Pre-Shift", async () => {
    parseBody.mockResolvedValue(shiftBody({ trip_id: 7 }));
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Pre-Shift inspections must not include trip_id");
  });
  it("rejects the 4-item quick list for Pre-Shift", async () => {
    parseBody.mockResolvedValue(shiftBody({ items: build(QUICK_IDS) }));
    expect((await post()).status).toBe(400);
  });
  it("400s when the driver has no live trip and no assignment", async () => {
    query.mockImplementation(async (sql) =>
      sql.includes("FROM driver_vehicle_assignments") || sql.includes("trip_status IN")
        ? { rows: [] } : defaultQuery(sql));
    parseBody.mockResolvedValue(shiftBody());
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No vehicle is assigned/);
  });
  it("non-critical FAIL → severity Medium + Failed Pre-Shift Inspection notification", async () => {
    parseBody.mockResolvedValue(shiftBody({
      items: build(FULL_IDS, { cabin: { status: "FAIL", remarks: "spill needs cleaning" } }),
    }));
    const res = await post();
    expect(res.status).toBe(201);
    const params = getInsertParams(insertCall());
    expect(params.status).toBe("Failed");
    expect(params.severity).toBe("Medium");
    expect(notifCall()[1][1]).toBe("Failed Pre-Shift Inspection");
    expect(notifCall()[1][2]).toMatch(/failed the pre-shift inspection/);
    expect(notifCall()[1][2]).toMatch(/cabin/);
    expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed Pre-Shift Inspection" }));
  });
  it("critical FAIL on Pre-Shift → severity High", async () => {
    parseBody.mockResolvedValue(shiftBody({
      items: build(FULL_IDS, { brakes: { status: "FAIL", remarks: "grinding" } }),
    }));
    await post();
    expect(getInsertParams(insertCall()).severity).toBe("High");
  });
  it("replayed Pre-Shift submission resolves without a false 409 (null trip_id)", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("trip_status IN")) return { rows: [] };
      if (sql.includes("FROM driver_vehicle_assignments")) return { rows: [{ vehicle_id: 4, plate_number: "XYZ-987" }] };
      if (sql.startsWith("INSERT INTO vehicleinspection")) return { rows: [] };
      if (sql.includes("SELECT inspection_id, trip_id, status FROM vehicleinspection")) {
        return { rows: [{ inspection_id: 9, trip_id: null, status: "Passed", inspection_type: "Pre-Shift" }] };
      }
      return { rows: [] };
    });
    parseBody.mockResolvedValue(shiftBody());
    const res = await post();
    expect(res.status).toBe(200);
  });
});

describe("GET /api/mobile/driver/inspections", () => {
  const get = (url) => GET(new Request(url));
  it("rejects an unknown inspection_type filter", async () => {
    expect((await get("http://localhost/api/mobile/driver/inspections?inspection_type=Monthly")).status).toBe(400);
  });
  it("passes a valid inspection_type filter into the query", async () => {
    const res = await get("http://localhost/api/mobile/driver/inspections?inspection_type=Pre-Shift");
    expect(res.status).toBe(200);
    const call = query.mock.calls.find((c) => c[0].includes("FROM vehicleinspection"));
    expect(call[1]).toContain("Pre-Shift");
    expect(call[1][0]).toBe(2); // driverId scope stays first
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/app/api/mobile/driver/inspections/route.test.js`
Expected: FAIL — `inspection_type must be...` rejections missing, 7-item Pre-Trip still accepted, etc. These surface as assertion failures on the returned status codes. If instead the whole file errors out with `Cannot read properties of null`, the `getInsertParams` capture is wrong — fix that helper before reading anything into the rest of the output.

- [ ] **Step 3: Rewrite the route**

**First, give the trip-status lists one home.** The Pre-Shift branch below needs the live-trip statuses, which `me/route.js` already carries inline — adding them here as written would make a third copy. Create `src/lib/trips/status-groups.js`:

```js
// src/lib/trips/status-groups.js
// `LIVE_TRIP_STATUSES` already existed inline in
// src/app/api/mobile/driver/me/route.js:40, and `PRE_START_TRIP_STATUSES`
// already existed as INSPECTION_TRIP_STATUSES in the inspections route. They
// live here now so the Pre-Shift vehicle resolution does not add another copy.
// The mobile app keeps its own (mobile/lib/trips-queue.js: PRE_START /
// IN_PROGRESS) because it cannot import from src/ — keep the values in step by
// hand. The authoritative enum is the trip_status CHECK in migration 012.
export const PRE_START_TRIP_STATUSES = [
  "Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned",
  "Dispatched", "Driver Accepted",
];

export const LIVE_TRIP_STATUSES = [
  "Driver Accepted", "Trip Started", "At Pickup", "Passenger Onboard",
  "En Route", "Drop-off", "Arrived", "In Progress",
];
```

Then point `me/route.js` at it: import `LIVE_TRIP_STATUSES` and replace the inline `t.trip_status IN ('Driver Accepted', ...)` literal at line 40 with `t.trip_status = ANY($2::text[])` bound to the constant. Behavior-identical — the point is that the list has one home, so a status rename is one edit rather than four.

**Then** replace lines 1–156 of `route.js` with (GET changes in Step 3b):

```js
import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError, AuthError } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { notificationRolesFor } from "@/lib/notifications/recipients";
import { INSPECTION_TYPES, CRITICAL_ITEM_IDS, validateChecklist } from "@/lib/inspections/checklists";
import { PRE_START_TRIP_STATUSES, LIVE_TRIP_STATUSES } from "@/lib/trips/status-groups";

/**
 * POST /api/mobile/driver/inspections
 *
 * Two inspection types, one table (vehicleinspection):
 *  - "Pre-Trip"  — quick 4-item critical re-check; trip_id REQUIRED; only a
 *    Passed row for THIS trip unlocks POST /trips/:id/start.
 *  - "Pre-Shift" — full 7-point shift baseline; trip_id MUST be null; the
 *    vehicle resolves from the driver's live trip or their current
 *    driver_vehicle_assignments row (never from the client).
 *
 * status: all PASS → "Passed"; any FAIL → "Failed".
 * severity: no FAIL → "None"; FAIL on a critical item → "High"; FAIL only on
 * non-critical (Pre-Shift cabin/aircon/fuel) → "Medium". Never touches
 * vehicle_status — grounding stays with the existing incident/maintenance flow.
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const body = await parseBody(req);

    const inspectionType = String(body.inspection_type ?? "");
    if (!INSPECTION_TYPES.includes(inspectionType)) {
      return err("inspection_type must be Pre-Shift or Pre-Trip", 400);
    }
    const items = Array.isArray(body.items) ? body.items : [];
    const clientSubmissionId = body.client_submission_id;
    if (typeof clientSubmissionId !== "string" || !/^[0-9a-z-]{16,64}$/i.test(clientSubmissionId)) {
      return err("client_submission_id is required", 400);
    }
    const rawTripId = body.trip_id;
    const tripId =
      rawTripId === null || rawTripId === undefined || rawTripId === ""
        ? null
        : Number(rawTripId);

    let vehicleId = null;
    let plateNumber = null;
    let tripIdForInsert = null;

    if (inspectionType === "Pre-Trip") {
      if (!Number.isInteger(tripId) || tripId <= 0) {
        return err("trip_id is required for a Pre-Trip inspection", 400);
      }
      const { rows: trips } = await query(
        `SELECT t.trip_id, t.vehicle_id, v.plate_number
           FROM trips t
           LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
          WHERE t.trip_id = $1 AND t.driver_id = $2 AND t.deleted_at IS NULL
            AND t.trip_status = ANY($3::text[]) LIMIT 1`,
        [tripId, session.user.driverId, PRE_START_TRIP_STATUSES]
      );
      const trip = trips[0];
      if (!trip) throw new AuthError("Trip not found", 404);
      if (!trip.vehicle_id) {
        return err("A vehicle must be assigned before the pre-trip inspection", 400);
      }
      vehicleId = trip.vehicle_id;
      plateNumber = trip.plate_number;
      tripIdForInsert = tripId;
    } else {
      if (tripId !== null) {
        return err("Pre-Shift inspections must not include trip_id", 400);
      }
      // Same resolution order as GET /api/mobile/driver/me: live trip first,
      // then the current assignment. Client never supplies vehicle_id.
      const { rows: liveRows } = await query(
        `SELECT t.vehicle_id, v.plate_number
           FROM trips t
           JOIN vehicles v ON v.vehicle_id = t.vehicle_id AND v.deleted_at IS NULL
          WHERE t.driver_id = $1 AND t.deleted_at IS NULL
            AND t.trip_status = ANY($2::text[])
          ORDER BY t.start_time DESC NULLS LAST
          LIMIT 1`,
        [session.user.driverId, LIVE_TRIP_STATUSES]
      );
      if (liveRows[0]) {
        vehicleId = liveRows[0].vehicle_id;
        plateNumber = liveRows[0].plate_number;
      } else {
        const { rows: assignmentRows } = await query(
          `SELECT a.vehicle_id, v.plate_number
             FROM driver_vehicle_assignments a
             JOIN vehicles v ON v.vehicle_id = a.vehicle_id AND v.deleted_at IS NULL
            WHERE a.driver_id = $1 AND a.assigned_from <= CURRENT_DATE
              AND (a.assigned_until IS NULL OR a.assigned_until >= CURRENT_DATE)
            ORDER BY a.assigned_from DESC
            LIMIT 1`,
          [session.user.driverId]
        );
        if (!assignmentRows[0]) {
          return err("No vehicle is assigned to you — contact dispatch before starting your shift", 400);
        }
        vehicleId = assignmentRows[0].vehicle_id;
        plateNumber = assignmentRows[0].plate_number;
      }
      tripIdForInsert = null;
    }

    // Item validation runs AFTER ownership/vehicle resolution deliberately. The
    // endpoint answered 404 for a trip the driver does not own before it
    // answered 400 about its payload (route.js:38-75), and preserving that order
    // means a bad-checklist request against someone else's trip still 404s
    // rather than confirming the trip exists. The inspection_type and
    // client_submission_id checks stay up front — they need no DB round trip
    // and cannot leak anything.
    const checklistResult = validateChecklist(inspectionType, items);
    if (!checklistResult.ok) return err(checklistResult.error, 400);

    const allPass = items.every((i) => i.status === "PASS");
    const failures = items.filter((i) => i.status === "FAIL");
    const checklist = items.map((item) => ({
      item_id: item.item_id,
      label: item.label || item.item_id,
      status: item.status,
      remarks: item.remarks || "",
    }));
    const hasCriticalFailure = failures.some((f) => CRITICAL_ITEM_IDS.includes(f.item_id));
    const severity = failures.length ? (hasCriticalFailure ? "High" : "Medium") : "None";

    const { rows: insertedRows } = await query(
      `INSERT INTO vehicleinspection
         (vehicle_id, driver_id, trip_id, inspection_type, inspection_date, checklist, findings, severity, status, client_submission_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
       ON CONFLICT (driver_id, client_submission_id) WHERE client_submission_id IS NOT NULL
       DO NOTHING
       RETURNING inspection_id, trip_id, inspection_type, status`,
      [
        vehicleId,
        session.user.driverId,
        tripIdForInsert,
        inspectionType,
        new Date().toISOString().slice(0, 10),
        JSON.stringify(checklist),
        failures.length ? JSON.stringify(failures) : null,
        severity,
        allPass ? "Passed" : "Failed",
        clientSubmissionId,
      ]
    );

    const inserted = Boolean(insertedRows[0]);
    let inspection = insertedRows[0];
    if (!inspection) {
      const { rows: existingRows } = await query(
        `SELECT inspection_id, trip_id, inspection_type, status FROM vehicleinspection
          WHERE driver_id = $1 AND client_submission_id = $2 LIMIT 1`,
        [session.user.driverId, clientSubmissionId]
      );
      inspection = existingRows[0];
      if (!inspection) throw new Error("Inspection retry could not be resolved");
      const existingTripId = inspection.trip_id == null ? null : Number(inspection.trip_id);
      if (existingTripId !== tripIdForInsert) {
        return err("client_submission_id was already used for another trip", 409);
      }
      if (inspection.inspection_type !== inspectionType) {
        return err("client_submission_id was already used for another inspection type", 409);
      }
    }

    if (!allPass && inserted) {
      try {
        const { rows: overseers } = await query(
          `SELECT e.employee_id FROM employees e
             JOIN roles r ON r.role_id = e.role_id
            WHERE r.role_name = ANY($1)
              AND e.deleted_at IS NULL
              AND e.role_id IS NOT NULL`,
          [notificationRolesFor("trips", "update_all")]
        );
        const failedLabels = failures.map((f) => f.label || f.item_id).join(", ");
        const remarksLine = failures
          .map((f) => String(f.remarks || "").trim())
          .filter(Boolean)
          .join("; ");
        const title = inspectionType === "Pre-Shift"
          ? "Failed Pre-Shift Inspection"
          : "Failed Pre-Trip Inspection";
        const where = inspectionType === "Pre-Shift"
          ? "failed the pre-shift inspection"
          : `failed the quick pre-trip safety check for Trip #${tripIdForInsert}`;
        const notificationMessage =
          `${plateNumber || `Vehicle #${vehicleId}`} ${where}. Failed: ${failedLabels}.` +
          `${remarksLine ? ` Remarks: ${remarksLine}.` : ""} Requires review.`;
        for (const overseer of overseers) {
          await query(
            `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [overseer.employee_id, title, notificationMessage, "Alert", "vehicle", vehicleId]
          );
        }
        await sendPush({
          employeeIds: overseers.map((overseer) => overseer.employee_id),
          title,
          body: notificationMessage,
          data: { reference_type: "vehicle", reference_id: vehicleId },
        });
      } catch (notificationError) {
        console.warn("inspection oversight notification failed:", notificationError?.message || notificationError);
      }
    }

    return ok(inspection, inserted ? 201 : 200);
  } catch (e) {
    return handleError(e);
  }
}
```

- [ ] **Step 3b: GET — type filter + testable URL parsing**

In the existing `GET` (lines 164–189): replace `const sp = req.nextUrl.searchParams;` with `const sp = new URL(req.url).searchParams;` (standard `Request`-compatible), add:

```js
    const inspectionType = sp.get("inspection_type");
    if (inspectionType && !INSPECTION_TYPES.includes(inspectionType)) {
      return err("Invalid inspection_type", 400);
    }
```

and extend the SQL/params:

```sql
         WHERE driver_id = $1
          AND ($2::int IS NULL OR trip_id = $2)
          AND ($4::text IS NULL OR inspection_type = $4)
        ORDER BY created_at DESC, inspection_id DESC
        LIMIT $3
```

params: `[session.user.driverId, tripId, 50, inspectionType ?? null]`. Update the doc comment to mention the type filter.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/api/mobile/driver/inspections/route.test.js src/lib/inspections/checklists.test.js` → all PASS.

- [ ] **Step 5: Commit**

(SKIPPED — user ruling: no commits.)

---

### Task 3: Start gate + pre_trip_status type filter

**Files:**
- Modify: `src/app/api/trips/[id]/start/route.js:60-76`
- Modify: `src/app/api/mobile/driver/trips/route.js:38-49`
- Test: `src/app/api/trips/[id]/start/route.test.js`

**Interfaces:**
- Consumes: rows produced by Task 2 (`inspection_type = 'Pre-Trip'` + `trip_id`).
- Produces: gate contract for Tasks 5–7 UIs — only a Passed quick Pre-Trip **for that trip** unlocks start; a Pre-Shift row (`trip_id IS NULL`) can never match.

- [ ] **Step 1: Write the failing tests** (append to `start/route.test.js`)

First refactor `beforeEach` so the default impl is reusable:

```js
const defaultQuery = (sql) => ({
  rows: sql.includes('FROM dispatchschedules')
    ? [{ dispatch_id: 8, driver_id: 2, vehicle_id: 3, scheduled_departure: new Date(Date.now() + 15 * 60_000).toISOString() }]
    : sql.includes('FROM vehicleinspection') ? [{ status: 'Passed' }]
    : sql.includes('FROM vehicles') ? [{ registration_expiry: '2099-01-01', vehicle_status: 'Available' }]
    : sql.includes('FROM drivers') ? [{ license_expiry: '2099-01-01', driver_status: 'Available' }]
    : [],
});
beforeEach(() => {
  vi.clearAllMocks();
  query.mockImplementation(async (sql) => defaultQuery(sql));
  validatePairAvailability.mockResolvedValue({ ok: true, commitToken: { revision: 'current' } });
});
```

(Existing two tests keep their local `validatePairAvailability` overrides — first test still sets `ok:false` itself.)

New tests:

```js
it('blocks start when no inspection exists for this trip', async () => {
  query.mockImplementation(async (sql) =>
    sql.includes('FROM vehicleinspection') ? { rows: [] } : defaultQuery(sql));
  expect((await run()).status).toBe(400);
  expect((await (await run()).json()).error).toMatch(/inspection/i);
});
it('blocks start when the latest inspection for this trip Failed', async () => {
  query.mockImplementation(async (sql) =>
    sql.includes('FROM vehicleinspection') ? { rows: [{ status: 'Failed' }] } : defaultQuery(sql));
  expect((await run()).status).toBe(400);
});
it('scopes the gate to this trip AND inspection_type Pre-Trip (a Pre-Shift row can never satisfy it)', async () => {
  validatePairAvailability.mockResolvedValue({ ok: true, commitToken: { revision: 'current' } });
  const tx = { query: vi.fn(async (sql) => ({ rows: sql.startsWith('UPDATE trips') ? [{ trip_id: 7, trip_status: 'Trip Started', start_odometer: null }] : [] })) };
  commitDispatchEvidence.mockImplementation(async (_t, write) => write(tx));
  expect((await run()).status).toBe(200);
  const gate = query.mock.calls.find((c) => c[0].includes('FROM vehicleinspection'));
  expect(gate[0]).toContain('i.trip_id = $1');
  expect(gate[0]).toContain("i.inspection_type = 'Pre-Trip'");
});
```

(`commitDispatchEvidence` is already imported at the top of the existing test file — reuse that import.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run "src/app/api/trips/[id]/start/route.test.js"`
Expected: FAIL on the `inspection_type` assertion; deny-tests PASS today (they are regression locks). The type-filter test is the red one.

- [ ] **Step 3: Implement**

In `src/app/api/trips/[id]/start/route.js` gate SQL add one line:

```js
    // Pre-trip check gate: the driver must have a Passed QUICK Pre-Trip
    // inspection for THIS trip. The type filter keeps a Pre-Shift baseline row
    // (trip_id IS NULL) from ever satisfying a trip's gate — trip_id scoping
    // already excludes them; this makes the contract explicit.
    const { rows: pretrips } = await query(
      `SELECT i.inspection_id, i.status
         FROM vehicleinspection i
         JOIN trips t ON t.trip_id = i.trip_id
        WHERE i.trip_id = $1
          AND i.inspection_type = 'Pre-Trip'
          AND i.driver_id = t.driver_id
          AND i.vehicle_id = t.vehicle_id
        ORDER BY i.created_at DESC, i.inspection_id DESC LIMIT 1`,
      [id]
    );
```

Keep the existing 400 error message (it contains "inspection", which `trip/[id].js:191` matches on).

In `src/app/api/mobile/driver/trips/route.js` `preTripStatus()` (lines 38–49) add the same `AND i.inspection_type = 'Pre-Trip'` after `WHERE i.trip_id = $1`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run "src/app/api/trips/[id]/start/route.test.js" src/app/api/mobile/driver/inspections/route.test.js` → PASS.

- [ ] **Step 5: Commit**

(SKIPPED — user ruling: no commits.)

---

### Task 4: Mobile checklist module

**Files:**
- Create: `mobile/lib/inspection-checklist.js`
- Create: `mobile/lib/inspection-checklist.test.js`
- Modify: `mobile/lib/inspection-tour.test.js`

**Interfaces:**
- Produces (Task 5): `PRE_SHIFT_CHECKLIST: {id,label,passLabel?,failLabel?}[]` (7), `PRE_TRIP_CHECKLIST` (4), `checklistForMode(mode)`, `inspectionTypeForMode(mode)` where mode ∈ `"preshift" | "pretrip"`.

- [ ] **Step 1: Failing tests**

```js
// mobile/lib/inspection-checklist.test.js
import { describe, it, expect } from "vitest";
import {
  PRE_SHIFT_CHECKLIST, PRE_TRIP_CHECKLIST, checklistForMode, inspectionTypeForMode,
} from "./inspection-checklist";
import { QUICK_PASS_FAILED_ID } from "./inspection-tour";

describe("inspection-checklist", () => {
  it("Pre-Shift has the full 7 items with the original labels", () => {
    expect(PRE_SHIFT_CHECKLIST.map((i) => i.id))
      .toEqual(["cabin", "aircon", "dashboard", "exterior", "brakes", "tires", "fuel"]);
    expect(PRE_SHIFT_CHECKLIST.find((i) => i.id === "dashboard"))
      .toMatchObject({ passLabel: "NO LIGHTS", failLabel: "WARNING" });
  });
  it("Pre-Trip has exactly the 4 critical items, a subset of Pre-Shift", () => {
    expect(PRE_TRIP_CHECKLIST.map((i) => i.id)).toEqual(["dashboard", "brakes", "tires", "exterior"]);
    const fullIds = PRE_SHIFT_CHECKLIST.map((i) => i.id);
    expect(PRE_TRIP_CHECKLIST.every((i) => fullIds.includes(i.id))).toBe(true);
  });
  it("keeps tires in the quick set — the tour's seeded FAIL depends on it", () => {
    expect(PRE_TRIP_CHECKLIST.map((i) => i.id)).toContain(QUICK_PASS_FAILED_ID);
  });
  it("every item has a label", () => {
    [...PRE_SHIFT_CHECKLIST, ...PRE_TRIP_CHECKLIST].forEach((i) => expect(i.label).toBeTruthy());
  });
  it("maps modes to checklists and API types", () => {
    expect(checklistForMode("pretrip")).toBe(PRE_TRIP_CHECKLIST);
    expect(checklistForMode("preshift")).toBe(PRE_SHIFT_CHECKLIST);
    expect(checklistForMode(undefined)).toBe(PRE_SHIFT_CHECKLIST);
    expect(inspectionTypeForMode("pretrip")).toBe("Pre-Trip");
    expect(inspectionTypeForMode("preshift")).toBe("Pre-Shift");
  });
});
```

- [ ] **Step 2: Run** → `npx vitest run mobile/lib/inspection-checklist.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// mobile/lib/inspection-checklist.js
// UI mirror of src/lib/inspections/checklists.js (mobile cannot import src/).
// ids and labels must stay in sync with the server module — the API rejects
// any item_id outside the type's set.

export const PRE_SHIFT_CHECKLIST = [
  { id: "cabin", label: "Cabin Cleanliness & Sanitation" },
  { id: "aircon", label: "Air Conditioning & Ventilation" },
  { id: "dashboard", label: "Dashboard Warning Lights", passLabel: "NO LIGHTS", failLabel: "WARNING" },
  { id: "exterior", label: "Exterior & Basic Safety" },
  { id: "brakes", label: "Brake System & Responsiveness" },
  { id: "tires", label: "Tire Pressure & Condition" },
  { id: "fuel", label: "Fuel Level Check" },
];

export const PRE_TRIP_CHECKLIST = PRE_SHIFT_CHECKLIST.filter((item) =>
  ["dashboard", "brakes", "tires", "exterior"].includes(item.id)
);

export function checklistForMode(mode) {
  return mode === "pretrip" ? PRE_TRIP_CHECKLIST : PRE_SHIFT_CHECKLIST;
}

export function inspectionTypeForMode(mode) {
  return mode === "pretrip" ? "Pre-Trip" : "Pre-Shift";
}
```

- [ ] **Step 4: Update `mobile/lib/inspection-tour.test.js`**

Replace the local 7-item checklist const (lines 12–20) **and the comment above it** — the comment currently states the opposite intent and must not be left standing over an import:

```js
// The tour walks the QUICK pre-trip set: the map checkpoint pushes
// /inspection?tour=1, which resolves to mode "pretrip" (4 items). This used to
// be a deliberate local copy of the 7-item list, kept so "a change to the
// checklist does not silently change what these tests assert". That
// independence is traded here for the guarantee that matters more: that the
// item the tour seeds as FAIL is still IN the set the tour actually walks.
// The ids themselves stay pinned literally in inspection-checklist.test.js.
import { PRE_TRIP_CHECKLIST as CHECKLIST } from "./inspection-checklist";
```

Keep all existing assertions (keys coverage now guards the *quick* set, which is what the tour actually runs — including `QUICK_PASS_FAILED_ID = tires` ∈ checklist, which the new test in this task also locks).

- [ ] **Step 5: Run** → `npx vitest run mobile/lib/inspection-checklist.test.js mobile/lib/inspection-tour.test.js` → PASS.

- [ ] **Step 6: Commit**

(SKIPPED — user ruling: no commits.)

---

### Task 5: Dual-mode inspection screen

**Files:**
- Modify: `mobile/app/(app)/inspection.js`
- Modify: `mobile/lib/coach-marks.js:77`
- Modify: `mobile/lib/coach-marks.test.js` (assertions pinning "all 7")
- Modify: `mobile/README.md:41`

**Interfaces:**
- Consumes: Task 4 (`checklistForMode`, `inspectionTypeForMode`); existing tour helpers; Task 2 API contract.
- Produces: `/inspection` without params (or `mode=preshift`) = Pre-Shift; with `tripId` (or `tour=1`, or `mode=pretrip`) = quick Pre-Trip. Tour (`MapIntroPractice.jsx`) needs **no** URL change.

- [ ] **Step 1: Read** `mobile/app/(app)/inspection.js` fully (612 lines) — all edits below anchor to existing text.

- [ ] **Step 2: Mode derivation + shared checklist**

Replace the local `CHECKLIST` const (lines 20–28) and params (33–34) with:

```js
import { checklistForMode, inspectionTypeForMode } from "../../lib/inspection-checklist";
// ...
export default function PreShiftInspection() {
  // ...
  const { tripId, tour, mode } = useLocalSearchParams();
  const isTour = tour === "1" || tour === true;
  // Tour is the map's start-route checkpoint → quick Pre-Trip. A tripId means
  // quick Pre-Trip. Bare screen (Home "Start Your Shift") → full Pre-Shift.
  const screenMode = isTour || tripId || mode === "pretrip" ? "pretrip" : "preshift";
  const CHECKLIST = checklistForMode(screenMode);
  const inspectionType = inspectionTypeForMode(screenMode);
```

(`statuses` init already reduces over `CHECKLIST` — now mode-correct at mount. Rename local `CHECKLIST` occurrences stay valid.)

- [ ] **Step 3: Pre-Shift vehicle context**

After the existing trip-context effect (lines 56–66), add:

```js
  const [shiftVehicle, setShiftVehicle] = useState(null);
  const [shiftVehicleLoaded, setShiftVehicleLoaded] = useState(false);
  useEffect(() => {
    if (screenMode !== "preshift" || isTour) return;
    let cancelled = false;
    api.get("/api/mobile/driver/me")
      .then((me) => {
        if (cancelled) return;
        setShiftVehicle(me?.assignedVehicle ?? null);
        setShiftVehicleLoaded(true);
      })
      .catch(() => { if (!cancelled) setShiftVehicleLoaded(true); });
    return () => { cancelled = true; };
  }, [screenMode, isTour]);
```

The vehicle shown here is display-only — `/api/mobile/driver/me` resolves it server-side already (live trip first, then the current assignment), and the POST re-resolves it independently. Do not add client-side resolution beyond this read. One caveat to record where it will be read: the app's notion of "today" is device-local (see `use-pre-shift`), while the row's `inspection_date` is written server-side in UTC (`route.js:99`). East of UTC those name different days for an early shift. Nothing server-side reads `inspection_date` today, so it is display-only — do not build a gate on it without reconciling the two first.

- [ ] **Step 4: Header copy per spec §11**

Replace the heading block (lines ~198–204, anchored on `Start Your Shift`) with:

```jsx
{screenMode === "preshift" ? (
  <>
    <Text style={[type.displaySm, { color: colors.onSurface }]}>Start Your Shift</Text>
    <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>Full Vehicle Safety Check</Text>
  </>
) : (
  <>
    <Text style={[type.displaySm, { color: colors.onSurface }]}>Pre-Trip Safety Check</Text>
    <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>Quick readiness check before departure</Text>
  </>
)}
```

(Keep the screen's actual typography styles — read the existing block and preserve its style objects; only the strings are prescribed here.)

Vehicle line: Pre-Trip keeps `tripContext` plate/model; Pre-Shift shows `shiftVehicle?.plate_number` / `shiftVehicle?.model`, falling back to `"Loading vehicle…"` until `shiftVehicleLoaded`, then `"No vehicle assigned — contact dispatch"` when null.

- [ ] **Step 5: Payload + result alerts in `handleSubmit`** (lines 136–164)

```js
      const result = await api.post("/api/mobile/driver/inspections", {
        inspection_type: inspectionType,
        trip_id: screenMode === "pretrip" && tripId ? parseInt(tripId, 10) : null,
        client_submission_id: clientSubmissionId,
        items: CHECKLIST.map((item) => ({
          item_id: item.id,
          label: item.label,
          status: statuses[item.id],
          remarks: remarks[item.id] || "",
        })),
        inspected_at: new Date().toISOString(),
      });
      if (result?.queued) {
        AppAlert.alert(
          "Saved Offline",
          "Your inspection is queued and will sync when you're back online. The trip cannot start until the server receives it."
        );
        return;
      }
      const failed = CHECKLIST.filter((item) => statuses[item.id] === "FAIL");
      if (failed.length > 0) {
        const detail = failed
          .map((f) => `${f.label}: ${remarks[f.id] || ""}`)
          .join("\n");
        if (screenMode === "preshift") {
          AppAlert.alert(
            "Pre-Shift Issue Recorded",
            `Dispatch has been notified to review the vehicle.\n\n${detail}`
          );
        } else {
          AppAlert.alert(
            "Safety Issue Found",
            `Trip start is blocked until dispatch reviews the vehicle.\n\n${detail}`
          );
        }
        return;
      }
      if (screenMode === "preshift") {
        AppAlert.alert(
          "Pre-Shift Inspection Complete",
          "Vehicle baseline recorded. You're ready for your scheduled trips."
        );
      } else {
        AppAlert.alert(
          "Safety Check Passed",
          "Vehicle ready for this trip."
        );
      }
```

The "VIEW ISSUE" requirement is satisfied by the fail alert body listing each failed item + remarks (single acknowledge action, no bypass). Keep the existing back-guard, remarks-required pre-checks, coach-mark triggers, and tour early-return exactly as-is (tour block runs before the network call — unchanged).

- [ ] **Step 6: CTA label** (footer around line 443/461)

`ClayButton` label: `screenMode === "preshift" ? "COMPLETE PRE-SHIFT CHECK" : "COMPLETE PRE-TRIP CHECK"`. Disabled logic unchanged (`!allAnswered || submitting`); additionally disable Pre-Shift submit when `shiftVehicleLoaded && !shiftVehicle && !isTour`. Update the comment at line 84: `all 7 items` → `all items`.

- [ ] **Step 7: Tour modal copy** (lines 468–514): keep every string the coach-marks tests pin (`Flagged for Dispatch Review`, honest counts, `Mode: Simulation (No DB record)`); only retitle the heading to `Quick Pre-Trip Check (Simulation)` if it currently says something contradicting quick mode — check `coach-marks.test.js` expectations first and do not break them.

- [ ] **Step 8: Coach-mark copy — deferred to Task 7b**

`mobile/lib/coach-marks.js:77` is the `pretrip.complete` body, and its `"all 7 items"` is now wrong for quick mode. **Do not edit it here.** The correct fix is mode-aware (`dynamicBody`), it needs a context passed from this screen, and it is one of three coordinated edits — all of it is Task 7b. Editing the string in isolation here would produce a body that contradicts the dynamic one added later, and `dynamicBody` wins at render (`CoachMarkOverlay.jsx:535-537`), so the earlier edit would silently do nothing.

Leave `coach-marks.js` untouched in this task. **No test pins the `"all 7 items"` string** (verified — the suite asserts body text for `live_trip`, `welcome`, `offline` and `fuel` only), so this task's run stays green and the stale copy is purely a live-device defect until Task 7b lands. That is the honest reason to sequence it there rather than here: it is a copy change that needs a mode, and the mode arrives with Task 7b's context plumbing.

- [ ] **Step 9: README**

`mobile/README.md:41`: replace "Vehicle inspection snapshot (read-only)" with `"Dual-mode inspection screen: Pre-Shift (7-point baseline) and Quick Pre-Trip (4 critical items)"`.

- [ ] **Step 10: Run tests**

Run: `npx vitest run mobile/` → PASS (inspection-tour, coach-marks, inspection-checklist + all others).

- [ ] **Step 11: Commit**

(SKIPPED — user ruling: no commits.)

---

### Task 6: Pre-Shift hook + trip-detail readiness

**Files:**
- Create: `mobile/lib/use-pre-shift.js`
- Modify: `mobile/lib/trip-detail.js:37-53`
- Modify: `mobile/lib/trip-detail.test.js`
- Modify: `mobile/app/(app)/trip/[id].js` (readiness banner ~337–408, CTA ~501–543)

**Interfaces:**
- Consumes: Task 2 GET `?inspection_type=Pre-Shift`; Task 5 screen.
- Produces (Task 7): `usePreShift() → { status, inspectedAt, loaded, passed, failed, refresh }` (focus-refreshing, keeps last status on transport failure); `readinessFor(trip, nowMs, { preShiftPassed = true }) → { …, preShiftPassed, startReady, unavailableReason }` with new reason `"pre_shift"` (priority: pre_shift > schedule > window > inspection).

- [ ] **Step 1: Failing tests** — append to `mobile/lib/trip-detail.test.js`

```js
describe("readinessFor pre-shift gate", () => {
  const now = Date.now();
  const readyTrip = {
    trip_status: "Driver Accepted",
    earliest_start: new Date(now - 60_000).toISOString(),
    pre_trip_status: "Passed",
  };
  it("blocks with reason pre_shift when today's Pre-Shift is missing", () => {
    expect(readinessFor(readyTrip, now, { preShiftPassed: false }))
      .toMatchObject({ startReady: false, unavailableReason: "pre_shift", preShiftPassed: false });
  });
  it("is ready when pre-shift passed", () => {
    expect(readinessFor(readyTrip, now, { preShiftPassed: true }))
      .toMatchObject({ startReady: true, unavailableReason: null });
  });
  it("defaults preShiftPassed=true (non-breaking for existing callers)", () => {
    expect(readinessFor(readyTrip, now).startReady).toBe(true);
  });
  it("pre_shift outranks schedule", () => {
    expect(readinessFor({ trip_status: "Pending" }, now, { preShiftPassed: false }).unavailableReason)
      .toBe("pre_shift");
  });
  it("keeps window/inspection reasons when pre-shift passed", () => {
    expect(readinessFor({ ...readyTrip, earliest_start: new Date(now + 60_000).toISOString() }, now, { preShiftPassed: true }).unavailableReason).toBe("window");
    expect(readinessFor({ ...readyTrip, pre_trip_status: null }, now, { preShiftPassed: true }).unavailableReason).toBe("inspection");
  });
});
```

- [ ] **Step 2: Run** → FAIL (signature ignores options).

- [ ] **Step 3: Implement `readinessFor`**

```js
export function readinessFor(trip, nowMs, { preShiftPassed = true } = {}) {
  const earliestStart = parseMs(trip?.earliest_start);
  const recommended = parseMs(trip?.recommended_departure);
  const preTripPassed = trip?.pre_trip_status === "Passed";
  const windowOpen = earliestStart != null && nowMs >= earliestStart;
  const startReady = windowOpen && preTripPassed && preShiftPassed;
  const minsToStart = earliestStart != null
    ? Math.max(0, Math.ceil((earliestStart - nowMs) / 60000))
    : null;
  let unavailableReason = null;
  if (!startReady) {
    if (!preShiftPassed) unavailableReason = "pre_shift";
    else if (earliestStart == null) unavailableReason = "schedule";
    else if (!windowOpen) unavailableReason = "window";
    else unavailableReason = "inspection";
  }
  return { earliestStart, recommended, windowOpen, preTripPassed, preShiftPassed, startReady, minsToStart, unavailableReason };
}
```

- [ ] **Step 4: Implement `mobile/lib/use-pre-shift.js`**

```js
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "./api";

// Today's Pre-Shift status for this driver (local calendar day, newest-first
// feed). Transport failure keeps the last known status — offline must not
// erase a passed baseline. Server remains the trip-start authority; this only
// drives UI flow.
export function usePreShift() {
  const [state, setState] = useState({ status: null, inspectedAt: null, loaded: false });

  const refresh = useCallback(async () => {
    try {
      const rows = await api.get("/api/mobile/driver/inspections?inspection_type=Pre-Shift");
      const list = Array.isArray(rows) ? rows : [];
      const today = new Date().toDateString();
      const row = list.find((r) => r?.created_at && new Date(r.created_at).toDateString() === today);
      setState({ status: row?.status ?? null, inspectedAt: row?.created_at ?? null, loaded: true });
    } catch {
      setState((prev) => ({ ...prev, loaded: true }));
    }
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  return {
    ...state,
    passed: state.status === "Passed",
    failed: state.status === "Failed",
    refresh,
  };
}
```

- [ ] **Step 5: Run tests** → `npx vitest run mobile/lib/trip-detail.test.js` → PASS.

- [ ] **Step 6: Wire `trip/[id].js`**

1. `import { usePreShift } from "../../../lib/use-pre-shift";`
2. In the component: `const preShift = usePreShift();`
3. Readiness call: `const ready = readinessFor(trip, nowMs, { preShiftPassed: preShift.passed });` (find existing `readinessFor(trip, now)` call ~line 266 region).
4. Readiness banner (~356–408): add a `pre_shift` branch before the existing pre-trip lines:

```jsx
{ready.unavailableReason === "pre_shift" ? (
  <>
    <Text style={[type.label, { color: colors.onSurface }]}>PRE-SHIFT CHECK</Text>
    <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>
      Not completed today. Start your shift with the full vehicle safety check before any trip.
    </Text>
  </>
) : ( /* existing pretrip_requirement Target block, with copy updated to:
        "Pre-trip safety check must be completed before departure.
         The start button unlocks once safety is confirmed." */ )}
```

Keep `CoachMarkTarget` ids `trip.readiness`, `trip.pretrip_requirement`, `trip.primary_action` exactly.

5. CTA block (~501–543) — replace label/disabled/onPress:

```js
const ctaLabel = ready.startReady
  ? (isAccepted ? "START ROUTE" : "ACCEPT & START")
  : ready.unavailableReason === "pre_shift"
    ? "START YOUR SHIFT"
    : ready.unavailableReason === "inspection"
      ? "PRE-TRIP CHECK"
      : ready.unavailableReason === "window"
        ? `START ROUTE IN ${ready.minsToStart} MIN`
        : "START NOT YET SCHEDULED";
const ctaNavigates =
  ready.unavailableReason === "pre_shift" || ready.unavailableReason === "inspection";
const ctaDisabled = accepting || !(ready.startReady || ctaNavigates);
// onPress:
const handlePrimary = () => {
  if (ready.unavailableReason === "pre_shift") {
    router.push({ pathname: "/inspection", params: { mode: "preshift" } });
    return;
  }
  if (ready.unavailableReason === "inspection") {
    router.push({ pathname: "/inspection", params: { tripId: String(id) } });
    return;
  }
  handleAcceptStart();
};
```

Button `backgroundColor`: navigable states use `colors.primary` (they are real actions), keep disabled styling for window/schedule. Keep the existing error-alert → inspection path (lines 191–196) untouched.

- [ ] **Step 7: Run tests** → `npx vitest run mobile/` → PASS.

- [ ] **Step 8: Commit**

(SKIPPED — user ruling: no commits.)

---

### Task 7: Home flow + trips chip

**Files:**
- Modify: `mobile/lib/home-trips.js:21-26`
- Modify: `mobile/lib/home-trips.test.js`
- Modify: `mobile/lib/trips-queue.js` + `mobile/lib/trips-queue.test.js`
- Modify: `mobile/components/home/DriverHomeCards.jsx:190,205`
- Modify: `mobile/app/(app)/(tabs)/index.js`
- Modify: `mobile/app/(app)/(tabs)/trips.js`

**Interfaces:**
- Consumes: Task 6 `usePreShift()`.
- Produces: Home banner states per spec §22; `homeTripAction(trip, nowMs, { preShiftPassed })`; `preTripChipLabel(status)`.

- [ ] **Step 1: Failing tests**

Append to `mobile/lib/home-trips.test.js`:

```js
describe("homeTripAction pre-shift gate", () => {
  const opens = Date.parse("2026-09-23T08:00:00Z");
  const trip = {
    trip_status: "Driver Accepted",
    earliest_start: "2026-09-23T07:00:00Z",
    pre_trip_status: "Passed",
  };
  it("hides Start Trip until today's Pre-Shift passed", () => {
    expect(homeTripAction(trip, opens, { preShiftPassed: false })).toBe("Trip Details");
    expect(homeTripAction(trip, opens, { preShiftPassed: true })).toBe("Start Trip");
    expect(homeTripAction(trip, opens)).toBe("Start Trip"); // default non-breaking
  });
  it("active trips unaffected", () => {
    expect(homeTripAction({ trip_status: "En Route" }, opens, { preShiftPassed: false })).toBe("Continue Trip");
  });
});
```

Append to `mobile/lib/trips-queue.test.js`:

```js
import { preTripChipLabel } from "./trips-queue"; // merge with existing import
describe("preTripChipLabel", () => {
  it("maps the three feed states", () => {
    expect(preTripChipLabel(null)).toBe("Pre-Trip: Pending");
    expect(preTripChipLabel(undefined)).toBe("Pre-Trip: Pending");
    expect(preTripChipLabel("Passed")).toBe("Pre-Trip: Passed");
    expect(preTripChipLabel("Failed")).toBe("Pre-Trip: Failed");
  });
});
```

- [ ] **Step 2: Run** → FAIL (neither export exists / signature unchanged).

- [ ] **Step 3: Implement libs**

`home-trips.js` line 21–26 →

```js
export function homeTripAction(trip, nowMs, { preShiftPassed = true } = {}) {
  const preStart = ['Pending', 'Approved', 'Assigned', 'Vehicle Assigned', 'Driver Assigned', 'Dispatched', 'Driver Accepted'].includes(trip?.trip_status);
  const earliest = trip?.earliest_start ? new Date(trip.earliest_start).getTime() : NaN;
  if (preStart && !preShiftPassed) return 'Trip Details';
  if (preStart && !(Number.isFinite(earliest) && nowMs >= earliest && trip.pre_trip_status === 'Passed')) return 'Trip Details';
  return preStart ? 'Start Trip' : 'Continue Trip';
}
```

`trips-queue.js` — append:

```js
export function preTripChipLabel(status) {
  if (status === "Passed") return "Pre-Trip: Passed";
  if (status === "Failed") return "Pre-Trip: Failed";
  return "Pre-Trip: Pending";
}
```

- [ ] **Step 4: `DriverHomeCards.jsx`**

Line 190 signature: add `preShiftPassed = true` to the destructured props. Line 205:

```js
const action = trip ? homeTripAction(trip, nowMs, { preShiftPassed }) : null;
```

- [ ] **Step 5: `index.js` wiring**

1. `import { usePreShift } from "../../../lib/use-pre-shift";` and call `const preShift = usePreShift();` with the screen's other hooks.
2. Start-Shift banner — render after the `HomeHeader` invocation (~line 424) and before the error/dead-letter banners (~444):

```jsx
{preShift.loaded && !preShift.passed ? (
  <ClayCard variant="standard" style={{ marginBottom: 12 }}>
    <Text style={[type.cardTitle, { color: colors.onSurface }]}>
      {preShift.failed ? "Pre-Shift Failed" : "Start Your Shift"}
    </Text>
    <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>
      {preShift.failed
        ? "Dispatch has been notified to review the vehicle. You can retake the check after review."
        : "Full Vehicle Safety Check — required once before your first trip."}
    </Text>
    <ClayButton
      label={preShift.failed ? "RETAKE PRE-SHIFT CHECK" : "START PRE-SHIFT CHECK"}
      onPress={() => router.push({ pathname: "/inspection", params: { mode: "preshift" } })}
    />
  </ClayCard>
) : preShift.passed ? (
  <Text style={[type.caption, { color: colors.onSurfaceVariant, marginBottom: 8 }]}>
    Pre-Shift: Passed · {new Date(preShift.inspectedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
  </Text>
) : null}
```

(Import `ClayCard`/`ClayButton` if this file doesn't already — check imports first; the screen uses existing clay components elsewhere.)

3. Thread the prop: grep `DriverTripCard` in `index.js` and add `preShiftPassed={preShift.passed}` to **every** call site.
4. Gate the accept+start shortcut at line 300: `if (isPreStartTrip && nextObj.action === "accept" && trip.pre_trip_status === "Passed" && preShift.passed)`, and add `preShift.passed` to that `useCallback` dependency array (line 317).

- [ ] **Step 6: `trips.js` chip**

Import `PRE_START, preTripChipLabel` from `../../../lib/trips-queue` (extend the existing line 21 import). In `TripCard` header (line 49–54), after the departure `Text`:

```jsx
{PRE_START.includes(trip.trip_status) ? (
  <Text style={[type.caption, { color: trip.pre_trip_status === "Failed" ? colors.danger : colors.onSurfaceVariant }]}>
    {preTripChipLabel(trip.pre_trip_status)}
  </Text>
) : null}
```

(Pre-start trips only — Completed rows have no `pre_trip_status` and no chip. No gating change: cards stay tappable; detail owns enforcement — matches `trips-queue.test.js:40-44` doctrine.)

- [ ] **Step 7: Run tests**

Run: `npx vitest run mobile/` → PASS (home-trips, trips-queue + full mobile suite).

- [ ] **Step 8: Commit**

(SKIPPED — user ruling: no commits.)

---

### Task 7b: Coach marks — Guide-1 copy for two types, plus the Start-Shift button

**Files:**
- Modify: `mobile/lib/coach-marks.js`
- Modify: `mobile/lib/coach-marks.test.js`
- Modify: `mobile/app/(app)/inspection.js` (pass mode context — no new targets)
- Modify: `mobile/app/(app)/trip/[id].js` (pass readiness context — no new targets)
- Modify: `mobile/app/(app)/(tabs)/index.js` (trigger + wrap the banner button)

**Interfaces:**
- Consumes: `screenMode` / `CHECKLIST` (Task 5), `ready.unavailableReason` (Task 6), `preShift` (Tasks 6–7).
- Produces: `triggerMilestone(key, context)` gains its second argument at three call sites. `CoachMarkOverlay.jsx:535-537` already reads it (`typeof step.dynamicBody === "function" ? step.dynamicBody(stepContext) : step.body`), so **`dynamicBody` wins over `body`** when present.

**Binding doctrine** — `Capstone/02 - Features/Driver In-App Guide.md`. §3: "Six Core Operational Guides" — exactly six, no seventh; anything here is a milestone *inside* Guide 1 (Pre-Trip Inspection), not a new guide. §9: one coach mark = one exact target, "never entire screens or parent cards". §7 Rule 3: SOS, Start Trip, Complete Inspection, submit controls and the progression swipe must never become tutorial-required. §7 Rule 5: one guide at a time — a refused trigger stays incomplete and returns on its own. §7 Rule 4: a guide never mutates production state.

> **Verified against the suite before writing this task** (`coach-marks.test.js` asserts against *source text*, so these are hard constraints, not style): `observe` is a legal mode (`:198` allows `passthrough|observe|blocked`); `trip_readiness.steps[2]` is pinned as `blocked` + `actionText: "Got it"` (`:214-218`); `pretrip_complete.steps[0]` is pinned as `passthrough` + `"Got it"` + `requiresInteraction === undefined` (`:238-242`); the domain test (`:47-65`) asserts milestone **names**, not a count, so adding one is safe; the target-registry tests run against a *simulated* registry, so no real targetId needs to exist for them; and **no test reads `(tabs)/index.js`** at all.

- [ ] **Step 1: Correct the two Guide-1 bodies that the two-type model makes untrue**

Both steps live on `/inspection` and are present in **both** modes, so this is mode-aware copy via `dynamicBody` — **not** new milestones, new targets, or a new storage key. Keep each step's `title`, `actionText`, `canSkip` and `interaction` exactly as they are.

```js
// pretrip.pass_fail — body stays as the per-trip variant (the no-context fallback)
body: "Work down the list and choose PASS for each item that is safe, or FAIL for one you find a problem with. Marking FAIL asks you to describe the issue, so dispatch knows what needs attention.",
dynamicBody: (ctx) =>
  ctx?.mode === "preshift"
    ? "Work down the list and choose PASS for each item that is safe, or FAIL for one you find a problem with. This is your once-a-day baseline — each trip still needs its own quick check before departure."
    : "Work down the list and choose PASS for each item that is safe, or FAIL for one you find a problem with. Marking FAIL asks you to describe the issue, so dispatch knows what needs attention.",
```

```js
// pretrip_complete — the count is the part that is now wrong. Body loses it.
body: "Tap here once every item is checked. You must complete this check before the trip can start.",
dynamicBody: (ctx) =>
  ctx?.total
    ? `Tap here once all ${ctx.total} items are checked. You must complete this check before the trip can start.`
    : "Tap here once every item is checked. You must complete this check before the trip can start.",
```

`pretrip.remarks` needs no change — its copy was already mode-neutral.

**The count is passed in, never hardcoded in the copy.** The screen already knows `CHECKLIST.length` for the mode it is rendering; hardcoding `7`/`4` here recreates this exact bug the next time a checklist changes.

- [ ] **Step 2: Actually pass the context — the easy part to skip**

`triggerMilestone(milestoneKey, context = null)` (`CoachMarkProvider.jsx:610`) stores the context; the overlay reads it per step. Both call sites in `inspection.js` currently pass **nothing**, so a `dynamicBody` added without this step is unreachable.

```js
  // A primitive, not CHECKLIST.length inline: it is a genuine effect dependency
  // and a number keeps the dep array stable across renders.
  const checklistTotal = CHECKLIST.length;

  useEffect(() => {
    triggerMilestone("pretrip", { mode: screenMode, total: checklistTotal });
  }, [triggerMilestone, screenMode, checklistTotal]);

  useEffect(() => {
    if (allAnswered && !activeMilestone) {
      triggerMilestone("pretrip_complete", { mode: screenMode, total: checklistTotal });
    }
  }, [allAnswered, activeMilestone, triggerMilestone, screenMode, checklistTotal]);
```

**Two assertions in `coach-marks.test.js` pin these exact strings and will fail — update them, deliberately:**

```js
// :1167 — before: toContain('triggerMilestone("pretrip_complete")')
expect(inspectScreen).toContain('triggerMilestone("pretrip_complete", {');
// :1169 — before: toContain("[allAnswered, activeMilestone, triggerMilestone]")
expect(inspectScreen).toContain("[allAnswered, activeMilestone, triggerMilestone, screenMode, checklistTotal]");
```

Keep `triggerMilestone` and `activeMilestone` in both. That test's stated purpose is that the tip **re-fires once the blocking guide dismisses**, and those two dependencies are what carry it — the added pair is additive. An edit that drops either one to make the string match would delete the behaviour the test exists to protect. (`screenMode` is a real dependency: the effect body reads it, and `exhaustive-deps` will say so.)

> **This trap is already sprung once in this codebase.** `trip.primary_action`'s `dynamicBody` branches on `ctx?.isContinue` (`coach-marks.js:121-124`), but no call site has ever passed a context — `trip/[id].js:163` calls `triggerMilestone("trip_readiness")` bare. **That branch has never rendered.** After each edit here, confirm the value reaches the step rather than trusting that it does.

- [ ] **Step 3: The trip-detail CTA now does two different things — say which**

Task 6 turns the primary CTA from "start the trip" into "navigate to the baseline check" when `unavailableReason === "pre_shift"`. Step 3's copy promises the button starts a trip, which is false in exactly the state this feature adds. Add a third branch and pass the reason:

```js
        dynamicBody: (ctx) =>
          ctx?.isContinue
            ? "Once the trip is active, Continue to Map only returns you to the live trip and navigation."
            : ctx?.reason === "pre_shift"
              ? "START YOUR SHIFT opens the full vehicle safety check. Complete it once today and this button becomes the start control for your trips."
              : "Start Trip begins the trip when readiness and inspection requirements are satisfied.",
```

`mobile/app/(app)/trip/[id].js:163`:
```js
    triggerMilestone("trip_readiness", {
      isContinue: action === "navigate",
      reason: ready.unavailableReason,
    });
```
`ready` is computed at line 266, below this effect. **Read it through a ref — do not hoist it into the dependency array:**

```js
  const readyRef = useRef(ready);
  readyRef.current = ready;
```
…then `reason: readyRef.current.unavailableReason` in the trigger.

Two reasons this must be a ref rather than a dep. `readinessFor` returns a **fresh object every render**, so depending on `ready` would re-run the effect on every render instead of only when the guide state actually changes. And `coach-marks.test.js:1035` pins the dependency array as an exact string — `[loading, trip, isTerminal, isPreStart, activeMilestone, triggerMilestone]` — so adding to it needs its own deliberate update, which a ref avoids entirely.

**The one assertion that does change** (`:1021`):
```js
// before: toContain('triggerMilestone("trip_readiness")')
expect(tripScreen).toContain('triggerMilestone("trip_readiness", {');
```

Keep the effect's existing guards and its `activeMilestone` dependency (`:1033-1036`): they are what makes a refused trigger retry after a blocking guide dismisses, and the guard string at `:1020` is pinned too — leave that line untouched.

**Keep `interaction: "blocked"` and `canSkip: false` on this step.** Rule 3 lists Start Trip as protected, and this is the same button — it still starts a trip in the `startReady` state. That it *navigates* in one state does not make it safe to fire by accident; blocking costs one extra tap in the `pre_shift` state and keeps the guarantee in the others.

Also update step 2 (`trip.pretrip_requirement`), which is the line that states the requirement and there are now two of them:
> "Complete the pre-shift vehicle safety check once a day, then the quick pre-trip check for each trip. The start button unlocks once safety is confirmed."

- [ ] **Step 4: One new milestone for the Start-Shift button**

The only genuinely new control the feature adds, and missing it is a dead end: a driver who never notices the banner sees every trip CTA read "START YOUR SHIFT" with nothing explaining why.

```js
  PRESHIFT_INTRO: {
    key: "preshift",
    version: 1,
    route: "/",
    steps: [
      {
        id: "preshift.start",
        targetId: "home.preshift_start",
        title: "Start with the vehicle check",
        body: "Complete the full vehicle safety check once a day, before your first trip. Each trip afterwards still needs its own quick pre-trip check — this one does not count for a trip.",
        actionText: "Got it",
        canSkip: true,
        interaction: "observe",
      },
    ],
  },
```

- **`observe`, not `passthrough`/`blocked`.** The driver's next act is to read, then tap the real button. The guide explains; it does not ask for a tap on anything (same reasoning as `map.intro.controls`).
- **No `requiresInteraction`** — Rule 3.
- **Target the button, not the card.** §9 forbids spotlighting a parent card, so `CoachMarkTarget` wraps the `ClayButton` alone.

`mobile/app/(app)/(tabs)/index.js` — alongside the existing `welcome` trigger at `:108-113`, same `useFocusEffect` + guard shape:

```js
  // Guide 1's Home entry point. The banner renders only while today's Pre-Shift
  // is outstanding, so this milestone has a deadline of its own. Rule 5 does the
  // rest: a refusal while another guide is on screen leaves it incomplete and it
  // returns on the next focus — do not add a retry loop that fights the provider.
  useFocusEffect(
    useCallback(() => {
      if (preShift.loaded && !preShift.passed) triggerMilestone("preshift");
    }, [preShift.loaded, preShift.passed, triggerMilestone])
  );
```

Wrap the banner's button (Task 7 Step 5):
```jsx
<CoachMarkTarget id="home.preshift_start" targetId="home.preshift_start" radius={14} scrollRef={scrollRef}>
  <ClayButton
    label={preShift.failed ? "RETAKE PRE-SHIFT CHECK" : "START PRE-SHIFT CHECK"}
    onPress={() => router.push({ pathname: "/inspection", params: { mode: "preshift" } })}
  />
</CoachMarkTarget>
```

Import `CoachMarkTarget` from the same path this file already imports the provider from (`:29`). The banner sits inside the scroll container — §9's ScrollView criterion lists which targets need `scrollRef`, and a target below the fold that never measures presents nothing (the §3.7.8 failure mode, where the gate reports nothing and the tooltip is simply absent).

- [ ] **Step 5: Deliberately not covered — record these as decisions, not omissions**

- **The Trips-list "Pre-Trip: Pending / Passed / Failed" chip** (Task 7 Step 6) — a passive status label. §9's one-target rule needs a control to wrap and there is nothing here for the driver to do; teaching it is "guidance everywhere".
- **The Home "Pre-Shift: Passed · hh:mm" caption** — same.
- **The inspection screen's new mode header** — a heading. Excluded by the same "never parent cards" criterion.

- [ ] **Step 6: Tests**

Append to `mobile/lib/coach-marks.test.js`:

```js
import { readFile } from "node:fs/promises"; // follow whatever this file already uses for source-text reads

describe("preshift milestone", () => {
  it("is a single observe step on the start button, inside Guide 1", () => {
    const m = getMilestoneConfig("preshift");
    expect(m).toMatchObject({ key: "preshift", version: 1, route: "/" });
    expect(m.steps).toHaveLength(1);
    expect(m.steps[0]).toMatchObject({
      id: "preshift.start",
      targetId: "home.preshift_start",
      interaction: "observe",
      canSkip: true,
      actionText: "Got it",
    });
    // Rule 3: a protected action must never be tutorial-required.
    expect(m.steps[0].requiresInteraction).toBeFalsy();
  });

  it("mode-aware bodies answer the mode they are given", () => {
    const passFail = getMilestoneConfig("pretrip").steps[0];
    expect(passFail.dynamicBody({ mode: "preshift" })).toMatch(/once-a-day baseline/);
    expect(passFail.dynamicBody({ mode: "pretrip" })).toMatch(/Marking FAIL asks you/);

    const complete = getMilestoneConfig("pretrip_complete").steps[0];
    expect(complete.dynamicBody({ mode: "preshift", total: 7 })).toContain("all 7 items");
    expect(complete.dynamicBody({ mode: "pretrip", total: 4 })).toContain("all 4 items");
    // No context must still produce a true sentence, never "all undefined items".
    expect(complete.dynamicBody(null)).toMatch(/every item is checked/);
  });

  it("the primary-action body names the pre-shift state", () => {
    const step = getMilestoneConfig("trip_readiness").steps[2];
    expect(step.dynamicBody({ reason: "pre_shift" })).toMatch(/full vehicle safety check/i);
    expect(step.dynamicBody({ reason: "inspection" })).toMatch(/Start Trip begins/);
    expect(step.dynamicBody({ isContinue: true })).toMatch(/Continue to Map/);
  });

  it("no step still hardcodes the seven-item checklist", async () => {
    // The regression this task exists for: "all 7 items" was true only while
    // there was one inspection type.
    const src = await readFile(new URL("./coach-marks.js", import.meta.url), "utf8");
    expect(src).not.toContain("all 7 items");
  });
});
```

Then `npx vitest run mobile/lib/coach-marks.test.js` and **reconcile — do not just make it green.** This suite asserts against *source text of other files*, so the failures are enumerated exactly. Here is what to expect, from reading it:

**Exactly three existing assertions break, all of them the pinned strings called out in Steps 2 and 3** — `:1021`, `:1167`, `:1169`. Nothing else should. Update each to the exact new string given above and confirm the two dependency-array assertions keep `triggerMilestone` and `activeMilestone`; those are the behaviour, the string is only how it is checked.

**What does *not* break — do not "fix" these:**
- **No test pins the copy being changed.** `"all 7 items"` appears nowhere in the suite. The only body-text assertions are `live_trip` step 1 (`:111-112`), the verbatim §2/§3.6 quotes on `welcome`/`offline` (`:634-648`), and three fuel bodies (`:1300-1316`) — all untouched by this task. So the new `dynamicBody` copy needs tests of its own (above), not edits to old ones.
- **The domain test does not count milestones.** `:47-65` asserts `COACH_MARK_MILESTONES.WELCOME` … `.OFFLINE` are defined and that `COMPLETION`/`MASCOT` are not. Adding `PRESHIFT_INTRO` needs no edit there. (Its *title* says "7 core contextual guide domains" while the vault §3 says six and the test body lists thirteen milestones — pre-existing inconsistency, not yours to resolve here.)
- **`observe` is valid** — `:198` allows `passthrough|observe|blocked`, so the new step passes `:197`. It is not covered by `:207` (protected) or `:245` (safe-interactive), both of which enumerate specific milestones.
- **No target-existence requirement.** The registry tests (`:281-554`) drive a *simulated* registry built in the test file, so a `targetId` with no mounted component is invisible to them.
- **`(tabs)/index.js` is never read** by the suite, so the new target and trigger there are unconstrained — the risk with that file is runtime (an unmeasured target presents nothing), which Step 4's `scrollRef` and Task 9's manual list cover.

If a failure appears outside that list, stop and read it — it means something in this analysis is wrong, which is more important to learn than to patch around.

- [ ] **Step 7: Decide the version question against the storage model, don't guess**

`getCoachMarkStorageKey(key, version)` yields `fleetops.guide.<key>.v<version>_<driverId>` (guide §6), so a bump is a **new key** that re-shows the tip to drivers who already dismissed it.

Applying that: `pretrip_complete`'s copy changes in Step 1, but the *lesson* does not, and only a driver who has not yet completed it can meet the wrong count — and that driver gets the new code. **Do not bump `pretrip` or `pretrip_complete`.** Bump only when drivers who already completed a milestone would otherwise be missing something they now need, which is not the case here. `preshift` is a new key at version 1 by construction.

Record the outcome either way in the vault's Version Keys Table (Task 10).

- [ ] **Step 8: Run tests**

Run: `npx vitest run mobile/` → PASS, then `npm run lint`.

- [ ] **Step 9: Commit**

(SKIPPED — user ruling: no commits.)

---

### Task 8: Driver portal inspection display verification

**Files:**
- Verify/Modify: `src/app/(dashboard)/driver/vehicle/page.js`, `src/app/(dashboard)/driver/page.js`

**Interfaces:**
- Consumes: rows from Task 2 (either type; Pre-Trip checklist has 4 entries).

- [ ] **Step 1: Read** both pages' inspection rendering (`src/app/api/driver/vehicle-inspection/route.js` feeds them; it returns latest row regardless of type — fine).

- [ ] **Step 2: Fix assumptions** — if either page hardcodes 7 items, a fixed checklist item list, or omits `inspection_type`, update it to: derive item count from `checklist.length` and display `inspection_type` as a label (`"Pre-Shift · 7 items"` / `"Pre-Trip · 4 items"`). If it already reads `checklist`/`inspection_type` dynamically, no change — record that in the task notes. While there, confirm a `severity = 'High'` row is not rendered as anything ground-like ("grounded", "out of service"): no inspection flips `vehicle_status`, an inspection High is a dispatch notification, and a portal that implies otherwise is the one place a reader could conclude the vehicle was pulled from service.

- [ ] **Step 3: Run** `npm run lint` → clean for touched files.

- [ ] **Step 4: Commit**

(SKIPPED — user ruling: no commits. Only commit if modified — but commits are globally skipped.)

---

### Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite**

Run: `npm run test:run`
Expected: all PASS (includes server + mobile suites: checklists, inspections route, start gate, trip-detail, home-trips, trips-queue, coach-marks, inspection-tour, plus every untouched suite).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual flow checklist** (dev server + Expo — evidence for the final report)

```text
✓ Home without today's Pre-Shift → banner; CTA opens 7-item "Start Your Shift"
✓ Submit Pre-Shift → "Pre-Shift Inspection Complete"; chip "Pre-Shift: Passed · hh:mm"
✓ Trip detail pre-trip missing → CTA "PRE-TRIP CHECK" navigates; 4 items shown
✓ Submit quick FAIL (brakes + remarks) → "Safety Issue Found"; dispatch notification row created
✓ Trip start API → 400 while Failed/missing; PASS quick check → start proceeds (existing gates)
✓ Trip 2 → fresh quick check required (pre_trip_status null → Pending chip)
✓ Pre-Shift row never appears in pre_trip_status / gate (trip_id NULL + type filter)
✓ Offline: airplane mode submit → "Saved Offline"; queue replays once; no duplicate (idempotency)
✓ Tour: map checkpoint opens quick mode; milestones still fire; coach tests green
✓ Coach marks, Home: on the first render of the Start-Shift banner the tip presents **over the button, not the card**, and reads the baseline copy; if another guide is on screen it is refused and returns on the next focus rather than being consumed
✓ Coach marks, inspection screen: the same screen shows different copy per mode — "once-a-day baseline" in Pre-Shift, "Marking FAIL…" in Pre-Trip. Open both from the same driver and confirm the two differ; identical copy means the context never arrived
✓ Coach marks, trip detail: in the `pre_shift` state the primary-action tip says START YOUR SHIFT opens the check, **not** that it starts the trip; after the baseline passes it says "Start Trip begins the trip…"
✓ Coach marks, reset: Profile → Help & Support → Reset In-App Tips brings back the `preshift` tip and all three copy variants
✓ Coach marks, driving lock: with speed above 10 km/h the new tip neither presents nor stays on screen
```

- [ ] **Step 4: No commit needed** (nothing changed) — if manual pass surfaces fixes, apply them but DO NOT COMMIT (user ruling).

---

### Task 10: Capstone vault + SYSTEM.md sync

**Files:**
- Modify: `Capstone/02 - Features/Trips.md`
- Modify: `Capstone/02 - Features/Driver In-App Guide.md`
- Modify: `Capstone/02 - Features/Maintenance.md`
- Modify: `SYSTEM.md`

- [ ] **Step 1: `Capstone/02 - Features/Trips.md`**

- Gate section (L26–38): state the gate requires a **Quick Pre-Trip** row (`inspection_type = 'Pre-Trip'`, same `trip_id`) — Pre-Shift baseline rows (`trip_id IS NULL`) can never satisfy it.
- **Record the Pre-Shift residual as a known gap, not as "UI-only" prose.** The server enforces the per-trip quick Pre-Trip alone; nothing server-side requires a baseline. A driver who never opens the bare inspection screen can start every trip without one, and no row records the omission. Write it the way Maintenance.md records the optional four-eyes gate — so a reader months later knows the backend will not catch this, rather than inferring from "UI-only" that it is merely where the prompt is shown.
- L40 "Not wired" line: unchanged for predictive maintenance; **add** FAIL-item policy is now partially wired: all 4 quick items are hard-block items; Pre-Shift failures are severity-classified (`High` critical / `Medium` non-critical) notifications only — never auto-grounding.
- Mobile start-gating section (L42–51): add the Pre-Shift UI layer — Home banner + `homeTripAction`/`readinessFor` `pre_shift` reason are **UI-only** (server authority unchanged); `pre_trip_status` now sourced from `inspection_type='Pre-Trip'` rows only.
- Flow diagram (L63–64): insert `PRE-SHIFT (7 items, daily, no trip)` before `PRE-TRIP (4 critical items, per trip)`.

- [ ] **Step 2: `Capstone/02 - Features/Driver In-App Guide.md`**

- §3.1: retitle **Pre-Shift Inspection (HIGH)** — full 7-point baseline, opened bare from Home; copy no longer says every trip repeats 7 items; keep all three milestone rules (passthrough complete, remarks-on-FAIL, no forced FAIL, no submit-to-finish).
- Add §3.1b **Quick Pre-Trip (HIGH)**: 4 critical items (dashboard/brakes/tires/exterior), trip-scoped, tour runs this mode (map checkpoint), CTA `COMPLETE PRE-TRIP CHECK`.
- §3.2: update `trip.pretrip_requirement` body quote to the new wording; note new `pre_shift` CTA state (`START YOUR SHIFT`).
- §3.7.5: unchanged behavior; note the checkpoint now teaches the quick check.
- **Coach-mark copy (Task 7b) — this doc is the spec for it, so the quotes here are the source of truth and must be updated in the same pass:**
  - §3.1's `inspection.complete` copy quote is the `"all 7 items"` line; it is now mode-aware. Record that the count is supplied by the screen (`{ mode, total }`) and that `body` is the no-context fallback — the doc should not quote a fixed number for a two-type checklist.
  - §3.1's `inspection.pass_fail` copy gains the baseline variant; note the `dynamicBody`/`body` precedence so the next reader knows which one a device will show.
  - §3.2 step 3: record the third `dynamicBody` branch for the `pre_shift` CTA state, and that `trip.primary_action` stays `blocked` because the same button still starts a trip in its other states.
  - **§6 Version Keys Table: add `preshift` (`fleetops.guide.preshift.v1_{driverId}`, version 1) under Guide 1**, and state explicitly that `pretrip` / `pretrip_complete` are **not** bumped (see Task 7b Step 7 for why). Also note the table is now the only place the `preshift` key is enumerated.
  - §5 target registry / §9 acceptance list: add `home.preshift_start`, and add a criterion that the new milestone is `observe` with no `requiresInteraction` — Rule 3 is the reason, and it is the property most likely to be edited away later.
  - Note the three `triggerMilestone(key, ctx)` call sites fixed in Task 7b, and that `trip.primary_action`'s `isContinue` branch had been dead since it was written — the reason the doc should state that a `dynamicBody` needs a context at its trigger, not just a branch.
  - **Do not re-litigate the guide count.** A clarifying line was added under the §3 heading on 2026-09-23 stating the position the doc already held: the six operational areas are §3.1–§3.6, and §3.7 is the walkthrough that sequences them, not a seventh area. Leave it in place.

**Deferred by the user (2026-09-23) — remind them, do not do it unasked:**
- `mobile/lib/coach-marks.test.js:47` still reads *"defines the approved 7 **core contextual guide domains**"* while the vault now settles on six. It is a test **title** only — the body asserts milestone names, so nothing depends on it — but it is the last surviving "7" and the thing most likely to re-open the question. Aligning the word to "six" is a one-line edit with no behaviour change.
- The structural alternative was considered and **rejected as too expensive**: renumbering §3.7 → §4 would shift §4–§11 and invalidate every `§n` cross-reference in the vault, including `§3.7.8` which §3.7's own body cites. Only revisit if the walkthrough ever becomes a genuine seventh domain.

- [ ] **Step 3: `Capstone/02 - Features/Maintenance.md`**

In the predictive/gating area, add: *"Inspection failures (Pre-Trip quick / Pre-Shift) create severity-classified findings + dispatch notifications only — `vehicle_status` is never flipped by an inspection; grounding stays with the incident/maintenance flow (`src/lib/incidents/grounding.js`). Repeated findings are recorded in `vehicleinspection.checklist` for a future condition-signal wiring (not yet wired — see Trips.md)."*

- [ ] **Step 4: `SYSTEM.md`**

- Route inventory entry for `/api/mobile/driver/inspections`: note type-aware POST (Pre-Shift/Pre-Trip) + `?inspection_type=` GET filter.
- §12.6 per-trip gate description: note `inspection_type = 'Pre-Trip'` filter.
- Migration ledger: **no new migration** — add a one-line note under 048/060 that the two-type model landed app-side only (no schema change).
- Note the new shared module: `src/lib/trips/status-groups.js` now owns `PRE_START_TRIP_STATUSES` / `LIVE_TRIP_STATUSES`, and `me/route.js` imports the live list instead of inlining it. Flag that `trips/route.js`'s `STATUS_GROUPS.pending`, `mobile/lib/trips-queue.js`'s `PRE_START`/`IN_PROGRESS` and the seed scripts still carry their own copies — a deliberate deferral, not an oversight, and the trip_status CHECK in migration 012 remains the authority.

- [ ] **Step 5: Commit**

(SKIPPED — user ruling: no commits.)

---

## Deviations recorded during implementation (2026-09-23)

Four places where the code as built differs from the text above. Each was a deliberate call, not a shortcut; the plan text above is left as written so the difference is visible.

1. **`status-groups.js` exports `DRIVER_ACTIVE_TRIP_STATUSES`, not `LIVE_TRIP_STATUSES`** (Task 2 Step 3, and the Task 10 Step 4 note). `src/lib/constants.js:152` already exports `LIVE_TRIP_STATUSES` with **9** entries that **include `Dispatched`** — it answers "does this trip appear on the live map / have GPS?". The list this plan needs is 8 entries starting at `Driver Accepted` ("is this the trip the driver is working?"). Reusing the name would have silently widened the Pre-Shift vehicle-resolution query by one status and made two different questions share one identifier. The module carries a comment explaining the difference, and SYSTEM.md §3 records it.

2. **`use-pre-shift.js` keeps `loaded: false` when the fetch fails** — the plan's snippet set `loaded: true`. The plan's body computed `passed: state.status === "Passed"`, which is `false` when `status` is `null`; combined with `loaded: true` that made "unknown" render as "outstanding", so the CTA falsely claimed the baseline was missing before the first response and **a cold start with no network blocked the driver permanently** — the opposite of the plan's own stated intent that offline must not erase a passed baseline. Fixed by leaving `loaded` false on failure and passing `preShiftPassed: preShift.loaded ? preShift.passed : true` at the call site.

3. **The `trip_readiness` trigger recomputes the reason inline instead of reading a `readyRef`** (Task 7b Step 3). The plan prescribed `readyRef.current = ready`; a render-phase ref write trips `react-hooks` ("Cannot update ref during render"), and worse, the pinned dependency array means the effect would **not** re-run when the baseline resolves — leaving step 3's copy stale in exactly the transition it was added for. The effect now derives the reason from `readinessFor(trip, Date.now(), { preShiftPassed: … })` and depends on the stable primitives `preShift.loaded` / `preShift.passed`. Consequence: the dep array **did** change, so `coach-marks.test.js:1035` was updated (the plan predicted that assertion would need no change).

4. **`triggerMilestone("trip_readiness", { reason })` does not pass `isContinue`.** The trigger's own guard (`if (loading || !trip || isTerminal || !isPreStart || activeMilestone) return`) restricts it to pre-start trips, where `action` is always `accept-start` — so `action === "navigate"` is unreachable from that call site and the field would have been a permanently-false constant. The `isContinue` branch is kept because its copy is correct for the state it describes; the finding is recorded in the vault (§3.2.1) as the reason a `dynamicBody` needs a context at its *trigger*, not just a branch.

### Corrections to expectations stated in the plan

- **The test path was wrong.** `mobile/tests/` does not exist; the vitest `include` is `src/**/*.test.js` + `mobile/lib/**/*.test.js`. Every mobile test in this plan lives in `mobile/lib/`.
- **Task 8 found one defect the plan did not anticipate, and it is more serious than "ground-like".** `driver/vehicle/page.js` rendered inspection severity with a hand-written `Critical|Major` ternary that matched **none** of the three vocabularies `vehicleinspection.severity` actually holds (mobile route: `None|Medium|High`; demo seed: `Minor|Moderate`; column default: `Minor`) — and it fed the resulting *variant name* back in as the `severity` prop, where it is not a key. Every real row rendered as an unresolved grey outline chip reading **"info"**, including a `High` (FAIL on a critical item). Replaced with the canonical `entity="severity"` lookup and `label={inspection.severity}`, the same shape `driver/incidents/page.js` already uses. The plan's specific worry — a severity rendered as ground-like — was **not** present: `vehicle_status` is displayed from the vehicle itself and no inspection path writes it.
- **Task 8 recorded no change for `driver/page.js`.** It already renders `inspection_type` dynamically and shows no item count.

### Not a deviation, but worth stating

`mobile/README.md:41` and the three pinned `coach-marks.test.js` strings were updated exactly as specified. No migration was added or needed: the two-type model is app-side only, and `vehicleinspection` already carried `inspection_type`, `trip_id` and `client_submission_id`.
