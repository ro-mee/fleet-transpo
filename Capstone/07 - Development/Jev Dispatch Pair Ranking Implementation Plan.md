---
type: implementation-plan
status: in-progress
created: 2026-09-19
related: ["[[AI Advisory]]", "[[AI Architecture]]", "[[Dispatch]]", "[[Dispatch Copilot Decision Support Enhancement Plan]]", "[[ADR-003 Deterministic AI]]"]
---

# FleetMate Wording, Jev Dispatch Copilot Guardrail, and Pair Ranking Implementation Plan

## Implementation record — 2026-09-19

Track 0 (FleetMate Response Wording Library and concise response shell) is implemented locally. The conversation prompt now prioritizes answer-first dispatcher language, distinguishes hard conflicts from pending verification, handles unselected/tied options without inventing a ranking reason, and replaces internal terms such as usable slack and service-date workload. The deterministic evidence fallback now uses friendly option names, status/reason/next-step wording, and a clear no-selection response. Provider-generated choice prompts are removed server-side because the interface owns that prompt. Pair-ranking order and radar validation remain unchanged; only the explanatory tie wording was clarified.

Verification: five focused suites passed, 83 tests total (`conversation`, `copilot-prompt`, `fleetmate-ranking`, conversation route, and FleetMate scenario route); touched-source ESLint passed with zero warnings. Live-provider wording and browser acceptance remain pending.

## Decision

Do not replace either module completely.

- Keep `src/services/dispatch-radar.service.js`. It is the evidence and safety boundary for route feasibility, GPS freshness, schedule conflicts, turnaround, readiness, and assignment-time validation.
- Keep the hard eligibility and pairing logic in `src/lib/ai/pair-scoring.js`: designated-driver rules, substitutes, availability, compliance, and candidate construction must remain server-owned.
- Replace only the soft Option 1/Option 2 ranking boundary. The correct existing seam is `src/lib/dispatch/recommendation-ranking.js`, especially `rankDispatchPairs()` and `comparePairEvidence()`.
- For pair ranking, Jev may become the primary ranker after rollout. The current evidence-based ranker remains the validated fallback until Jev proves reliable in shadow mode.
- For Dispatch Copilot, the first Jev use case is response verification and guardrails, not ranking replacement.
- The first implementation slice is a FleetMate Response Wording Library and concise server-generated response shell. It improves usefulness without adding a model dependency.

The goal is to correct inaccurate pair ordering without weakening the rules that decide which pairs are allowed to compete.

## Current flow

```text
prepareDispatchRecommendation()
  -> buildFleetPairRecommendations()
  -> pair-scoring.js creates eligible pairs and legacy score
  -> applyDispatchRadar()
  -> radar evaluates route, GPS, schedule, conflicts and readiness
  -> recommendation-ranking.js orders candidates
  -> recommendation snapshot / UI Option 1 and Option 2
  -> assignment endpoint revalidates the selected pair
```

`dispatch-radar.service.js` must remain in this flow. Jev must not receive unverified candidates and must not perform assignment validation.

## FleetMate response flow

```text
verified server evidence
  -> server chooses status, key facts and next step
  -> FleetMate adds one short explanation when useful
  -> existing deterministic narration guards
  -> Jev verifier in a later rollout phase
  -> dispatcher
```

The response shell is the source of truth for status and facts. FleetMate must not decide which checks matter, invent a ranking reason, or turn unknown evidence into a positive or negative claim.

## FleetMate Response Wording Library

### Voice contract

FleetMate should sound like an experienced dispatcher helping another dispatcher: calm, concise, practical, and confident without sounding absolute.

Most replies follow:

```text
answer -> decisive reason -> optional next step
```

Target length is two or three short sentences, or a short status block with one explanation. The first sentence must answer the actual question.

Prefer normal dispatcher language:

| Internal wording | FleetMate wording |
|---|---|
| candidate pair | option / driver and vehicle |
| evaluation | latest check |
| server evidence | verified system data / latest records |
| temporal horizon | future booking / booking timing |
| usable slack | preparation time |
| reliability band | timing situation |
| workload evidence | workload for this date |
| blocking finding | blocker |
| prefiltered | checked briefly |
| insufficient data | I can't verify that yet |
| resolved | still available |
| missing | no longer available in the latest check |
| rerank | update the recommendation |
| mutation | assignment / change |

