# Driver qualifications and cargo verification execution design

Date: 2026-10-09. The user authorized implementation of the reviewed roadmap and implementation plan. This authorizes application development; it does not fabricate missing source-owner, safety or privacy approvals.

## Confirmed product direction

- PASSENGER covers GUEST_TRANSPORT and VIP_GUEST_TRANSPORT.
- CARGO covers RESTAURANT_SUPPLY_PICKUP, RESTAURANT_FOOD_DELIVERY and HOTEL_SUPPLY_TRANSFER with the same driver pool and mobile flow.
- Both groups require explicit review; no automatic roster qualification.
- One shared app; preserve current mobile identity and apply Impeccable, UI UX Pro Max and High-End Visual Design.
- Source manifest expectations, pickup observations and delivered observations remain distinct.
- Start Trip travels to pickup. Item counts/acceptance gate loading and departure; delivery receipt gates closeout.
- Keep REQUEST and SUPPLY intake separate; never activate the measurement-only supply path as a dispatch.

## Application boundaries approved for development

Build audited qualification records and dedicated permissions using the existing staff authorization model. Keep qualification enforcement OFF by default, SHADOW read-only as an optional review mode, and ENFORCE a separately configured activation. A configured policy version is required for ACTIVE review; no default value may pretend to be an approved cargo policy. Dedicated manage permission does not give staff source-side shortage approval.

Disabled development of contracts, state, API refusals and sandbox UI is allowed by the user's implementation instruction. Persisted cargo evidence, live source decisions, supply assignment and production clearance remain unavailable when their actual policy/authority configuration is missing. No empty or mock approval can enable them. Sandbox fixture events are labeled simulated and restricted to nonproduction.

## Shared contract and source resolution

Use the implementation plan's [Contract shared across workstreams](../plans/2026-10-09-driver-qualifications-cargo-verification.md#contract-shared-across-workstreams) for `ManifestView`, `ReceiptInput`, `DecisionInput` and `CargoExecutionView`. The plan's quantity basis, immutable receipt identity, manifest revision/hash, exact replay and error contracts apply. These are development contracts; they do not supply missing external authority or privacy approval.

The server resolves the intake kind from the persisted trip/dispatch linkage, never from a caller-selected source kind. REQUEST resolves its linked typed PMS/POS transportation request and its own immutable request manifest. SUPPLY resolves the requestless `SUPPLY_DELIVERY` dispatch's allocation and existing SCM manifest revision/hash. Request-backed cargo can retain the historical `PASSENGER` dispatch discriminator; that discriminator alone does not identify its load as passenger. A request cannot impersonate an SCM allocation, and SCM manifests are not copied into transportation requests. Missing or conflicting linkage blocks resolution. Supply assignment remains disabled.

## Proposed receipt state table

This table specifies disabled development and test behavior. It is not owner sign-off, a production policy version or permission to write live receipts. All state-changing paths still require the applicable configured authorities. A changed manifest or receipt makes an earlier decision stale.

| Case | Proposed state and next step | Departure or closeout gate |
|---|---|---|
| Clean pickup: expected 10, observed 10, intact | Save immutable pickup observation; pickup may become READY after required checks | READY alone never permits departure: current qualification, Fleet safety clearance and post-load securement must also pass |
| Short pickup: expected 10, observed 9 | AWAITING_DECISION; report shortage 1 and preserve expectation 10 | Departure blocked pending authorized source decision and Fleet clearance |
| Short pickup: source chooses WAIT | WAITING; driver waits and may submit a new immutable recount | No departure; a recount must be evaluated and cannot reuse a stale decision |
| Short pickup: source chooses ACCEPT_OBSERVED | READY only for the receipt/revision accepting 9; expectation remains 10 | Separate Fleet transport/safety clearance and securement required; acknowledgement alone does not unlock departure |
| Short pickup: source chooses REJECT_PICKUP | REJECTED; hold and hand off to authorized rescheduling/cancellation review | No departure; already loaded custody cannot be silently cancelled or discarded |
| Delivery: expected 10, picked up 9 with acceptance, delivered 9 | CONFIRMED only after approved receiver confirmation; order shortage 1, delivery shortage 0 | Authorized receiver and required evidence/closeout checks still required; transport closure does not close inventory/order |
| Delivery: picked up 9, delivered 8 | AWAITING_REVIEW; separate delivery discrepancy 1, without inferred blame | Completion blocked until approved resolution or named authorized exception-closeout outcome; receiver authority remains required |

## Mobile review boundary

The user requested the three mobile design skills and implementation. Normal pickup, shortage, awaiting-decision and delivery mockups, field validation and screenshot/device review evidence remain pending. Do not describe these as approved screenshots or field-tested acceptance. Disabled contract/qualification development may proceed independently; cargo mobile activation requires the applicable reviewed design and policy gates. The sandbox-versus-live asynchronous preference question remains pending and is not answered by elapsed time.

## Pending external/operational gates (approval register)

Read-only audit found all D01–D10 owner worksheet entries still pending. No named owners, signed policy/version, goods-license/training matrix, complete supply interval, load-plan/axle/securement procedure, shortage authority, receiver confirmation method, retention policy or report metric authority was supplied. Leave worksheet approvals unchanged. No automated external messages or live partner activation are authorized by this design.

The proposed photo bounds (five issue photos, 5 MiB each) are conservative technical caps only; they do not define approved retention. Production evidence writes require explicit privacy configuration. Source decision and Fleet clearance are different records and actors.

## Qualification rollout and existing trips

OFF performs no new eligibility read or block and preserves existing behavior while schema/UI are prepared. SHADOW records/reports a qualification verdict but cannot mutate approval or block a trip. ENFORCE requires approved policy version, a reviewed roster and an existing scheduled/active-trip treatment decision; absent configuration fails activation. Active cargo custody cannot be cancelled, reassigned or discarded by turning a gate off.

## Guard inventory

Cover request assign and dispatch-plan, general dispatch create/update, dispatch autocreate, availability/conflicts/Copilot and commit evidence. Trip start and shared transition/completion are not enough by themselves: generic trip PUT/POST status writers, mobile acceptance/rejection, cancellation and incident grounding must be assessed for bypass/custody behavior. Legacy In Progress/Arrived progress cannot skip cargo checks.

## Execution evidence

Original checkout is on feat/mechanic-integration with unrelated uncommitted maintenance/fuel work. Native cargo worktree was created, writes denied by sandbox and archive queued; using the skill's original-checkout fallback. Stage only task-owned paths and preserve existing edits. Baseline test runner required escalation because sandbox denied realpath on Vitest dependencies before collecting tests; record the actual escalated baseline result separately.
