---
type: status
status: working
tags: [development, testing, dispatch, copilot]
source:
  - src/lib/dispatch/fleetmate-fixtures.js
  - src/lib/dispatch/fleetmate-eligibility.test.js
  - src/lib/dispatch/fleetmate-temporal-gps.test.js
  - src/lib/dispatch/fleetmate-ranking.test.js
  - src/lib/dispatch/fleetmate-evidence.test.js
  - src/lib/dispatch/fleetmate-adversarial.test.js
  - src/lib/dispatch/narration-guards.js
  - src/lib/dispatch/narration-guards.test.js
  - src/lib/dispatch/clause-polarity.js
  - src/lib/dispatch/clause-polarity.test.js
  - src/lib/dispatch/copilot-prompt.js
  - src/components/reservations/evidence-drawer-fleetmate.test.js
  - src/app/api/integration/transport-requests/[id]/conversation/fleetmate-scenarios.test.js
  - src/lib/dispatch/evidence-contract.js
  - src/lib/dispatch/conversation.js
  - src/lib/dispatch/decision.js
  - src/lib/dispatch/recommendation-ranking.js
  - src/components/reservations/evidence-drawer.jsx
last_verified: 2026-09-18
related: ["[[AI Advisory]]", "[[Dispatch Copilot Scope and Conversation Audit]]", "[[Testing]]"]
---

# FleetMate scenario test suite

2026-09-17 — built as test-only work, then used. **No live data was mutated and
nothing was committed.** The suite found two real defects; both were fixed the
same day under an approved remediation plan (§7, round 1), and the deliberate
failing assertions that documented them now pass. Reviewing that fix surfaced a
**third** defect it had introduced plus two further residuals in the same proof
path. The third was closed the same day (§7, round 1, *follow-on*); the two
residuals — a licence proof reporting vehicle facts, and a pairing proof reading
the vehicle id as its driver — were fixed under a second approved plan (§7, round
2), leaving one residual open. Round 4 added **group O**, which closes four
narration obligations the model had been trusted to get right on its own; those
four had been listed as the honest residue precisely because they looked like
judgement calls, and re-reading the live transcripts showed three of the four are
closed facts about `(question, evidence)`. Round 5 (§7) closes the two smaller
ones that remained — claims the model *volunteers* when nothing raised the topic —
and states the scope boundary as a measured obligation rather than an unstated
absence. Everything below is the state *after* those fixes unless it says
otherwise.

FleetMate is the Dispatch Copilot. The property under test is the one the
architecture claims: *the deterministic server decides, FleetMate explains, the
evidence system proves, the dispatcher acts through the guarded workflow.* A
scenario passes when the narration cannot be made to say more than the
deterministic layer computed.

## 1. Verified test contract

Everything below was read from the current implementation on 2026-09-17, not
from earlier notes. Where the docs and the code disagreed, the code won.

### 1.1 The deterministic hierarchy — verified from code

Source: `src/lib/dispatch/recommendation-ranking.js` (`comparePairEvidence`),
with the thresholds in `src/lib/dispatch-policy.js`.

| Rank | Criterion | Exact rule as implemented |
| --- | --- | --- |
| 1 | Reliability | `band()` on feasibility verdict + readiness. Hard blockers, `UNKNOWN`/incomplete evidence and advisories sort below a clean `SAFE` pair. |
| 2 | Efficiency | Predicted transfer minutes, **material** only when the difference is **strictly greater** than `policy.efficiencyTieMinutes` (10). At exactly 10 it is a tie-break, not a material advantage. |
| 3 | Workload | Only when **both** pairs are band 0, **both** have `workloadEvidence.complete === true`, and **both** are on the **same** `serviceDate`. Incomplete or cross-date loads are never credited. |
| 4 | Efficiency (any difference) | Any remaining transfer difference decides. |
| 5 | Schedule fit / standing | `reason_type` standing preference first, then lowest `vehicle_id`, then lowest `driver_id`. Stable and total. |

`policy.safetyBufferMinutes` (10) and `shortNoticeHorizonMinutes` (90) are the
other two configured values. **GPS health is not in this list at any rank** —
asserted directly (FM-RANK-011, FM-ADV-010).

`rankDispatchPairs` writes a single `decisionEvidence` per pair: `code`,
`label` (`Only evaluated option` at index 0 with no comparison, otherwise
`Alternative`), `comparedPair`, `alternativeAdvantage`, `explanation`. A lone
option is told it has nothing to compare against rather than invited to compare
against an option that does not exist; the generic fallback sentence is kept for
the multi-pair path it was written for. The narrator is handed this order; it is
never asked to reproduce it (FM-RANK-013).

### 1.2 Temporal reasoning — verified from code

Source: `src/lib/dispatch/location-relevance.js` (`requestLocationContext`).

| Horizon | Condition (Manila service date) | Urgency | Reason code |
| --- | --- | --- | --- |
| `INACTIVE` | Request not actionable | `SCHEDULED` | `REQUEST_NOT_ACTIONABLE` |
| `INACTIVE` | No pickup time | `SCHEDULED` | `PICKUP_TIME_UNKNOWN` |
| `OVERDUE` | `pickup < now` | `SHORT_NOTICE` | `OVERDUE_REQUEST` |
| `LAST_MINUTE` | `0 ≤ pickup − now ≤ 30` (`highMinutes`) | `SHORT_NOTICE` | `PICKUP_WITHIN_HORIZON` |
| `NEAR_DISPATCH` | `≤ 90` (`shortNoticeHorizonMinutes`), **or** a trusted itinerary departure is due | `SHORT_NOTICE` | `PICKUP_WITHIN_HORIZON`, or `PLANNED_DEPARTURE_DUE` on the itinerary branch |
| `SAME_DAY` | later the same Manila date | `SCHEDULED` | `FUTURE_PLANNING` |
| `FUTURE` | any later date | `SCHEDULED` | `FUTURE_PLANNING` |

Two cells in this table were **wrong until 2026-09-17** and are corrected above
from the source: `OVERDUE` carried urgency `—` (it is `SHORT_NOTICE`, because
`pickup < now` satisfies the `immediate` predicate, and `urgency` is
`immediate ? 'SHORT_NOTICE' : 'SCHEDULED'` with no third value), and `SAME_DAY`
carried reason code `PLANNED_DEPARTURE_DUE`. That second cell was not merely
mislabelled, it was **unreachable as written**: `SAME_DAY` sits past the
`immediate` branch in the horizon chain, so it is only ever selected when
`immediate` is `false` — and `!immediate` is tested *before* `due` in the reason
chain, so a `SAME_DAY` row can only ever carry `FUTURE_PLANNING`. The two
conditions are mutually exclusive by construction. `PLANNED_DEPARTURE_DUE` is a
real code and does occur; it belongs to the itinerary-departure branch of
`immediate`, which lands on `LAST_MINUTE` or `NEAR_DISPATCH`, never on
`SAME_DAY`. No test asserts either cell (`PLANNED_DEPARTURE_DUE` appears in the
source and in no assertion anywhere), so this was a documentation error with no
executable counterpart — recorded rather than silently reconciled. See
`Capstone/07 - Development/FleetMate AI Scenario Validation Report.md` Appendix C.