Never expose field names, JSON keys, decision codes, ranking codes, implementation terms, model terms, or internal evidence labels. Do not narrate every check; explain only the one or two facts that materially answer the question.

### Required wording rules

- Use **“No hard conflict found”** only for the hard-conflict result. It does not mean the option is ready.
- If timing, GPS, route, or another required check is unknown, say **“Needs verification”** and name the missing check.
- Use “ready” only when the server marks the option ready for review. Never use “safe” as a substitute for readiness.
- If both options have no meaningful advantage, say **“No clear advantage was verified”** or **“Both options are workable”**. Do not invent a ranking reason.
- If no option has been selected, say so explicitly. A generic “Why this pair?” may explain Option 1, but must also disclose that the user has not selected it and summarize the alternative.
- For future bookings, mention once when useful that planning records—not the driver's current location—drive the recommendation.
- Never describe an eligible option as assigned or claim success until the server confirms the assignment mutation.
- Give a next step only when it helps the dispatcher act.

### Library categories

The full wording library should cover the supplied response set without putting all 50 exact responses into one prompt:

1. recommendation discovery and equal-options responses;
2. “why this option?” reasons for timing, efficiency, workload, and designated pairing;
3. future versus immediate booking and GPS uncertainty;
4. exclusions, blockers, capacity, pairing, compliance, and schedule issues;
5. travel and turnaround uncertainty;
6. no-option and limited-evaluation coverage;
7. selection, recheck, stale evidence, and changed recommendation;
8. assignment status and permission copy;
9. incident suggestions and prompt-injection refusals.

Exact safety, status, assignment, and blocker strings should be deterministic templates. The language model may add a short explanation only after the server selects the relevant wording pattern.

### Canonical examples

For a selected option:

```text
Option 2 — ABC-1234 with Karlo Rafael
Status: Needs verification

No hard conflict found. Duty, leave, schedule, maintenance, and incident checks passed, but pickup timing still needs verification.
Next step: Verify departure positioning, then recheck the request.
```

For an unselected recommendation:

```text
You have not selected an option yet.

Option 1 is listed first, but no clear advantage over Option 2 was verified. Both options passed the required checks, but both still need timing verification.

Choose Option 1 or Option 2.
```

The exact facts and reason must be generated from the current evidence; these examples are wording shapes, not hard-coded data.

## Jev roles in Dispatch Copilot

The strongest first integration is to use Jev as a typed verifier around FleetMate, while keeping the deterministic Fleet Engine as the source of truth.

| Use case | Role | Priority |
|---|---|---|
| FleetMate response verification | Detect claims unsupported by `serverEvidence` | Highest |
| Prompt-injection screening | Supplemental classification for ambiguous or suspicious input | Additional guard |
| Intent routing | Classify only low-confidence or unknown requests | Later optimization |
| Incident classification | Suggest a category for driver confirmation | Strong second use case |
| Pair ranking | Rank already-verified dispatch pairs | Separate validated track |

### Response-verification flow

```text
serverEvidence
  -> FleetMate generates an explanation
  -> existing deterministic narration guards
  -> Jev verifies remaining claims
  -> PASS -> dispatcher
  -> REVIEW/REJECT -> deterministic fallback or one controlled retry
```

Jev must never override a deterministic server finding. Existing guards such as `narration-guards.js`, `clause-polarity.js`, the evidence-only fallback, and route-edge scope checks remain the first line of defense. Jev catches residual or novel unsupported claims; it does not replace those rules.

### Response-verification contract

The verifier receives a minimal, server-built evidence projection and the FleetMate answer. It must not receive client-provided scores, permissions, or mutable assignment commands.

```js
{
  verdict: "PASS" | "REVIEW" | "REJECT",
  unsupportedClaims: [
    {
      claim: "Driver Marco has fresh GPS",
      evidenceRefs: ["pairs[0].gpsHealth"],
      severity: "high"
    }
  ],
  modelVersion: "..."
}
```

The server validates evidence references and treats Jev's confidence, if returned, as an internal routing signal only. It must not appear as safety confidence or probability in the Copilot UI.

### Copilot input and intent guardrails

```text
user message
  -> deterministic scope, permission and mutation gate
  -> existing intent classifier
  -> Jev only for ambiguous/unknown input
  -> FleetMate or deterministic evidence response
```

