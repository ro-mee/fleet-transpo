# Dual Cargo Signatures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Capture and review cargo-only pickup and delivery acknowledgments tied to existing immutable item receipts, preserving the shared Passenger/Cargo odometer flow.

**Architecture:** Extend `cargo_receipts.payload` with a versioned `handover` value. The existing receipt transaction, actor binding, immutable history, command replay and audit provide persistence; no independent handover table or duplicate endpoint is needed. Preserve deliberately unconfigured production cargo authority and independently resolved source, Fleet safety and receiving proof. Show signatures only through an explicitly requested authorized cargo detail projection; exclude names, coordinates and strokes from partner feedback and ordinary list responses.

**Tech Stack:** JavaScript/JSX, Zod, PostgreSQL/pg, Next.js 16.2 route handlers, Expo/React Native, installed react-native-webview, Vitest.

## Global Constraints

- 100% JavaScript (`.js` / `.jsx`); no TypeScript files.
- Read `.agents/AGENTS.md`, SYSTEM.md, DESIGN.md, docs/rbac-model.md and relevant Capstone notes first; use UTF-8 for every write.
- Work in the current `feat/mechanic-integration` checkout because its uncommitted odometer/UI/backend work is the integration baseline. Preserve all unrelated edits; do not reset, stage or commit them.
- No schema migration is necessary: existing private immutable receipt payloads hold this additive contract and `received_at` supplies server time. Do not edit schema.sql or apply pending unrelated migrations. Check ledger and existing cargo table security read-only.
- Use existing cargo API permission/ownership checks and real `super_admin` role. Do not install a source/receiving authority provider, activate cargo, deploy or write operating trips.
- No arbitrary SVG/HTML from a request. Accept bounded numeric strokes and render with fixed SVG elements. Drawing is a human acknowledgment, not identity verification or business acceptance.
- One pickup/delivery destination per trip. Recounts create new signed receipts; changing counts/issues invalidates a captured acknowledgment. Incident reporting never automatically bypasses custody/receiving checks.
- Starting and ending odometer functionality remains shared for Passenger and Cargo. Do not move its capture or change fuel/completion transactions.
- Reuse installed WebView for isolated native drawing; no package/native build change. Use existing theme, modal/button, safe-area and text-size patterns. Do not persist unsent signature form content on every edit. Existing submitted cargo drafts retain stable signed receipt content for retries.

## Shared contract and file boundaries

`shared/cargo-handover.js` exports `validateCargoHandover(value)` (returns a normalized JSON-safe value or throws), `cargoSignaturePaths(signature)` (safe path data), and `CARGO_HANDOVER_ACKNOWLEDGMENT`.

`handover` is optional when parsing historical receipt payloads, but required on every new receipt command after exact replay lookup. Format:

```js
{
  version: 1,
  signer_name: 'Receiving staff name',
  signer_role_or_dept: 'Receiving',
  acknowledgment: 'CARGO_HANDOVER_V1',
  captured_at: '2026-10-20T02:00:00.000Z',
  signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80], [100, 40]]] },
  location: null // or { latitude, longitude, accuracy_m, captured_at }
}
```

Coordinates are finite numbers in the fixed 600x240 drawing space; require at least one meaningful drawn stroke, max 64 strokes / 2048 total points and bounded signer fields. GPS is optional with explicit unavailable feedback; if present require valid bounds, nonnegative bounded accuracy and fresh observation. Server `received_at` remains authoritative and distinct from device capture time. The parent immutable receipt binds the acknowledgment to its trip, assigned recording driver, manifest revision, stage and exact line quantities/conditions.

### Task 1: Signed receipt contracts, persistence and cargo lifecycle

**Files:** Create `shared/cargo-handover.js`, `shared/cargo-handover.test.js`; modify `src/lib/cargo/contracts.js`, `src/lib/cargo/execution-state.js`, `src/services/cargo-execution.service.js`, `src/services/cargo-execution.repository.js`, `src/lib/cargo/api.js`; extend their neighboring tests/fixtures.

**Interfaces:** Optional historical `receiptSchema.handover`, required new command handover, `GET /api/trips/:id/cargo?include_handovers=1` adds `data.handovers` containing `{ pickup, delivery }`. Each nonnull entry is `{ receipt_id, stage, received_at, observed_at, manifest_ref, lines, handover }`; `lines` expose only line ID, observed quantity, condition, issue and remarks. Ordinary read strips all handover values; mutation original snapshots stay stable. Public partner event receipts omit the private handover.