Every boundary is **inclusive** (10 and 30 are `LAST_MINUTE`; 90 is
`NEAR_DISPATCH`; 91 is `FUTURE_PLANNING`) — FM-TEMP-001/003/011, FM-GPS-011.

`repair`/`INACTIVE` requests still produce a context; they never produce a
favourable one. An `OVERDUE` request has **no future boundary**, so
`temporalContext.nextBoundaryAt` is `null` and the contract reports that rather
than inventing one; `evidenceExpired` skips nulls, so an overdue pair carries no
temporal expiry (FM-TEMP-004).

### 1.3 GPS relevance — verified from code

Source: `src/lib/gps.js` + `qualifiedGps` in `location-relevance.js`.

Labels: **`Fresh`** (≤ 90 s), **`Delayed`** (≤ 300 s), **`Offline`** (older),
**`No signal`** (no usable timestamp). A fix is **qualified** only when it is
`Fresh`, has a valid coordinate pair, has `0 < accuracy ≤ 100 m`, and is **not
dated beyond 30 s in the future**. A qualified fix mints
`expiresAt = observed_at + 90 s`. `Delayed` and `Offline` are never qualified,
however accurate.

`gpsHealth` reaches the projection **as a label only** — never coordinates,
never a raw fix — and only on the `IMMEDIATE` branch. `FUTURE`, `SAME_DAY` and
`REPOSITION` **intentionally omit it**: the absence is not missing evidence and
must never be narrated as such (FM-GPS-008, FM-TEMP-005).

`IMMEDIATE` / `REPOSITION` / `SCHEDULED` are `dispatchContext.mode` — a
**different taxonomy** from the horizon. That distinction was the root of
FM-DRAW-014, so the mode is now **projected as its own label** (`dispatchMode`,
alongside the `gpsHealth` label — never `originType`, `previousDispatchId`,
`originLabel` or standby coordinates; FM-EVID-005) and carried into
`clearanceMeta.mode`, because live location is excluded by the mode and the
horizon independently and the inspector must test each on its own field.

### 1.4 Option identity

`conversationEvidence()` does **not** attach `displayedOptions`; the route does,
from the card the dispatcher saw. Option identity is the card's
`{vehicleId, driverId}` resolved against fresh evidence
(`resolved` | `missing`) — never array position, never engine rank. Asserted at
the projection level (FM-RANK-013) and at the route level (FM-ROUTE-001).

### 1.5 Evidence contract

`src/lib/dispatch/evidence-contract.js` is a **default-deny allowlist** per
evidence type. Signed `ev_` refs are HMAC-SHA256 under `NEXTAUTH_SECRET`, purpose
`fleet-dispatch-evidence-v1`, 15-minute TTL, request-scoped (`TAMPERED` /
`EXPIRED` / `SCOPE` / `INACTIVE`). `ACTIVE_EVIDENCE_TYPES` excludes the reserved
`trail` type, whose allowlist is empty — nothing about it can be displayed.

`proofTypeForRecovery()` classifies a recovery action from its **recorded reason**
(`message`), falling back to the static template hint that exclusion actions
carry instead. Classifying on the template alone sent a leave-sourced driver
block to the `schedule_conflict` family, which resolves a *different* record set
and can come back clear — this was FM-EVID-012 (FM-EVID-012, FM-EVID-013).

A proof must carry the identity its record is scoped to, or it resolves the
**wrong record**. An engine **exclusion** carries a reason string and a vehicle id
but no driver — `dispatch-radar.service.js` pushes an INFEASIBLE pair's reasons
into `none_reasons` as `{vehicle_id, reason}` — so `recoveryActionForExclusion`
leaves `id: null`. A **driver-sourced** block (`record: 'driver' | 'schedule'`)
with no id therefore mints no ref at all (FM-EVID-014), because every family it
could name resolves some other identity and comes back clear:

| Family | Resolver with a null driver | Result |
| --- | --- | --- |
| `leave` | `resolveLeave` — `WHERE driver_id = NULL` matches no row | `{verdict:'clear'}` *before 2026-09-17*; now `{verdict: null}` (FM-EVID-021) |
| `schedule_conflict` | `resolveScheduleConflict` — `driver_id=$1 OR vehicle_id=$2` | silently narrows to a **vehicle-only** check |
| `compliance` (licence) | `resolveCompliance` — `vehicleId != null` returned early | reports the **vehicle's** registration/insurance |

Each is a *false clearance* against the very narration the proof exists to
support, so the row renders with its reason and no Review action instead.
Vehicle-scoped blocks (maintenance, vehicle status, capacity, incidents) are
unaffected — their identity is the vehicle. This is the same contradiction class
as FM-EVID-012, and the fix for FM-EVID-012 (scoping the `leave` ref to the
driver) is what opened it.

**The identity itself had to be defined, not merely checked.** The projection
coerces ids with `Number()` (`conversation.js`), so an **absent** driver does not
arrive as `null` — it arrives as `0`, and `Number(undefined)` as `NaN`. That
matters because `0` is the dangerous shape rather than the safe one: it is not
null, so a `!= null` check passes it, and `driver_id = 0` is a clean, valid query
that matches no row. Every resolver that answers *clear* on an empty result
therefore answered *clear* to a question it was never able to ask. Absent and
not-a-real-id are the same answer, so the contract now exports one predicate —
`usableRecordIdentity(value)`, which admits only a **positive safe integer** — and
all three sites read it: both mint sites and `resolveLeave` (FM-EVID-021). An
identity that cannot be used now yields **no claim** rather than a clearance,
which the drawer renders as *—*.

**Identities are not enough: a proof must also say *which* record it is about.**
`compliance` spans two unrelated families — a vehicle's registration/insurance and
a driver's licence — whose resolvers return different facts, so a ref carrying
both a `vehicleId` and a `driverId` cannot say which one it covers. The ref now
carries a validated `subject: 'vehicle' | 'driver'` (`COMPLIANCE_SUBJECT_BY_CHECK`
for clearance checks, `COMPLIANCE_SUBJECT_BY_CODE` for recovery codes), and
`resolveCompliance` branches on it instead of on which id happens to be non-null.
A subjectless ref — one minted before the field existed — is refused with code
`UNSCOPED` (route: 404) rather than guessed at; the 15-minute TTL clears it on the
next Copilot run. FM-EVID-015/016/019/020 cover the lane.