Jev may classify `SAFE_REQUEST`, `OPERATIONAL_QUESTION`, `SIMULATION`, `MUTATION_ATTEMPT`, `PROMPT_INJECTION`, or `DATA_EXFILTRATION_ATTEMPT`, but the server still owns authorization, evidence loading, and all mutations. Do not add a Jev call to every Copilot message unless workload measurements justify it.

### Incident classification flow

```text
driver description
  -> deterministic emergency/safety check
  -> Jev suggests incident category
  -> driver confirms or corrects it
  -> existing incident, maintenance and grounding rules
```

Jev must not ground a vehicle or create a maintenance action directly. Critical safety markers must take the immediate deterministic path even when Jev is unavailable. Suggested classifications are user-confirmed and auditable with the original description and model version.

## Target flow

```text
pair-scoring.js
  -> hard eligibility and valid candidate construction only

dispatch-radar.service.js
  -> verified route, GPS, schedule, conflict and readiness evidence

Jev pair ranker
  -> ranks only radar-eligible candidates into Option 1 / Option 2

server result
  -> validates Jev output and maps reason codes to verified evidence

snapshot / UI
  -> stores ranking source and model version

assignment
  -> existing live radar revalidation and database conflict guard
```

## Scope

### Included

- FleetMate wording library, response states, and concise response shell.
- Replace the final soft ranking decision for valid vehicle-driver pairs.
- Preserve hard blocks and all current radar evidence.
- Preserve human confirmation, signed review state, assignment revalidation, and the database overlap guard.
- Keep a deterministic fallback for Jev timeout, provider failure, malformed output, unknown pair IDs, or incomplete input.
- Record enough metadata to explain whether Option 1/Option 2 came from Jev or the fallback.

### Excluded

- A single prompt containing all wording-library entries.
- Replacing `dispatch-radar.service.js`.
- Letting Jev create, modify, or commit a dispatch.
- Letting Jev bypass schedule, leave, licensing, vehicle, pairing, or route checks.
- Reusing `src/lib/ai/llm-adapter.js` for typed ranking; that adapter is for optional prose narration.
- Adding a new optimizer, fleet-wide assignment engine, routing matrix, or database table.
- Showing a model-generated number as safety confidence.

## Implementation tracks

### Track 0 — FleetMate Response Wording Library and concise response shell (first)

#### Phase W0 — Inventory the current response contract

1. Audit `src/lib/dispatch/conversation.js`, `src/app/api/integration/transport-requests/[id]/conversation/route.js`, `src/lib/dispatch/copilot-prompt.js`, and the current Copilot component for every response path.
2. Identify which replies are deterministic fallbacks, which are provider narration, and which are assignment/status UI copy.
3. Preserve the existing conversation response shape. Do not add a new response field only to carry wording metadata in this phase.
4. Capture baselines for the two reported cases: selected Option 2 with timing pending, and “Why this pair?” before a selection.

Acceptance:

- Every response path has one clear owner for status, facts, explanation, and next step.
- The existing evidence-only fallback remains available without an AI provider.
- No assignment or safety decision depends on generated wording.

#### Phase W1 — Implement the wording library as evidence-gated patterns

1. Map the supplied library into intent/state patterns rather than one large prompt block.
2. Reuse the existing deterministic fallback and evidence helpers before adding a new response module. Add one shared pure formatter only if the existing helpers cannot express the new structure.
3. Define the status vocabulary internally: checking, ready for review, needs verification, blocked, no eligible option, stale, and no clear advantage.
4. For each pattern, define required evidence, forbidden claims, and the allowed next step.
5. Add the explicit no-selection and tie/no-material-advantage patterns.
6. Keep Evidence Drawer wording formal and bounded; keep FleetMate chat natural and short while expressing the same facts.

Required evidence gates include:

- timing wording only when the ranking evidence identifies timing as decisive;
- workload wording only when the service-date workload evidence is complete;
- current-location wording only for an immediate/repositioning context with usable GPS;
- designated-driver wording only when the pairing is verified;
- ready wording only when readiness is verified;
- substitute wording that does not incorrectly exclude a vehicle that has a valid dated substitute.

#### Phase W2 — Build the deterministic response shell

1. Compose each operational answer in this order: answer/status, one or two material facts, optional short explanation, next step.
2. Keep status and facts server-generated. Use the language model only for the short explanation on the narrated path.
3. On provider failure, timeout, malformed output, or a guard finding, return the concise evidence-only version instead of a long generic apology.
4. Cap the explanation to one or two short sentences and remove duplicated facts already shown in the status block.
5. Do not use “safe,” “all clear,” “fully available,” or “assigned” unless the corresponding server state supports that exact claim.