- [x] Add failing validation tests for blank/tap-only/oversized/nonfinite/off-canvas drawing, invalid signer/location and arbitrary markup; allow meaningful strokes and null GPS.
- [x] Add failing service/lifecycle tests: unsigned new receipts refuse, exact historical command replay still works, signed receipts persist/replay unchanged, changed signature conflicts, new unsigned pickup/delivery cannot authorize departure/completion, recount cannot reuse old proof, incident IDs do not bypass checks.
- [x] Add failing API tests for optional explicit detail selection, unchanged default privacy, assigned-driver/staff permissions, wrong trip rejection, safe partner projection and disabled production authority.
- [x] Run focused tests to observe failures, then implement validation and safe projections using the existing transaction and required audit.
- [x] Update existing fixtures that intend valid cleared cargo with explicit handover values; keep legacy fixture tests proving unsigned history is readable but cannot grant new clearance. Do not suppress tests.
- [x] Run relevant API/state/service/repository/security suites with one worker, strict scoped lint, and report exact results.

Example behavioral assertions:

```js
expect(() => validateCargoHandover({ ...handover, signer_name: ' ' })).toThrow();
expect(deriveCargoState(unsignedPickupAndClearance).can_depart).toBe(false);
expect(JSON.stringify(defaultRead.data)).not.toContain('CARGO_HANDOVER_V1');
expect(detailRead.data.handovers.pickup.receipt_id).toBe(pickup.receipt_id);
```

### Task 2: Mobile signer capture and receipt binding

**Files:** Create `mobile/components/cargo/CargoSignatureModal.jsx`, `mobile/lib/cargo-signature.js` and neighboring tests; modify `mobile/components/cargo/CargoWorkflowScreen.jsx`, `CargoWorkflowContent.jsx`, `mobile/lib/cargo-view-model.js`, `mobile/lib/cargo-form-state.js` and affected tests.

**Interfaces:** Modal consumes `{ visible, stage, busy, onCancel, onConfirm }`; `onConfirm(handover)` returns the shared contract. Mobile receipt builder accepts `{ ..., handover }` and preserves that exact value in submitted drafts/retries. Existing cargo API request uses `include_handovers=1` only if displaying saved signature detail.

- [x] Add failing tests that signed receipt building preserves handover; counts/issue changes invalidate the acknowledgment; stage/manifest/session changes do not reuse it; exact draft retry keeps the original signature.
- [x] Build isolated drawing HTML inside the installed WebView with fixed dimensions, clear control, bounded stroke points, navigation/network refusal and message-size/schema validation. Use current theme/modal/button/text-size conventions, scrolling and accessible input labels.
- [x] Capture supplier/releasing staff name and role at pickup, receiving staff name/department at delivery, explicit acknowledgment and current location when permission/fresh fix is available. Show unavailable location honestly; no fake coordinates or success. Keep refusal/incident guidance visible.
- [x] Open signing after existing count review. Submit only the acknowledged snapshot; close/cancel preserves counts and does not send a receipt. Block changes while submitting and invalidate after successful new-count action. Never send transitions from the signature modal.
- [x] Preserve local device/Fleet/partner status distinctions and existing session/assignment checks, restart behavior and pending-retry locking. No unsent signature data in autosaved form snapshots.
- [x] Run focused mobile render/view-model/form/retry tests and strict scoped lint. Export Android JavaScript with the installed Expo toolchain; record physical-device acceptance separately.

### Task 3: Authorized web chain-of-custody view

**Files:** Create `src/components/cargo/cargo-handover-evidence.jsx` and `.test.js`; modify `src/components/cargo/cargo-verification-panel.jsx`, `src/services/cargo-execution.client.js` and neighboring tests as needed.

**Interfaces:** Consume the Task 1 `data.handovers` detail projection through the existing authorized cargo client, without creating a public signature URL or fetching arbitrary HTML. Render fixed SVG paths from the shared validator; show pickup/delivery peer regions with signer, department, device capture/server record times, condition/quantity details and optional GPS accuracy.