The same "name the record, never infer it" rule fixes **pairing**. `decision.js`
records a pairing block as `record: 'schedule'` holding the **vehicle** id, and
`record: 'schedule'` otherwise means *"the id is the driver"*, so `sign()` signed a
pairing ref with `driverId = <vehicleId>`. `resolvePairing` then queried
`vehicle_id=V AND driver_id=V`, matched nothing, and asserted
`pairingState: 'none'` — a definitive negative from a check that never ran —
while `resolveEvidence` hung the name of whichever driver shares that number on a
*Pairing Evidence* drawer, the PAIRING allowlist admitting `driverName`. A pairing
ref now takes its driver from the pair (`pairCtx.driverId`), which is the only
place the real answer exists, and `resolvePairing` returns `{verdict: null,
pairingState: null}` for a null driver — the `resolveGps` posture — which the
drawer renders as *—* rather than as a claim (FM-EVID-017/018). The same posture
was extended to `resolveLeave` on 2026-09-17: with no usable driver it returns
`{verdict: null, overlapsBooking: null}` and **issues no query at all**, so the
`leave` clearance row and any leave proof resolve to no claim rather than to a
clearance (FM-EVID-021).

## 2. Scenario matrix

124 automated scenarios in 8 files (133 executed tests). The two units differ
by **nine**, and the whole of that difference is three ids that own more than one
assertion: `FM-ROUTE-009` (7 tests), `FM-ROUTE-008` (3) and `FM-DRAW-015` (2) —
six, two and one above their own three ids. Every other id owns exactly one test,
including each of the three rows of the `FM-VEH-001…003` table, which are three
ids. Counts below are **scenario ids** unless a
line says tests. Layer codes: **D** = deterministic engine,
**P** = projection (`conversationEvidence`), **E** = evidence contract, **R** =
route, **U** = UI render.

| Group | File | Scenarios | Layer | Covers |
| --- | --- | --- | --- | --- |
| A–G | `fleetmate-eligibility.test.js` | 32 | D, P | Eligibility verdicts and their narration: capacity, registration, insurance, maintenance, incidents, leave/schedule, pairing, category, unverified evidence, recovery code + fix ordering, prefiltered exclusions |
| H–I | `fleetmate-temporal-gps.test.js` | 20 | D, P | Horizon bands and their inclusive edges, reason codes, urgency, boundary expiry, live-location gating, the four GPS labels, accuracy/clock-skew qualification, live vs predicted ETA wording |
| J | `fleetmate-ranking.test.js` | 13 | D, P | The full comparator chain, the material-difference threshold, workload applicability, standing preference, deterministic tiebreak, the single-option fallback, GPS-is-not-a-ranking-input |
| K | `fleetmate-evidence.test.js` | 21 | E | Chat↔drawer agreement: every narrated finding resolves to a request-scoped proof of the right record; default-deny; no coordinates or HR detail; the recorded reason decides the evidence family (the mechanism behind the fixed FM-EVID-012); a driver-scoped proof is never minted without a driver identity (FM-EVID-014); a compliance proof states its subject and the resolver obeys it rather than inferring from whichever id is present, and refuses when it cannot (FM-EVID-015/016/019); a pairing proof looks up the pair's own driver and an unevaluated pairing claims nothing (FM-EVID-017/018); a signed ref with an unrecognized subject is rejected (FM-EVID-020); a leave proof with no usable driver claims nothing in either direction and issues no query (FM-EVID-021) |
| L | `evidence-drawer-fleetmate.test.js` | 8 | U | The drawer renders the *same* labels and states the chat used, offers Review only for rows with a resolvable proof, follows the horizon **and the dispatch mode** for the GPS row (the fixed FM-DRAW-014), keeps locked copy, and leaks no non-allowlisted fact. FM-DRAW-015 asserts the drawer's GPS verdict and the chat's narration guard cannot disagree |
| M | `fleetmate-adversarial.test.js` | 10 | D, P | Paraphrase consistency (8 phrasings → 1 answer), claims cannot change a verdict, missing evidence is not a blocker and not safety, no probability/guarantee/assignment language, truncation disclosure, detector disjointness |
| N | `conversation/fleetmate-scenarios.test.js` | 9 | R | Option identity and server-side gating, `missing` options refused by name, the drawer payload the route returns, the verified-baseline change narration, queue-impact gating, the return and simulate read-only paths, the server-owned evaluated-window disclosure (FM-ROUTE-008), and the server-owned narration guards on the narrated path only (FM-ROUTE-009) |
| O | `narration-guards.test.js` | 8 | D, R | The four narration obligations that are closed facts about `(question, evidence)` and are therefore stated by the server rather than left to the model: an inapplicable live-GPS evaluation (FM-GUARD-001/002), a rate or punctuality request (FM-GUARD-003), an entity named nowhere in the evaluation (FM-GUARD-004), and a claim that a record was overridden (FM-GUARD-005). Plus the two negative properties — nothing fires on an ordinary question and `withGuards` is then a no-op (FM-GUARD-006) — and the invariant that every clause the guards can emit itself satisfies the group M honesty predicates (FM-GUARD-007), with the audit labels kept out of the dispatcher's view (FM-GUARD-008) |

Deliberate non-duplication: the input boundary (injected instructions, hostile
history, prompt-block ownership, mutation-path absence, bare-command parsing) is
already owned by `src/security-assessment/fleetmate-prompt-injection.security.test.js`
(SEC-AI-001…008) and `src/lib/dispatch/copilot-prompt.test.js`. Group M asserts
the *answer-honesty* dimensions those do not. `route.test.js` owns input
validation and comparison-proof minting; group N asserts the response contract
around them.