#### Phase W3 — Update the FleetMate prompt

1. Add the voice contract to the existing prompt owner, `copilot-prompt.js`.
2. Pass the selected wording pattern or decisive reason to FleetMate instead of embedding all 50 library entries in every request.
3. Require the model to answer the question first, use only one or two supplied facts, and add a next step only when useful.
4. Instruct the model to use normal dispatcher language and silently apply limitations unless the limitation answers the question.
5. Keep prompt instructions as defense in depth; server templates and evidence gates remain authoritative.

#### Phase W4 — Verify and roll out the wording change

Automated checks must cover:

- selected Option 2 with no hard conflict but timing pending;
- no selected option asking “Why this pair?”;
- two options with no material advantage;
- timing, efficiency, workload, and designated-pair explanations;
- future booking with no GPS claim;
- immediate booking with stale or absent GPS;
- no option, limited evaluation, stale evidence, and changed recommendation;
- assignment permission, 409 conditions changed, uncertain assignment result, and completed/active/cancelled states;
- absence of internal terms and unsupported readiness claims;
- provider failure and deterministic fallback.

Manual acceptance must confirm that a dispatcher can scan the answer in a few seconds, identify the current status, understand why, and know the next action on desktop and mobile.

Only after this track passes should the Jev response verifier be enabled. Jev should verify the short explanation, not replace the deterministic response shell.

### Track A — Dispatch Copilot guardrails (after Track 0)

#### Phase A0 — Establish the deterministic baseline

1. Reuse the current `narration-guards.js`, `clause-polarity.js`, `copilot-intents.js`, scope classifier, evidence projection, and deterministic fallback.
2. Identify which claims are already covered and which residual claim types are suitable for Jev review.
3. Keep deterministic fallback responses out of the Jev verification path unless a test demonstrates a real need; they are already assembled from server evidence.

Acceptance:

- An unsupported GPS claim is rejected even if Jev incorrectly returns `PASS` when a deterministic guard catches it.
- A valid evidence-only answer remains available with Jev disabled.
- Assignment, data access, and mutation permissions do not depend on Jev output.

#### Phase A1 — Add the response verifier

1. Add a server-only Jev verifier at the existing conversation response boundary after FleetMate returns and after deterministic guards run.
2. Pass only the normalized evidence projection and generated answer; never pass unrestricted database rows or exact private coordinates unless the existing route is authorized to use them.
3. Require the typed `PASS` / `REVIEW` / `REJECT` contract and validate every returned evidence reference.
4. On `REVIEW` or `REJECT`, return the deterministic evidence-only fallback by default. Allow at most one controlled regeneration only for a non-critical response, with a server-owned retry budget.
5. For assignment, safety, availability, GPS, ETA, or permission claims, an unsupported claim must not reach the dispatcher as an accepted answer.
6. Log verifier metadata through the existing AI logging path without logging private exact locations or unnecessary personal data.

Tests must cover supported claims, absent GPS, scheduled trips where GPS is inapplicable, stale evidence, contradicted availability, absent entities, fabricated IDs, injected instructions, malformed Jev output, timeout, provider failure, and deterministic fallback.

#### Phase A2 — Add ambiguous-input screening and intent routing

1. Keep the deterministic scope and intent classifier as the first gate.
2. Invoke Jev only when the existing classifier returns unknown or low-confidence input.
3. Map Jev output to an allowlisted intent enum before selecting evidence or a response path.
4. Route mutation-like, data-exfiltration, or prompt-injection input to the existing safe refusal/manual path; Jev must never authorize the request.
5. Measure added latency and provider calls before considering Jev for all messages.

#### Phase A3 — Add incident-category suggestion

1. Integrate with the existing driver incident route and incident domain rules, including `maintenance.js`, `grounding.js`, and resolution workflows.
2. Send only the driver's description and allowed incident context to Jev.
3. Show the result as `Suggested category`, never as a committed classification.
4. Require driver confirmation or dispatcher correction before saving the category.
5. Preserve the deterministic emergency path for brake, steering, fire, collision, or equivalent high-risk terms when Jev is unavailable or uncertain.

#### Phase A4 — Guardrail rollout gate