- [x] Read installed Next.js client-component guide and shared design system; inspect existing paired odometer evidence and cargo verification components.
- [x] Add failing render/client tests for paired records, absent/legacy records, malformed paths, loading/error/retry and explicit private detail request.
- [x] Implement the two-stage evidence card with existing Card/Button patterns and semantic tokens, stacked at narrow widths. Do not render a drawing as independently verified receiver authority. Keep prior saved facts during refresh failure and clear private details on trip/session changes.
- [x] Run focused component/client tests and strict scoped lint. Review the rendered surface when browser access is available and state any unverified browser acceptance.

### Task 4: Integration and independent review

- [x] Run baseline focused cargo suites before edits and retain their results.
- [x] Read-only `npm run db:status`, `npm run db:contract` and `npm run verify:anon`; no schema changes or operating writes.
- [x] Review receipt feedback serialization, command replay hashes, history/private projection, all cargo lifecycle callers and both Passenger/Cargo odometer regression coverage.
- [x] Run `npm run lint`, `npm run test:run -- --maxWorkers=2`, `npm run verify:auth`, `npm run verify:encoding`, `npm run db:check`, whitespace checks and Android export. If host/sandbox blocks a check, retain the failure and report it accurately; never weaken gates.
- [x] Obtain independent review covering the whole signature change and fix important findings, rerunning affected checks. Do not stage or commit the user's unrelated working changes.

### Task 5: Synchronized documentation and delivery

- [x] Update Capstone Trips, cargo storage, Mobile Architecture, signature assessment and SYSTEM.md with behavior, privacy, verification evidence and remaining activation/device limits.
- [x] Mark this plan's completed checkboxes and record exact tests/checks, review findings and any incomplete acceptance.
- [x] Deliver a concise summary with links to the plan and completed-work note, clearly distinguishing implemented code from currently unavailable production cargo authority and physical device acceptance.

## Execution record

### Follow-up: web skill refinement and connection (completed)

Owner requested Impeccable and UI UX Pro Max and explicitly confirmed web connection. Refined existing paired stage/signer/count hierarchy, shared skeleton/status controls, accessible disclosure and44px narrow actions while preserving private detail loading. Dispatch now links to the saved handover section in Trip Details; delayed-query fragment recovery also reaches cargo-unavailable state without opening signatures. Final54tests/11files, scoped strict lint, production webpack248pages, browser component review and independent fix review passed. Relevant Capstone notes, design-system evidence pattern and SYSTEM.md synchronized. Authenticated operating navigation and production cargo activation remain separate.

Planning completed on 2026-10-20 after the user explicitly requested both the implementation plan and execution. No separate approval round is required for this agreed cargo-only scope. Source/receiving/Fleet policy and production activation remain outside this implementation authorization.

## Completed verification

### Follow-up: mobile Trip Details and history

The owner requested saved signatures in Trip Details after reviewing the mobile visualization. Reuse the private detail projection through an explicit View signatures action, including terminal/history trips. Show the paired signer, drawing, department, saved counts and timestamps with honest missing/legacy/error states. Scope private in-memory details to a freshly confirmed trip and current session; hide/offline/account/trip changes abort and discard them. Preserve odometer and cargo workflow authority. Verify private API behavior, actual native component hooks/rendering, lint and Android export; update the feature/architecture/implementation notes and SYSTEM.md.

Completed: private client method and mobile evidence card integrated, with cached-history reconnect refresh recovery added after independent review. Final83mobilefiles/1,069tests and focused41/41 passed; scoped strict lint and Android Hermes export passed. Browser component fixtures checked390light/320dark doubled text, legacy and unavailable states. Capstone Trips/Mobile Architecture/implementation notes and SYSTEM.md synchronized. Real native/authenticated operating acceptance remains separate; no production activation or deployment.

Implementation completed in the existing checkout. Final full regression: 523 files / 5,941 tests passed, 12 optional files / 114 tests skipped. Final isolated PostgreSQL service 33/33 and storage 12/12 passed in separate runs. Strict lint, production webpack build, Android Hermes export, authorization339/339, migration validation166, encoding and whitespace checks passed. Independent review approved the source privacy fix and related integration. No migration, production cargo provider activation, operating-data write, dependency/native change, deployment, stage or commit. Real phone/operational receiving/source/safety/provider acceptance remains separate. See Capstone/07 - Development/Dual Cargo Signatures Implementation 2026-10-20.md for exact evidence and limitations.