Group O is the deliberate counterpart to group M's own stated limit. Group M's
scope note ends *"Model prose remains manual acceptance"*
(`fleetmate-adversarial.test.js:18`), because group M asserts the honesty
predicates against `evidenceSummary()` — the deterministic path — and can say
nothing about what a language model writes. Group O closes the **six** of those
obligations that are **closed facts about `(question, evidence)` or about the
model's own text** rather than judgement calls, by computing them server-side and
appending them to the narrated answer: four keyed on the question (an absent
entity, an inapplicable GPS evaluation, a rate request, a claim that a record was
overridden) and, since 2026-09-18, two keyed on what the model **volunteers** when
nothing raised the topic. What remains open is stated rather than implied: no
predicate catches a *novel* injection phrasing that asserts nothing about the
evidence and names no override. That boundary is **measured rather than assumed**:
the live probe's cases 11–16 exercise six such phrasings per run
(`Capstone/07 - Development/FleetMate AI Scenario Validation Report.md` §13A), of
which five meet no guard at all and the sixth fires only because it names an
override — a fact the run produced rather than the comment predicting it, since
the case had been filed as a residue candidate and came back `FIRED`. **Scope was
still a prompt obligation at this historical point**: its route-edge classifier
was added in Round 6 below, with contextual follow-ups accepted only when recent
FleetOps context or active reservation/recommendation state exists.
Group O also cannot police the model's own sentences: SEC-AI-007
pins that prose is returned verbatim, so every guard **appends**, and the honesty
predicates are asserted on the appended block (the part the server owns) rather
than on the assembled answer (which contains the model's words too). A guard that
fires on a volunteered claim therefore *answers* it rather than removing it.

## 3. Execution results — 2026-09-17

**After the fixes** (the 2026-09-17 run, before group O existed):

```
npx vitest run <the 7 files above>
  Test Files  7 passed (7)
  Tests       110 passed (110)
```

That block is the 2026-09-17 run **before** group O existed. The measured state of
the tree now, after group O, the three guard ids and the scope sentence:

```
npx vitest run <the 8 files above>
  Test Files  8 passed (8)
  Tests       133 passed (133)
   Duration   2.25s
```

| Command | Result |
| --- | --- |
| Scenario suite, 8 files | **124 scenario ids — all pass** (133 tests, 2.25 s) |
| `src/lib/dispatch` + `src/components/reservations` + transport-request routes + `src/security-assessment` | **592 tests in 41 files — all pass** (5.55 s) |
| Full suite | **1859 tests in 171 files — all pass** (20.31 s) |
| `npx eslint` on the touched source files and test files | clean |
| `npm run build` | succeeded (all routes emitted, 20.3 s, exit 0) |

All three rows were re-executed on 2026-09-18 at 10:43–10:46 MPST against one
unchanged tree. The step from the 2026-09-17 state (127 / 8, 564 / 39, 1827 / 169)
is **+12 tests**: `clause-polarity.test.js` (6 tests, one new file, pinning the
extracted matcher on fixed input), the three `FM-GUARD-009/010/011` guard tests,
the two added `FM-ROUTE-009` route tests, and one assertion in
`copilot-prompt.test.js`. The regression scope's observed 592 is 16 tests and one
file beyond 564 + 12, and that remainder belongs to concurrent edits in the tree
rather than to this work — stated rather than absorbed, because a reader
comparing 564 to 592 would otherwise attribute all 28 to the guards.

**Before the fixes**, the same 7 files reported `2 failed | 100 passed (102)` —
FM-EVID-012 and FM-DRAW-014, each a deliberate failing assertion standing in for
a defect (§4). Both were fixed the same day; both assertions now pass. *That 102
is the size of the suite at that moment, not a subset of today's 124:* the
scenarios added since (FM-EVID-014…021, then group O, then the three volunteered-
claim ids) were written for defects
found while fixing those two and for the live-model cases after them, so the
figures 102 → 109 → 110 → 121 → 124 are successive states of one growing file,
never a decomposition of a single run. No pre-existing test was weakened, deleted,
or adjusted at any point.

**Mutation checks on the proof-subject lane** (2026-09-17) — a guard nobody has
watched bite is not evidence, so each new guard was disabled in turn and the
regression test re-run. All three bit, and each failure named the defect:

| Guard disabled | Test | Observed failure |
| --- | --- | --- |
| `resolveCompliance` branched on `subject` | FM-EVID-015 | `subject: 'vehicle'` where `'driver'` was required |
| `resolvePairing`'s null-driver early return | FM-EVID-018 | `expected 'none' to be null` |
| `sign()` sourcing a pairing driver from the pair | FM-EVID-017 | `driverId: 9` (the vehicle) instead of `6` |

*Scope caveat, stated rather than glossed:* FM-EVID-016 (registration/insurance)
could **not** have caught the first mutation — vehicle-first and
`subject: 'vehicle'` agree for those two checks by design — so FM-EVID-015 is the
assertion that carries that regression, and it is single. The third mutation was
caught at the ref assertion, before the query-parameter assertion that follows it
in the same test. All three guards were restored and the absence of the
temporary edits verified.

FM-EVID-014 was added *after* the fixes, for the edge the FM-EVID-012 fix
introduced (§4). It was confirmed to bite by temporarily disabling the guard it
covers: the file reported `1 failed | 13 passed` with FM-EVID-014 the only
failure. Because that assertion is a table loop it stops at the first family, so
a second throwaway probe (since deleted) was run with the guard disabled to
confirm **which** families the guard actually holds — all three minted a
null-driver ref without it: `leave` (`driverId: null, recordId: null`),
`schedule_conflict` (`recordId: 9`, the vehicle) and `compliance` (`recordId: 9`).
The guard was restored immediately and the counts above are from the restored
tree.

**Mutation checks on the record-identity lane** (2026-09-17, round 3) — the same
discipline applied to the three sites that now read `usableRecordIdentity`. Each
was disabled in turn and FM-EVID-021 re-run:

| Guard disabled | Observed failure |
| --- | --- |
| `resolveLeave`'s unusable-identity early return | `AssertionError: expected 'clear' to be null` |
| the leave-clearance mint guard in `attachClearanceProofs` | `expected { checkId: 'leave', …(3) } to match object { label: 'Leave', …(2) }` — the row carried a proof again |
| `sign()`'s tightened driver-sourced predicate (reverted to the old non-null check) | `AssertionError: expected { type: 'compliance', …(1) } to be null` |

All three bit, and each failure named the site it came from. The third is the one
the weaker predicate actually accepted in production: `0` is not null, so a
licence block carrying id `0` passed the old check and went out scoped to a driver
that does not exist. All guards were restored and `grep -rn "PROBE" src/`
returned nothing.

*Scope caveat:* FM-EVID-021 is a single test covering four assertions across two
mint sites and two resolvers, so a single mutation surfaces as one failure rather
than a per-site count. The three probes above are what establish that each site is
independently load-bearing; the test alone does not show which one failed.

**Mutation check on the narration-guard lane** (2026-09-17, round 4) — the route
wiring was reverted to its pre-change form (the `withGuards` call dropped from the
answer assembly, everything else left in place) and the route suite re-run:

```
× FM-ROUTE-009 a GPS question on an inapplicable evaluation gains the server clause and keeps the prose
    → expected 'GPS status isn\'t supplied for this e…' to contain 'Live GPS was not part of this evaluat…'
    Received: "GPS status isn't supplied for this evaluation, so it's unknown - not offline or no signal."
× FM-ROUTE-009 several guards on one turn append together and are all recorded
    → expected 'Vehicle 99 is not something I can see…' to contain 'vehicle 99 is not in this evaluation'
  Test Files  1 failed (1)
       Tests  2 failed | 12 passed (14)
```

Exactly the two clause assertions failed, and the `Received` value is the live
model answer verbatim — the failure mode the probe observed on 2026-09-17
reproduced deterministically. The `Flagged` assertions in those same tests still
passed under the revert, because `guardLabels` reads the guard facts rather than
the assembled answer; the teeth are on the clause, which is the user-visible
defect. The wiring was restored and the file re-ran green.

**The `ailogs` write hazard, and its direct test** (2026-09-17, round 4). The
guards record a `Flagged` row when they fire, and `logAiRequest` swallows its own
errors — so with `DATABASE_URL` present in the shell, a test run would have
inserted **real rows into the production `ailogs` table**, against the standing
"do not alter production data" rule; without it, every guard test would warn
noisily instead. `vitest.config.mjs` loads no environment and no test mocked
`@/lib/ai/logger`, so both outcomes were live. The fix is one mock line in
`fleetmate-scenarios.test.js` (which also makes the flag assertable). Tested
directly rather than argued: the focused scope was run with `DATABASE_URL`
exported, and `ailogs` was `1230` rows / `max_log_id 1230` before and `1230` /
`1230` after, with zero `Flagged` rows.

*Concurrency caveat.* The working tree was being edited by another writer during
these runs — the assign route, `travel-signals.js` and the SEC-DISP-001 suite all
changed mid-session, and one focused run reported 12 failures that a re-run of the
identical command cleared. The way to read the numbers above is as the state of
the tree at the moment each command ran, not as a stable property of it. The four
SEC-DISP-001 failures in an early run were that: not caused by this change (no
import path exists from the assign route to anything group O touches), and gone by
the next full run without any action taken here.

Environment limits, stated plainly: the Vitest environment is `node` with **no
DOM** (no jsdom, no Testing Library), so no browser behaviour was observed. Live
end-to-end model prose was **not** evaluated — that needs a NextAuth session and
a provider call. Neither is reported as verified anywhere below.

## 4. Failure report — the defects this suite found, all fixed 2026-09-17

The two defects the suite was built to find. The third — introduced by the first
fix and caught reviewing the diff — is recorded with it under FM-EVID-012. The two
further residuals in the same proof path were fixed in §7 round 2, and the last
one — the fail-open in `resolveLeave` itself — in §7 round 3. Nothing found by
this suite remains open; what is still outstanding is manual browser acceptance
(§6), not a known defect.

### FM-EVID-012 — a leave-sourced driver block opened the wrong evidence family

**Severity: HIGH.** Classification **C + E** (projection/evidence contract
wiring). Owner: `src/lib/dispatch/evidence-contract.js` `proofTypeForRecovery`,
with `src/lib/dispatch/decision.js` supplying the value it read. **FIXED.**

- **Scenario.** A candidate is blocked with the reason *"Driver is on approved
  leave during this time."* The chat correctly says the pair cannot be assigned
  and offers *Pick an available driver*.
- **Expected.** The proof attached to that recovery action is `leave`, scoped to
  the driver, so the drawer opens the leave record the chat just cited.
- **Actual (before).** The proof type was `schedule_conflict`.
  `proofTypeForRecovery()` read `recovery.hint` — the **static template** from
  `recoveryForCheckId()` ("This driver is unavailable for the window…") — and
  never the check's own `message`, which is where the recorded reason actually
  lives. The leave mapping *is* correct; it was the wiring that never supplied
  that hint.
- **Why it mattered.** `schedule_conflict` resolves a **different record family**
  — overlapping `dispatchschedules` — which can legitimately come back *clear*.
  The drawer could therefore show the dispatcher a clear schedule snapshot for a
  driver the chat just said is on approved leave. That is a chat/evidence
  contradiction on the surface whose whole purpose is to prove the chat.
- **Fix applied.** `proofTypeForRecovery` tests the recorded `message` first and
  falls back to the hint — the only carrier an exclusion action has. A `leave`
  ref is also scoped to the **driver**, matching the leave clearance row.
- **Verified.** FM-EVID-012 (leave block → `leave`, driver-scoped, managing module
  *Attendance & Leave*) and a rewritten FM-EVID-013 (leave message → `leave`;
  rest-day message → `schedule_conflict`; message-less exclusion → classified from
  its hint; end-to-end rest-day pair stays in the schedule family).
- **Follow-on defect this fix introduced, and its fix (FM-EVID-014).** Scoping the
  ref to the driver is only sound where a driver is known. An **exclusion** row has
  none: `dispatch-radar.service.js` builds `none_reasons` from an INFEASIBLE pair
  as `{vehicle_id, reason}`, so `recoveryActionForExclusion` receives no
  `ctx.driverId` and leaves `id: null`. Before the FM-EVID-012 fix those rows never
  classified as `leave` at all, so the gap was unreachable; afterwards a leave
  *reason* on an exclusion began minting `{type: 'leave'}` with
  `driverId: null` — and `resolveLeave()` with a null driver matches no row and
  returns `{verdict: 'clear'}`, i.e. a drawer clearing a driver the chat just said
  is on leave. Same contradiction class, new door. **Fix applied:** `sign()` mints
  no ref for a **driver-sourced** block (`record: 'driver' | 'schedule'`) that has
  no id — not just `leave`. A probe with the guard disabled showed **three**
  families reaching it, each resolving a different wrong record: `leave`
  (no row → `clear`), `schedule_conflict` (`driver_id=$1 OR vehicle_id=$2`
  narrowing to a vehicle-only check) and `compliance` (the vehicle branch, so a
  licence problem reports registration/insurance). **Verified** by FM-EVID-014,
  which asserts all three families are withheld on an exclusion *and* all three
  still mint on a pair where the driver is known, plus the mutation check in §3.

### FM-DRAW-014 — a repositioning candidate showed GPS as *unknown* instead of *not applicable*

**Severity: MEDIUM–HIGH.** Classification **F + C** (UI rendering on a wrong
projection field). Owners: `src/components/reservations/evidence-drawer.jsx`
(`buildInspectorRows`), `src/lib/dispatch/evidence-contract.js`
(`attachClearanceProofs`) and `src/lib/dispatch/conversation.js` (which had no
way to carry the mode at all). **FIXED.**

- **Scenario.** A candidate with a preceding commitment — `dispatchContext.mode
  === 'REPOSITION'`, `liveLocationUsed: false`, `originType:
  'PREVIOUS_TRIP_DESTINATION'`.
- **Expected.** The GPS row reads **not applicable**: the mode is what excludes
  live location, so there is nothing missing.
- **Actual (before).** The row read **"GPS Health: Unknown"**.
  `buildInspectorRows` branched on `meta.horizon === 'REPOSITION'`, but
  `REPOSITION` is a `dispatchContext` **mode**, a separate taxonomy — a
  repositioning candidate's horizon is `NEAR_DISPATCH` or `LAST_MINUTE`. The
  branch was unreachable in production, so the intentional absence was narrated
  as missing evidence, which `LIVE_EVIDENCE_RULES` explicitly forbids ("Absence of
  gpsHealth on FUTURE, SAME_DAY or REPOSITION evaluations is intentional: do not
  describe it as missing evidence").
- **Why it mattered.** It is a small, systematic, *plausible* misread: the
  dispatcher sees a gap in the evidence where the system made a deliberate
  choice. It also meant the prompt rule and the drawer disagreed about the same
  fact.
- **Fix applied.** The mode is projected as a label (`dispatchMode`, beside the
  existing `gpsHealth` label — the raw `dispatchContext` and its siblings are
  still never projected) and carried into `clearanceMeta.mode`; the inspector
  tests **mode** and horizon independently, because each excludes live location
  for its own reason.
- **Verified.** FM-DRAW-014 asserts the row reads *Current GPS — Not applicable*,
  that the rendered drawer contains no *Unknown*, and that the same projection on
  an `IMMEDIATE` mode with no reading still reports *Unknown* (the mode decides,
  not the absence). FM-DRAW-003 now also covers the mode-only case directly, and
  FM-EVID-005 pins the exact `clearanceMeta` shape.

### `resolveLeave` answered *clear* to a question it was never able to ask

**Severity: MEDIUM–HIGH.** Classification **B** (deterministic service layer).
Owner: `src/services/evidence-resolve.service.js` `resolveLeave`, with
`src/lib/dispatch/evidence-contract.js` supplying the predicate both mint sites
now share. **FIXED 2026-09-17 (§7 round 3).** Regression: FM-EVID-021.

- **Scenario.** A leave clearance proof is resolved with no usable driver — the
  shape an **exclusion** row produces, and the shape the projection produces for
  any pair whose `driver_id` is absent.
- **Expected.** No claim. The check could not be performed, so it must not issue
  a statement in either direction.
- **Actual (before).** `{verdict: 'clear'}`. `resolveLeave` built
  `WHERE driver_id = $1` with a null/`0` driver, matched no row, and took its
  "no overlapping leave" branch — reporting a **clearance for a driver nobody
  looked up**, under a check the drawer renders as *verified*.
- **Why it mattered, and why it is not merely theoretical.** This is the last
  fail-open in the proof path, and it sits *behind* the FM-EVID-014 mint guard
  rather than beside it: the guard stops the Copilot path minting such a ref, but
  the resolver is still callable that way by any other caller, and a ref minted
  before the guard existed stays resolvable for its 15-minute TTL. The subtlety
  that made it survive earlier review is that the dangerous value is **`0`, not
  `null`** — `Number(null)` is `0` and `Number(undefined)` is `NaN`, and
  `conversation.js` coerces every projected `driver_id` that way. `0` passes a
  `!= null` check and is a *clean, valid* query, so nothing upstream looks wrong
  and nothing downstream errors: the wrong answer is well-formed.
- **Fix applied.** Two parts, because the bug had a definitional core. (a) A
  single exported predicate, `usableRecordIdentity(value)`, admits only a
  **positive safe integer** and returns `null` otherwise — covering `null`,
  `undefined`, `0`, `NaN`, negatives and non-integers in one place, so the mint
  sites and the resolver cannot drift apart about what an id is. (b)
  `resolveLeave` returns `{verdict: null, overlapsBooking: null}` for an unusable
  identity and **issues no query at all**; the leave-clearance mint guard and the
  recovery-path guard both read the same predicate, which also tightened the
  latter — it previously accepted `0` because it only tested non-null and
  safe-integer.
- **Verified.** FM-EVID-021, in both directions and at both sites: the clearance
  row is present with `proof: null` while its sibling stays intact; resolving a
  hand-minted null-driver ref returns no claim and the SQL assertion
  (`calls.filter(...)`) is **empty**, proving no query was issued rather than that
  a query happened to miss; a real driver with no overlapping leave is still
  reported `clear` **and** still issues exactly one query, so the guard does not
  swallow the legitimate answer; and a driver-sourced block carrying id `0` now
  mints no recovery proof. Confirmed to bite by disabling each of the three sites
  in turn (§3).



### Lower-severity findings — both addressed

- **`recoveryForCheckId('schedule')` is driver-only (LOW, latent) — documented.**
  It always returns `DRIVER_UNAVAILABLE` / *Pick an available driver*, so a
  **vehicle-sourced** schedule block would be mislabelled. `conflicts.js:592` does
  group four conflict types into the check, but the two vehicle-sourced ones are
  removed upstream: the SQL pre-filter in `fetchCandidates` (they surface as
  prefiltered exclusions instead) and `_schedule_load > 0` skipped in
  `pair-scoring.js`. Rather than invent a prose heuristic — `recoveryActionForCheck`
  is explicitly forbidden from classifying by display text — the dependency is now
  documented at the mapping and frozen by FM-VEH-007, so widening either filter
  fails the suite instead of silently mislabelling.
- **Single-option fallback wording (LOW, cosmetic) — fixed.** `rankDispatchPairs`
  gave a lone option `code: 'ONLY_OPTION'` / `label: 'Only evaluated option'` but
  the explanation was the generic *"Compare the current evidence before
  choosing."* — which asked for a comparison that could not be made. It now reads
  *"This is the only evaluated option, so there is nothing to compare it
  against."*; the generic sentence is retained for the multi-pair fallback path it
  was written for. FM-RANK-010 pins the new sentence.
- **`nextBoundaryAt: null` for `OVERDUE` (observation, not a defect).** The
  contract reports null rather than inventing a boundary, and `evidenceExpired`
  skips nulls. Honest; recorded so it is not mistaken for a regression.

## 5. Coverage and gaps

**Verified in this environment**

- Every verify-order step in the task: new suite → existing dispatch/ranking →
  copilot/prompt → evidence contract → drawer → the combined dispatch/copilot
  run → lint → build. Re-run in full after the §7 round-1 fixes, and again after
  round 2, plus the whole repo suite (1809 tests, 168 files).
- The deterministic decision, the projection, the evidence contract, the route's
  server-owned response fields, and the drawer's *rendered* structure.

**NOT verified — no claim is made**

1. **Browser interaction.** No DOM in this environment. Fetch-once-per-open,
   no-refetch-on-plan-validation, tap-to-open a row proof, keyboard/focus
   behaviour and responsive layout are **structurally** covered only
   (`evidence-drawer.test.js` asserts effect dependencies and static markup).
   Marked PENDING; see §6.
2. **Live model prose.** Injecting the prompt against a real provider requires a
   NextAuth session plus a provider call; only `GEMINI_API_KEY` is configured
   locally and provider resolution also consults the `aiproviders` table. The
   suite therefore proves what the model is *given* and *allowed* to say (the
   exact grounding payload + the prompt contract), never what it actually said.
   The task's section 9 and 11 requirements about prose are covered at the
   contract layer only.
3. **Live data.** Read-only by instruction — no live reservation was evaluated
   against the real database, so the scenario fixtures reproduce the engine's
   output *shape* rather than observed production values.
4. **`resolveEvidence` cannot inject comparison deps.** The generic resolver
   calls `resolver(store, {...refData, ...ctx})` with two arguments, so the
   comparison resolver's injectable `deps` cannot be threaded through it. Group K
   calls `resolveComparison` directly with injected deps. **Test-infrastructure
   limitation (G)**, not a product defect — the production path passes real
   dependencies inside the service.

## 6. Manual browser acceptance checklist — PENDING

None of these were observed. Each needs a real browser against a running app.
Items 5 and 6 are the round-1 fixed defects, item 9 the round-2 ones and item 10
the round-3 one: the fix is proven at the projection and render layers by the
suite, but **no browser has confirmed the change on screen**, so they stay on this
list.

1. Open a reservation with ≥2 eligible options; open the Evidence Drawer from an
   option row. **One** network request per proof row; reopening the same row does
   **not** re-fetch.
2. Analyse a queue plan (which changes the lane assignment) and reopen the
   drawer: the snapshot facts are unchanged and the *"Conditions have changed
   since this evidence was checked"* warning appears. The drawer does not
   silently re-fetch on plan validation.
3. Tap a row with a proof: it opens read-only, shows the title, managing module
   and `checkedAt`, and offers no control that could mutate the record.
4. Row with no proof (Request requirements, Service-window maintenance, Blocking
   incident check, Requested vehicle class, Current GPS): label and state still
   render, no Review action.
5. **Repositioning candidate (the FM-DRAW-014 check).** The GPS row must read
   *Current GPS — Not applicable*, and the panel must contain no *Unknown*. Both
   are asserted at the render layer (FM-DRAW-014); confirm on screen.
6. **Leave-blocked candidate (the FM-EVID-012 check).** The drawer must open a
   **leave** snapshot — title *Leave Evidence*, managing module *Attendance &
   Leave* — matching the chat's *"Driver is on approved leave"*, not a
   schedule-overlap snapshot. Asserted at the contract layer (FM-EVID-012);
   confirm the drill-down resolves it against a real leave row.
7. Ask FleetMate the same question in three phrasings, including one in
   Filipino/Taglish, with the provider live: same conclusion, English, no
   Markdown, 2–4 sentences.
8. Immediate-horizon candidate with a qualified GPS fix: the row reads the health
   label, never a distance or coordinate; a `Delayed`/`Offline` pair is never
   narrated as live.
9. **Licence and pairing proofs (the round-2 checks).** For a licence block
   (*"Driver license is expired."*), the drawer must show the **driver's** licence
   row — not the vehicle's registration/insurance. For a pair whose pairing was
   never evaluated, the *Pairing Evidence* drawer must show *—* for Pairing and
   Result, with no *none* and no *Blocking*, and must print no driver name. Both
   are asserted at the contract and render layers (FM-EVID-015…018, and the
   `evidence-drawer.test.js` pairing case); confirm on screen. An existing proof
   opened across the deploy may read *"This evidence is out of date. Ask Copilot
   again for fresh evidence."* — expected once, for refs minted before the
   `subject` field existed.
10. **Leave clearance with no claim (the round-3 check).** A leave proof the
    system cannot evaluate — no usable driver identity — must render **—** in the
    *Leave Evidence* drawer and must **not** render *Clear*. This is the same *—*
    rendering item 9 checks for pairing, reached through a different resolver. It
    is asserted at the contract and resolver layers (FM-EVID-021), and it is the
    one item here that needs a ref deliberately constructed rather than merely
    navigated to: no ordinary pair path produces a leave ref without a driver,
    because the guard now withholds one. Confirm the *—* rendering on an existing
    leave proof opened across the deploy, if one is still within its TTL.

## 7. Remediation plan — APPLIED 2026-09-17

### Round 1 — the failure report

Proposed from the failure report, approved, then applied in the order below. Each
item's verification is in §4.

1. **FM-EVID-012 (HIGH) — applied.** `proofTypeForRecovery` now classifies from
   the recorded check `message`, falling back to the template hint; the `leave`
   ref is scoped to the driver. Regression coverage: FM-EVID-012 plus a rewritten
   FM-EVID-013 that pins the classification in both directions. *Follow-on:* the
   driver scoping opened a null-driver exclusion path (a driver-sourced block on
   an exclusion has no driver to scope to, and each family answers `clear` from a
   different wrong record). Not anticipated by this plan — found reviewing the
   diff — and closed in the same file by withholding the ref from any
   driver-sourced block with no id; FM-EVID-014 covers all three families. *Not
   done:* the read-only check against a live leave row — no live data was touched
   (the contract-level assertion covers the ref, not a real record).
2. **FM-DRAW-014 (MEDIUM–HIGH) — applied.** `dispatchContext.mode` is projected
   as the `dispatchMode` label and carried into `clearanceMeta.mode`;
   `buildInspectorRows` tests the **mode** and the horizon independently. No new
   copy was needed — the drawer already had *Current GPS / Not applicable*.
3. **`recoveryForCheckId('schedule')` (LOW, latent) — applied as documentation.**
   The invariant is stated at the mapping with both filters named, and FM-VEH-007
   freezes it. The alternative (sourcing the record from the check's own detail)
   would have meant widening the projection to carry conflict types, which is a
   larger surface than a LOW finding warrants — and `recoveryActionForCheck` is
   deliberately forbidden from classifying by display prose.
4. **Single-option explanation copy (LOW, cosmetic) — applied.** A lone option
   now reads *"This is the only evaluated option, so there is nothing to compare
   it against."*; the generic sentence is kept for the multi-pair fallback.

Files changed by round 1: `src/lib/dispatch/evidence-contract.js`,
`src/lib/dispatch/conversation.js`, `src/lib/dispatch/decision.js`,
`src/lib/dispatch/recommendation-ranking.js`,
`src/components/reservations/evidence-drawer.jsx`, plus five assertions inside
this suite (FM-EVID-005/012/013/014, FM-DRAW-003/014, FM-RANK-010). No schema
change, no migration, no dependency added, no commit.

### Round 2 — the proof-subject lane

Proposed from the two residuals round 1 named, approved, then applied. The two
shared one root cause, so they were fixed together: **a signed ref carried *who*
it was about and *what family* to read, but never *which of the two identities the
claim was scoped to*** — so the resolver inferred it, and the inference was
vehicle-first.

5. **`resolveCompliance` vehicle-first (HIGH) — applied.** The ref now carries a
   validated `subject: 'vehicle' | 'driver'` (`COMPLIANCE_SUBJECT_BY_CHECK` /
   `COMPLIANCE_SUBJECT_BY_CODE`, one definition read by both mint sites and the
   resolver), and `resolveCompliance` branches on it. `sign()` also stops
   recording the *vehicle* as the record for a licence block — its `recordId` is
   now the driver. A subjectless ref (minted before the field existed) is refused
   with `UNSCOPED` → 404 rather than guessed at; the 15-minute TTL clears it on
   the next Copilot run, so no in-flight ref needs migrating.
6. **Pairing identity (MEDIUM) — applied.** `sign()` takes a pairing ref's driver
   from the pair (`pairCtx.driverId`), never from `action.id`, which for a pairing
   action holds the vehicle; `resolvePairing` returns `{verdict: null,
   pairingState: null}` for a null driver (the `resolveGps` posture) instead of
   asserting `pairingState: 'none'`. `decision.js` was deliberately **not**
   touched: its `record: 'schedule'` value drives fix ordering and navigation
   through `RECOVERY_RECORDS`, and changing it would send the *Check substitute
   schedule* button somewhere other than the vehicle record its label promises.
   The FM-EVID-014 mint guard was made identity-aware rather than exempting
   pairing, so a pairing action with no vehicle identity still mints nothing.

Files changed by round 2: `src/lib/dispatch/evidence-contract.js`,
`src/services/evidence-resolve.service.js`,
`src/app/api/integration/transport-requests/[id]/evidence/route.js`, plus six new
assertions in this suite (FM-EVID-015…020) and one rendering assertion added to
the pre-existing `src/components/reservations/evidence-drawer.test.js`. No schema
change, no migration, no dependency added, no commit.

### Round 3 — the last fail-open

Proposed from the single residual rounds 1 and 2 left open, approved, then
applied. Round 2 had already established the posture this needed — *no usable
identity, no claim* — so this was the same decision applied to the one resolver
that had not yet adopted it, plus the predicate that makes "usable identity" mean
one thing everywhere.

7. **`resolveLeave` failing open (MEDIUM–HIGH, classified B) — applied.** With no
   usable driver it returned `{verdict: 'clear'}` from an empty result set — a
   clearance for a driver nobody looked up. The fix was definitional before it was
   behavioural: the projection coerces ids with `Number()`, so an absent driver
   arrives as **`0`**, which passes a `!= null` check and queries cleanly. A new
   exported predicate `usableRecordIdentity(value)` admits only a **positive safe
   integer**, and all three sites read it — the leave-clearance mint, the
   recovery-path guard in `sign()`, and `resolveLeave` itself, which now returns
   `{verdict: null, overlapsBooking: null}` and issues no query. The recovery-path
   guard was **tightened** as a side effect: it previously accepted `0` because it
   tested only non-null and safe-integer, so a licence block carrying id `0` went
   out scoped to a driver that does not exist. Regression: FM-EVID-021, covering
   both mint sites and both directions, and confirmed to bite at each of the three
   sites in turn (§3).

Files changed by round 3: `src/lib/dispatch/evidence-contract.js`,
`src/services/evidence-resolve.service.js`, plus FM-EVID-021 in this suite. No
schema change, no migration, no dependency added, no production data touched, no
commit.

### Round 5 — the volunteered-claim guards and the scope sentence (2026-09-18)

Round 4 added a group rather than a list of fixes, so it is written up in §2 and
§3 (the mutation check and the `ailogs` hazard) instead of here. Round 5 is a fix
list, and it is the first round whose subject is the model's **output** rather
than its instructions.

1. **A claim the model volunteers — applied.** Cases 17 and 18 raise no topic at
   all, and the model volunteered a GPS misread and a rate on both live runs, with
   no guard in a position to notice because every guard was keyed on the question.
   `narrationGuards()` now takes the model's raw prose as an optional third field
   and two guards read it: `volunteeredRate` and `volunteeredLocation`, each gated
   on its question-side counterpart being false so a turn never states the same
   sentence twice. `guardDisclosure` gained **no new wording** — both triggers
   emit the existing `probabilitySought` / `gpsNotApplicable` sentences, which
   FM-GUARD-007 already proves satisfy the group M honesty predicates, so the
   reused text is re-proven rather than assumed clean. The prose passed in is the
   model's own, never the assembled answer, or the server's appended coverage
   sentence could trip the location detector.
2. **A claim from a refusal — applied, and it is the whole difficulty.** "I can't
   give a success probability" carries the banned token and is *compliance*, so
   neither guard can be a bare regex. The matcher that tells a claim from a
   refusal already existed inside `scripts/fleetmate-live-probe.mjs`
   (`NEGATION`, `CLAUSE_BOUNDARY`, `clauseHead()`, `forbidMatch()`); it was
   **extracted, not reimplemented**, into `src/lib/dispatch/clause-polarity.js` as
   `assertionMatches`, and the probe now imports it. Two copies of one honesty
   rule drift — and here they would have drifted between a guard and the predicate
   that judges it.
3. **The prompt boundary — applied as defense in depth.** One sentence inside
   `EVIDENCE_TRUST_RULES` states that the copilot covers dispatch work only, and
   states *both* directions of the failure: an unrelated subject is declined
   rather than answered from general knowledge, but an in-scope question the
   evidence cannot cover is answered by naming what is missing. The sentence
   remains inside the existing ten-block prompt contract. The deterministic
   route boundary and its context rules are documented in Round 6 below.
4. **The probe extended to measure it — applied.** Three cases (19–21): two
   unrelated requests that must be declined, and one in-scope question with no
   dispatch vocabulary that must **still** be answered. Case 21 is the one that
   matters most, because over-refusal is the failure a scope rule invites and it
   fails silently. Its predicate was corrected *before* the run: the first draft
   reused the blocked-conclusion pattern, whose `cannot` alternative meant a bare
   refusal counted as reaching a conclusion, so a total refusal would have passed
   the test written to catch it.

Files changed by round 5: `src/lib/dispatch/clause-polarity.js` (**new**),
`src/lib/dispatch/narration-guards.js`,
`src/app/api/integration/transport-requests/[id]/conversation/route.js` (two lines
reordered, one argument), `src/lib/dispatch/copilot-prompt.js` (one sentence), plus
one new test file and additive tests in three existing ones, plus
`scripts/fleetmate-live-probe.mjs`. No schema change, no migration, no dependency
added, no production data touched, no commit.

### Round 6 — deterministic FleetMate scope gate (2026-09-18)

The former prompt-only scope boundary is now enforced at the conversation route
edge. `classifyCopilotScope()` separates courtesy, out-of-scope and in-scope
messages; a short follow-up inherits context only from a recent in-scope
FleetOps turn or active reservation/recommendation review. An unrelated or
neutral non-FleetOps turn resets that context and blocks the active-context
fallback. Courtesy and unrelated requests return `scope-only` before
request loading, evidence preparation, or provider work. The response is
conversational only: it carries no replacement options, selection, plan state or
evidence, so the panel's existing dispatcher state remains untouched. Scope is
routing only and never supplies operational truth.

Added regression coverage for the approved boundaries: `Hi`, `Thanks`, and
`Recommend a movie`; contextual `Why?`/`What changed?`; out-of-scope context
reset and explicit FleetOps recovery; ETA/weather, coding-help and movie-studio
passenger cases; exact redirect text; provider/evidence short-circuiting; and
the UI guarantee that a `scope-only` reply does not replace options or a
selected review.

Verification: the focused scope suite and the broader FleetMate regression run
pass **37 files / 612 tests**; touched-source ESLint is clean. No live
assignment, reservation mutation, schema change, migration or dependency was
introduced.

**Nothing this suite found remains open.** The one item still listed below is a
limitation of the test harness, not a defect.

- `resolveEvidence` passes only two arguments, so a resolver that declares
  injectable dependencies cannot be exercised through it (see §5.4). Classified
  **G (test infrastructure)**, and unchanged by round 3 — the production path
  passes real dependencies inside the service.

One further observation, carried forward rather than fixed because no approved
plan covers it and its impact is a narrowing rather than a false claim: the
`schedule_conflict` clearance row can still silently narrow to a vehicle-only
check when the driver is unusable, since `resolveScheduleConflict` matches
`driver_id=$1 OR vehicle_id=$2` and a `0` driver simply never matches. The leaves
side of that shape is closed; this one would need the same predicate applied to a
resolver that has two legitimate identities, which is a different question from
the one round 3 answered.

## Related

[[AI Advisory]] · [[Dispatch Copilot Scope and Conversation Audit]] · [[Bugs]] ·
[[Technical Debt]] · [[Testing]]