Enable the verifier only after:

- deterministic guards still veto Jev mistakes;
- fallback and timeout behavior are proven;
- no private evidence leaks into prompts or logs;
- no assignment or grounding mutation depends on Jev;
- adversarial scenario tests pass;
- measured latency and provider cost are acceptable for the actual workload.

### Track B — Pair ranking (separate validated track)

#### Phase 0 — Baseline and candidate coverage

1. Capture the current top-two order from `rankDispatchPairs()` for representative requests.
2. Verify that the candidates passed to Jev are the complete radar-evaluated pool, not an accidentally truncated pool created by legacy scoring or distance filtering. A ranker cannot select a pair that was never given to it.
3. Record current fallback reasons, hard exclusions, feasibility verdicts, and dispatcher overrides for the test set.
4. Add or extend focused tests before changing ranking behavior.

Acceptance:

- The baseline output is reproducible for the same evidence.
- Every candidate removed before Jev has a server-owned exclusion reason.
- Existing hard-rule and radar tests pass before implementation begins.

#### Phase 1 — Define the Jev contract

Create a server-only typed request from verified facts. Do not pass the legacy heuristic score as an input because that would reproduce the suspected bad signal.

Minimum input fields:

- request service window, horizon, pickup/drop-off context, capacity and policy version;
- pair identity, vehicle/driver pairing type, and hard-rule pass state;
- radar reliability band and feasibility verdict;
- routed travel/deadhead minutes with provenance, usable schedule slack, and next-booking impact;
- schedule, leave, duty and workload evidence;
- verified advisories and missing-check indicators.

Jev may return only typed ranking data:

```js
{
  orderedPairIds: ["vehicleId:driverId", "vehicleId:driverId"],
  winner: "option_1" | "option_2" | "tie" | "manual_review",
  reasonCodes: ["RELIABILITY", "EFFICIENCY", "WORKLOAD", "SCHEDULE_FIT"],
  modelVersion: "..."
}
```

The server must validate that:

- every returned pair ID exists in the submitted candidate pool;
- no `INFEASIBLE` or hard-blocked pair is promoted;
- the result contains no new vehicle, driver, score, ETA, or safety claim;
- reason codes map to server-generated evidence, not free-form model prose;
- ties and incomplete output fall back to deterministic ordering.

If the Jev SDK requires an adapter, add one small server-only adapter beside the existing ranking module. Do not add a second general AI abstraction.

#### Phase 2 — Wire Jev into the ranking seam

1. Add a narrow ranker seam around `rankDispatchPairs()` so the existing radar service can accept the selected ranking implementation without moving its evidence logic.
2. Keep `rankDispatchPairs()` and `comparePairEvidence()` as the deterministic fallback.
3. Run Jev only after `evaluateDispatchCandidate()` has populated each candidate's radar evidence.
4. Reuse the existing candidate identity, recommendation fields, `decisionEvidence`, `recommended`, `alternate`, and `none_reasons` contract. Do not create a second Option 1/Option 2 response shape.
5. Add `rankingSource` and `modelVersion` to the existing server-owned recommendation/snapshot metadata if the current payload can carry them. Avoid a migration; stop and follow the repository migration policy if the existing persistence shape cannot carry the metadata safely.
6. Keep the final deterministic tie-breaker by evidence and pair identity so identical Jev results cannot cause unstable ordering.

The radar service should only gain the smallest possible ranker injection point. Its route, GPS, schedule, conflict, expiry, and readiness logic must remain unchanged.

#### Phase 3 — Shadow rollout

1. Call Jev in shadow mode while continuing to display the deterministic result.
2. Log only the comparison metadata through the existing AI logging path: model version, input/evidence version, legacy order, Jev order, agreement, fallback reason, and latency. Do not log private exact coordinates or unnecessary personal data.
3. Measure:
   - top-two agreement rate;
   - Jev fallback and invalid-output rate;
   - ranking changes by reason code;
   - dispatcher override rate;
   - hard-block or stale-evidence regressions;
   - recommendation-to-assignment outcome where a ground-truth outcome exists.
4. Do not call a ranking change an improvement merely because Jev selected a different pair. Review the changed evidence and the resulting trip outcome.

Cutover gate:

- no hard-rule regression;
- no radar evidence loss;
- no invalid pair IDs or fabricated facts;
- fallback works when Jev is unavailable;
- changed rankings are explainable from verified evidence;
- the measured result is better than the current heuristic on the agreed evaluation set.

