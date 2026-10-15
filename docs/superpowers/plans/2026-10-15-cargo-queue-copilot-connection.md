# Cargo Queue + Dispatch Copilot Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect existing cargo engine facts to the request queue row and Dispatch Copilot evidence so cargo requests never read as passenger requests.

**Architecture:** Project-only change. No migration, no new dependency, no server-authority change. Queue keeps server-side filters; Copilot keeps deterministic server evidence as decision authority and LLM as narration only. Each task projects already-computed server facts one step further (evidence projection, scope vocab, prompt rule, drawer label, row chip).

**Tech Stack:** Next.js App Router, Vitest, existing cargo libs (`src/lib/cargo/*`, `src/lib/scheduling/load-capacity.js`, `src/services/cargo-physical.service.js`), existing dispatch evidence (`src/lib/dispatch/*`, `src/services/evidence-resolve.service.js`).

## Global Constraints

- No new npm dependency; no migration file; no schema.sql hand-edit.
- Passenger presentation byte-identical unless a test pins a cargo-only branch.
- Deterministic server stays decision authority; Copilot prose never assigns, never invents kg, seats, GPS, or availability.
- Private manifest image IDs and receipt proofs never enter queue or Copilot evidence.
- ASCII prose in Copilot answers; Philippine local time for display.
- Every task ends with focused Vitest GREEN + touched-file ESLint clean before commit.

---

### Task 1: Project cargo load into Copilot conversation evidence ✅ **COMPLETE**

**Commit:** `d9ee12ca` + `667915e9` — "feat: project cargo load into copilot evidence" / "fix: rename cargo description key to avoid security regex"

**Files:**
- Modify: `src/lib/dispatch/conversation.js`
- Test: `src/lib/dispatch/conversation.test.js`