#### Phase 4 — Make Jev primary

1. Enable Jev for the recommendation path after the shadow gate passes.
2. Ensure all user-facing Option 1/Option 2 surfaces use the same final ranking source, or clearly label the source when a caller intentionally remains on fallback during rollout.
3. Keep the fallback active for provider failure and operational timeouts; this is reliability handling, not a second decision authority.
4. Keep assignment and trip-start revalidation unchanged. A previously ranked pair is never trusted without current server checks.
5. Update the panel to show verified decision reasons and ranking source. Do not show Jev output as probability, safety confidence, or proof of future arrival.

#### Phase 5 — Remove only proven dead legacy scoring

After caller and snapshot audits:

1. Remove the old soft score functions only if no active UI, API, snapshot, test, or fallback depends on them.
2. Keep `pair-scoring.js` if it still owns hard eligibility, pairing, or candidate construction.
3. Do not delete the whole file merely because its heuristic score is inaccurate.
4. Re-run the repository search before deletion and preserve the deterministic fallback if Jev remains an external dependency.

## Required verification

### Automated

- Existing narration-guard, clause-polarity, Copilot scope/intent, conversation route, and FleetMate adversarial scenario tests.
- Jev response-verifier contract tests for supported claims, unsupported GPS/availability/ETA claims, stale or absent evidence, invalid evidence references, malformed output, timeout, provider failure, and fallback.
- Incident suggestion tests proving category confirmation is required and grounding/maintenance mutations remain deterministic.
- Existing pair-scoring eligibility and designated/substitute tests.
- Radar route/GPS/schedule/conflict/expiry tests.
- Ranking tests for reliability, efficiency, workload, schedule fit, ties, and stable identity ordering.
- Jev contract tests for malformed output, unknown IDs, blocked IDs, duplicate IDs, timeout, provider error, and empty candidate pools.
- Recommendation GET/POST tests proving the same Option 1/Option 2 order is serialized and snapshotted.
- Conversation and simulation tests proving their ranking source is intentional and not accidentally divergent.
- Assignment and trip-start tests proving live revalidation still rejects a now-invalid pair.
- Touched-source ESLint, production build, route authorization audit, and the repository test suite.

### Manual/browser

- Ask a normal Copilot question, an ambiguous follow-up, an injection-style request, and a question about unavailable GPS; confirm the correct deterministic or Jev-verified path.
- Force a narrated unsupported claim and confirm the dispatcher receives the evidence-only fallback or controlled review state, not an accepted hallucination.
- Submit an incident description containing a critical failure and confirm the suggestion requires driver confirmation while the existing emergency path remains available.
- Compare two candidates where the legacy score prefers A but verified travel/workload/reliability evidence favors B.
- Confirm the UI displays the Jev-ranked pair and its server-mapped reasons.
- Disable or time out Jev and confirm the deterministic fallback still produces usable options.
- Change schedule/GPS/route evidence after recommendation generation and confirm assignment revalidation blocks stale evidence.
- Confirm mobile and desktop show the same option order and no confidence claim.

## Documentation and delivery

After implementation, update:

- `Capstone/04 - Architecture/AI Architecture.md` — Jev's typed ranking role and its no-write boundary;
- `Capstone/02 - Features/AI Advisory.md` — wording library, Copilot verifier, ranking source, fallback, evidence contract, and UI behavior;
- `Capstone/07 - Development/Dispatch Copilot Decision Support Enhancement Plan.md` — guardrail and incident-classification scope;
- `Capstone/06 - Decisions/ADR/ADR-003 Deterministic AI.md` — revise the decision only if Jev becomes a primary ranking input, while preserving deterministic safety gates and human confirmation;
- `SYSTEM.md` — actual files changed, verification results, rollout status, and any remaining provider/browser limitations.

No database migration is expected for the initial implementation. No code, schema, or production behavior changes are part of this planning task.

## Completion criteria

The work is complete only when FleetMate answers are scanable and useful through the deterministic wording shell, the Copilot verifier can reject unsupported explanations, ambiguous or malicious input follows a server-owned safe path, incident suggestions require confirmation, and the pair-ranking track can change the top-two order using verified evidence without bypassing hard or radar checks. All tracks must fall back safely, remain auditable in logs/snapshots, and leave assignment-time validation unchanged.