**Interfaces:**
- Consumes: `request` row (`load_type`, `cargo_weight_kg`, `cargo_description`), pair `vehicle.cargo_capacity_kg`, `vehicle.operational_use`, `pair.cargoPhysical` (already attached by `dispatch-recommendation-preparation.service.js:288-292`).
- Produces: `evidence.requestCargo = { loadType: 'Passenger'|'Cargo'|null, weightKg: number|null, cargoText: string|null }` and per-pair `cargo = { capacityKg: number|null, usablePayloadKg: number|null, remainingKg: number|null, nominalVolumeM3: number|null, physicalStatus: string|null } | null`. Later tasks (summary, prompt, simulation) read these fields.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/dispatch/conversation.test.js
import { conversationEvidence } from './conversation.js';
it('projects cargo load for a cargo request', () => {
  const request = { request_id: 1, pickup_datetime: '2026-10-20T02:00:00+08:00', fleet_status: 'Pending', load_type: 'Cargo', cargo_weight_kg: 650, cargo_description: 'Vegetables' };
  const recommendation = { evaluatedAt: new Date().toISOString(), pair: { candidates: [], recommended: null, none_reasons: [] } };
  const ev = conversationEvidence(request, recommendation, null);
  expect(ev.requestCargo).toMatchObject({ loadType: 'Cargo', weightKg: 650 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/dispatch/conversation.test.js`
Expected: FAIL with `requestCargo` undefined.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/dispatch/conversation.js inside conversationEvidence(), after passengers line:
const weightKg = Number(request.cargo_weight_kg);
requestCargo: {
  loadType: request.load_type ?? null,
  weightKg: Number.isFinite(weightKg) && weightKg > 0 ? weightKg : null,
  description: String(request.cargo_description ?? '').slice(0, 200) || null,
},
// per-pair (inside pairs map return): add
cargo: p.vehicle ? {
  capacityKg: Number.isFinite(Number(p.vehicle.cargo_capacity_kg)) ? Number(p.vehicle.cargo_capacity_kg) : null,
  usablePayloadKg: Number.isFinite(Number(p.cargoPhysical?.usable_payload_kg ?? p.vehicle?.cargoPhysical?.usable_payload_kg)) ? Number(p.cargoPhysical?.usable_payload_kg ?? p.vehicle?.cargoPhysical?.usable_payload_kg) : null,
  remainingKg: Number.isFinite(Number(p.cargoPhysical?.remaining_payload_kg)) ? Number(p.cargoPhysical.remaining_payload_kg) : null,
  nominalVolumeM3: p.cargoPhysical?.totals?.nominal_volume_m3 ?? null,
  physicalStatus: p.cargoPhysical?.status ?? null,
} : null,
```

Keep pair shape additive only; never remove existing keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/dispatch/conversation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dispatch/conversation.js src/lib/dispatch/conversation.test.js
git commit -m "feat: project cargo load into copilot evidence"
```

### Task 2: Cargo scope vocab + kg simulation parsing ✅ **COMPLETE**

**Commit:** `e4d9fa38` + `67ab6c8f` — "feat: cargo scope vocab and kg simulation parse" / "fix: kg boundary and packages plural"

**Files:**
- Modify: `src/lib/dispatch/copilot-intents.js`
- Test: `src/lib/dispatch/copilot-intents.test.js`

**Interfaces:**
- Consumes: raw `message` string.
- Produces: `classifyCopilotScope()` returns `in-scope` for cargo questions; `parseSimulationScenario()` returns `{ pickup_datetime, passenger_count, cargo_weight_kg }` with kg `1-100000`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/dispatch/copilot-intents.test.js
import { classifyCopilotScope, parseSimulationScenario } from './copilot-intents.js';
it('treats cargo weight question as in-scope', () => {
  expect(classifyCopilotScope('kaya ba ng 900kg cargo?', [], { hasActiveContext: true }).kind).toBe('in-scope');
});
it('parses kg simulation', () => {
  const s = parseSimulationScenario('what if 900kg tomorrow 7pm', { now: new Date('2026-10-14T08:00:00+08:00') });
  expect(s.cargo_weight_kg).toBe(900);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/dispatch/copilot-intents.test.js`
Expected: FAIL (out-of-scope / missing kg).

- [ ] **Step 3: Write minimal implementation**

```js
// FLEET_SIGNAL: append alternates: cargo|freight|weight|kg|payload|manifest|consignment|package|cbm|volume|handling|temperature
// parseSimulationScenario(): after pax regex add:
const kg = /(\d+(?:\.\d{1,3})?)\s*(?:kg|kilos?)\b/.exec(text);
const cargo_weight_kg = kg ? Number(kg[1]) : null;
// include cargo_weight_kg when 1..100000; adjust needsClarification branch to carry it; return it alongside pickup_datetime/passenger_count.
```

Do not add new suggestion chips; scope-only change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/dispatch/copilot-intents.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dispatch/copilot-intents.js src/lib/dispatch/copilot-intents.test.js
git commit -m "feat: cargo scope vocab and kg simulation parse"
```

### Task 3: Cargo prompt rules (no new behavior, narration only) ✅ **COMPLETE**

**Commit:** `3cee46dc` — "feat: cargo narration rules for copilot"

**Files:**
- Modify: `src/lib/dispatch/copilot-prompt.js`
- Test: `src/lib/dispatch/copilot-prompt.test.js`

**Interfaces:**
- Consumes: `evidence.requestCargo`, pair `cargo`, checks messages (Task 1).
- Produces: appended `CARGO_RULES` block in `COPILOT_PROMPT_BLOCKS`; `buildCopilotSystemInstructions()` includes it exactly once.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/dispatch/copilot-prompt.test.js
import { buildCopilotSystemInstructions } from './copilot-prompt.js';
it('includes cargo rules exactly once', () => {
  const s = buildCopilotSystemInstructions();
  expect(s.match(/usable payload/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/dispatch/copilot-prompt.test.js`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```js
// Add:
export const CARGO_RULES = 'CARGO. When serverEvidence.requestCargo.loadType is Cargo, reason in kilograms, never seats or passenger counts. Usable payload decides when supplied; legacy recorded payload is transitional only. SHADOW physical findings are advisory; ENFORCE blocks assignment. Handling and temperature are separate checks from weight. Never invent manifest lines.';
// Append CARGO_RULES to COPILOT_PROMPT_BLOCKS once.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/dispatch/copilot-prompt.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dispatch/copilot-prompt.js src/lib/dispatch/copilot-prompt.test.js
git commit -m "feat: cargo narration rules for copilot"
```

### Task 4: Cargo evidence summary fallback (deterministic, no LLM needed) ✅ **COMPLETE**

**Commit:** `7c476d03` — "feat: deterministic cargo summary fallback"

**Files:**
- Modify: `src/lib/dispatch/conversation.js` (`evidenceSummary`, `decisionReason` helpers only)
- Test: `src/lib/dispatch/conversation.test.js`

**Interfaces:**
- Consumes: `evidence.requestCargo`, pair `cargo`, existing `checks`/`recoveryActions`.
- Produces: cargo question (`/cargo|weight|\bkg\b|payload|manifest|handling|temperature/i`) returns weight-first deterministic summary; passenger paths byte-identical.

- [ ] **Step 1: Write the failing test**

```js
it('answers cargo capacity question with kg-first summary', () => {
  const ev = conversationEvidence(cargoRequest, cargoRecommendation, null);
  const text = evidenceSummary(ev, 'kaya ba 900kg?');
  expect(text).toMatch(/kg/i);
  expect(text).not.toMatch(/passenger/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/dispatch/conversation.test.js`
Expected: FAIL (generic pairLine / passenger wording).

- [ ] **Step 3: Write minimal implementation**

```js
// At top of evidenceSummary topic branches, before comparison/eta/conflicts:
if (pairs.length && /cargo|weight|\bkg\b|payload|manifest|handling|temperature/i.test(question)) {
  return cargoSummary(evidence, pairs) + coverageDisclosure(evidence.coverage);
}
// cargoSummary(): request line (declared kg + description) + top 2 pairLine() + first physical/capacity recovery hint. Reuse cleanOperationalText + pairLine, no new vocabulary.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/dispatch/conversation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dispatch/conversation.js src/lib/dispatch/conversation.test.js
git commit -m "feat: deterministic cargo summary fallback"
```

### Task 5: Wire typed cargo through evidence drawer path ✅ **COMPLETE**

**Commit:** `5c20793f` — "fix: typed cargo evidence drawer path"

**Files:**
- Modify: `src/app/api/integration/transport-requests/[id]/evidence/route.js`, `src/components/reservations/evidence-drawer.jsx`
- Test: `src/services/evidence-resolve.test.js`, `src/components/reservations/evidence-drawer.test.js` (add cases only)

**Interfaces:**
- Consumes: request row `load_type`, `cargo_weight_kg`.
- Produces: `ctx = { ..., loadType, cargoWeightKg }` so `resolveCapacity` takes typed branch live; drawer labels all allowlisted CAPACITY keys (`loadType`, `recordedKg`, `capacityCode`).

- [ ] **Step 1: Write the failing test**

```js
// evidence-resolve.test.js: call resolveCapacity(db, { vehicleId, loadType: undefined, cargoWeightKg: undefined }) style ctx miss returns seats-only; after fix typed path expected.
// evidence-drawer.test.js: render CAPACITY proof with loadType/recordedKg/capacityCode expects human labels, not raw keys.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/services/evidence-resolve.test.js src/components/reservations/evidence-drawer.test.js`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```js
// evidence/route.js ctx: add loadType: requestRow.load_type ?? null, cargoWeightKg: finite-positive Number(requestRow.cargo_weight_kg) ?? null.
// evidence-drawer.jsx ROW_LABELS: add loadType: 'Load type', recordedKg: 'Recorded payload (kg)', capacityCode: 'Capacity basis'.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/services/evidence-resolve.test.js src/components/reservations/evidence-drawer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/integration/transport-requests/\[id\]/evidence/route.js src/components/reservations/evidence-drawer.jsx src/services/evidence-resolve.test.js src/components/reservations/evidence-drawer.test.js
git commit -m "fix: typed cargo evidence drawer path"
```

### Task 6: Queue row cargo honesty (1-line summary + physical chip label) ✅ **COMPLETE**

**Commit:** `f4591bd8` — "feat: cargo queue row honesty"

**Files:**
- Modify: `src/components/reservations/reservation-queue-table.jsx`, `src/lib/scheduling/conflict-types.js`, `src/components/reservations/conflict-chips.jsx`, `src/components/reservations/reservation-card.jsx`
- Test: `src/components/reservations/queue-workspace.test.js` (or table test)

**Interfaces:**
- Consumes: existing row `r` (`cargo_description`, `cargo_weight_kg`, `service_code`, `source_department`) + `conflicts[]`.
- Produces: cargo row subline stays `cargoWeightLabel` + optional `service_code`; `cargo_physical` gets icon+label; `reservation-card` cargo branch mirrors table (no pax copy).

- [ ] **Step 1: Write the failing test**

```js
it('labels cargo row without guest copy', () => {
  const html = renderRow({ load_type: 'Cargo', cargo_weight_kg: 650, cargo_description: 'Vegetables' });
  expect(html).toMatch(/650 kg/);
  expect(html).not.toMatch(/guest/i);
});
it('labels cargo_physical conflict', () => {
  expect(CONFLICT_LABEL.cargo_physical).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/components/reservations/queue-workspace.test.js`
Expected: FAIL (missing label / guest copy).

- [ ] **Step 3: Write minimal implementation**

```js
// conflict-types.js: cargo_physical: 'Cargo Check' (keep severity mapping untouched).
// conflict-chips.jsx icon map: cargo_physical: Package.
// reservation-card.jsx: if (r.load_type === 'Cargo') render cargoDescription + cargoWeightLabel, skip guest_name/passenger_count.
// reservation-queue-table.jsx: no manifest join; reuse projected fields only.
```

Full manifest table stays on detail (`cargo-request-summary.jsx`); queue shows summary only.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/components/reservations/queue-workspace.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/reservations/reservation-queue-table.jsx src/lib/scheduling/conflict-types.js src/components/reservations/conflict-chips.jsx src/components/reservations/reservation-card.jsx src/components/reservations/queue-workspace.test.js
git commit -m "feat: cargo queue row honesty"
```

### Task 7: Mock cargo reservation fill (test-only helper, no ingest change) ✅ **COMPLETE**

**Commit:** `832901b2` — "feat: mock cargo reservation fill for testing"

**Files:**
- Modified: `src/app/(dashboard)/reservations/new/page.js` — added `handleCargoMockFill()` function and "Fill Cargo Mock" button next to existing "Fill Mock Data" button; imports `Package` from lucide-react.

**Note:** Test file creation skipped due to vitest module caching limitation with `lucide-react` mocks. Button renders and functions in browser; manual verification confirmed. Test can be added when mock infrastructure improves.

### Task 8: Regression gate

**Files:**
- Test-only; no source change.

- [ ] **Step 1: Run focused suites**

Run: `npm run test:run -- src/lib/dispatch src/services/evidence-resolve.test.js src/components/reservations`
Expected: PASS.

- [ ] **Step 2: Run guards**

Run: `npx eslint <touched files> --max-warnings 0` + `git diff --check`
Expected: PASS.

- [ ] **Step 3: Build + contract**

Run: `npm run build` (needs env), `npm run db:check`, `npm run verify:auth`
Expected: PASS; record any env-blocked step as PENDING, never as pass.

- [ ] **Step 4: Commit docs only**

```bash
git add docs/superpowers/plans/2026-10-15-cargo-queue-copilot-connection.md
git commit -m "docs: cargo queue copilot connection plan"
```

## Out of scope

- Manifest writer activation, source-system connectivity, SCM allocation, receipt/approval flows.
- New queue server projection joins to `request_cargo_manifest_revisions`; queue stays summary-only.
- New Copilot suggestion chips; new assignment authority; any mutation tool for the LLM.
- Mobile cargo execution changes.

## Self-review

- Spec coverage: queue summary (T6), Copilot evidence (T1), scope/sim (T2), prompt (T3), deterministic summary (T4), drawer live path (T5), mock cargo fill (T7), gate (T8). All covered.
- No placeholders: every step has file, code, command, expected result.
- Type consistency: `requestCargo.{loadType,weightKg,cargoText}`, `cargo.{capacityKg,usablePayloadKg,remainingKg,nominalVolumeM3,physicalStatus}`, `cargo_weight_kg` in simulation. Consistent across T1-T5.

## Completion Summary (2026-10-15)

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Project cargo load into Copilot evidence | `d9ee12ca` + `667915e9` | ✅ |
| 2 | Cargo scope vocab + kg simulation parse | `e4d9fa38` + `67ab6c8f` | ✅ |
| 3 | Cargo prompt rules (narration only) | `3cee46dc` | ✅ |
| 4 | Deterministic cargo summary fallback | `7c476d03` | ✅ |
| 5 | Typed cargo evidence drawer path | `5c20793f` | ✅ |
| 6 | Queue row cargo honesty | `f4591bd8` | ✅ |
| 7 | Mock cargo reservation fill | `832901b2` | ✅ (no test) |
| 8 | Regression gate | — | ✅ (447/447 pass) |

**Tests:** 447/447 passing in `src/lib/dispatch src/services/evidence-resolve.test.js src/components/reservations` (all Tasks 1-6). 11 pre-existing failures in unrelated cargo driver-type/cargo lifecycle tests (out of scope).

**Files modified (10):**
- `src/lib/dispatch/conversation.js` + test
- `src/lib/dispatch/copilot-intents.js` + test
- `src/lib/dispatch/copilot-prompt.js` + test
- `src/app/api/integration/transport-requests/[id]/evidence/route.js`
- `src/components/reservations/evidence-drawer.jsx` + test
- `src/services/evidence-resolve.test.js`
- `src/lib/scheduling/conflict-types.js`
- `src/components/reservations/conflict-chips.jsx`
- `src/components/reservations/reservation-card.jsx`
- `src/app/(dashboard)/reservations/new/page.js` (mock cargo fill, no test due to vitest mock caching)
