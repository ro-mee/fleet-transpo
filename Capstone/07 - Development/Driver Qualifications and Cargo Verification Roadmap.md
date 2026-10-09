# Driver qualifications and cargo verification roadmap

Date: 2026-10-09
Status: Proposed product roadmap for review; no implementation, policy approval or deployment claim.

**Implementation plan prepared (2026-10-09):** [Driver qualifications and cargo verification implementation plan](../../docs/superpowers/plans/2026-10-09-driver-qualifications-cargo-verification.md) breaks the roadmap into 15 tasks (0–14), with exact existing/new file paths, contracts, test cycles, transactional/security checks and release gates. The two groups are Passenger and shared Cargo Logistics. Source inspection corrected the lifecycle placement: Start Trip travels to pickup; item verification and discrepancy acceptance gate cargo loading/departure, not travel to the supplier. Read-only `db:status` reported 155 applied/0 pending/0 changed; numbers must be rechecked before migrations. Planning verification covered paths, exports, installed Next guidance, dependencies and roadmap coverage. No code or DB changes or implementation tests.

## Goal and approach

One shared driver app and one traceable chain: source request > qualified dispatch > item pickup > discrepancy decision > safety clearance > delivery evidence > source feedback. Initial scope is general non-specialized cargo, one shipment/trip/destination. Source owners retain inventory, supplier claims and order closure. Passenger behavior remains supported.

Recommended approach: complete sandbox flow with a simulated partner first; real integration follows approved policies/contracts and operational acceptance. Internal-only delivery is simpler but needs manual partner handoffs. Live integration first couples development to partner availability and unapproved rules.

The user explicitly requires Impeccable, UI UX Pro Max and High-End Visual Design for mobile UI/UX. Carry this requirement into future design/implementation sessions.

## 0. Reconcile the existing cargo paths and approve rules

Inspect current source, migration ledger and feature-branch state before estimating or coding. The passenger/cargo closeout reports applied migrations 150–155 in its context; the separate supply foundation has shipment/manifest/allocation records. Neither note establishes both flows are active in this checkout/deployment. Choose a canonical manifest owner per intake path and a shared trip-facing projection. Do not create a third manifest store or silently enable disabled supply assignment.

Reuse the supply owner worksheet to approve source identity/contracts, goods-driver license/training, full reservation interval, load-safety verification, shortage approver, receiver authority, evidence access/retention and inventory authority. Proposed responsibilities: driver records observations; source business owner accepts quantity deviations; Fleet dispatcher clears transport; receiver confirms receipt. Named owners and exact permissions remain unapproved.

Outcome: reviewed architecture and policy decisions; existing disabled gates remain until their requirements are met.

## 1. Driver service qualifications

Manage qualifications in Drivers > profile > Service Qualifications. User-confirmed grouping (2026-10-09): exactly two operational groups, Passenger Driver and Cargo Logistics Driver. Passenger covers Guest Transport and VIP Guest Transport. Cargo Logistics covers Restaurant Supply Pickup, Restaurant Food Delivery and Hotel Supply Transfer; restaurant and hotel cargo use the same driver pool and cargo mobile workflow. Request source, items, locations and recipients still come from each trip. Store individual services underneath the two groups for auditable permissions, with status, reviewer/date, evidence where required and change history. Do not add separate restaurant/hotel cargo driver restrictions or automatically qualify existing drivers. A driver may hold both groups only through explicit qualification; cross-group eligibility is not automatic.

Share enforcement across candidate filtering, assignment, reassignment, substitutes, start and Copilot explanations. Retain license, schedule, availability, consent, vehicle readiness and capacity checks. Define revocation handling for scheduled/active work; do not silently delete active trips.

Acceptance: invalid direct assignment/start attempts fail with clear reasons.

## 2. Manifest and trip evidence

Reuse/extend the selected manifest model: stable item ID, expected quantity/unit, weight, handling instructions, optional reference image and revision. Store pickup/delivery counts, discrepancies, remarks, photos, receiver, reporter and observed/submitted times separately from original expectations. Corrections preserve history.

Photos use private storage and scoped access. Reference images identify expected items; observation photos document events. Counts/photos do not certify weight or load safety. A manifest change invalidates stale decisions and triggers review; already loaded cargo cannot be silently rewritten or cancelled.

Acceptance: one original manifest with traceable observations and revision-bound decisions.

## 3. Cargo pickup and shortage decisions

Assigned load/service selects one of two mobile workflows, including for multi-qualified drivers: Passenger for Guest/VIP, and Cargo for all restaurant/hotel cargo services. Restaurant versus hotel changes trip data and source-feedback routing, not the driver group or screen structure. Cargo sequence: trip summary > manifest > pickup counts/condition > discrepancy decision where needed > separate vehicle/load safety inspection > departure. Preserve passenger screens. Actual counts must be actively entered/verified, not prefilled as completed checks.

For 10 expected boxes and 9 counted, driver reports shortage 1 with remarks/evidence. Fleet saves it, alerts dispatch and shows Awaiting decision. The source owner decides wait, accept 9 or cancel/reschedule. Dispatch then checks transport feasibility. A report acknowledgement alone never unlocks departure; current business acceptance and Fleet clearance are required for discrepant pickup. Manual acceptance requires authorized staff, approver/time/reason and supporting communication evidence. Drivers cannot approve their own shortage; business acceptance cannot override safety holds.

Acceptance: complete pickup, approved/denied shortage, wait/recount and outdated decision scenarios work against a simulated partner.

## 4. Web review and delivery

| Web area | Information |
|---|---|
| Drivers | Qualifications and review history |
| Source request/shipment details | Original manifest and revisions |
| Dispatch | Eligible drivers, blockers, load summary |
| Trips > Cargo Verification | Pickup/delivery quantities, photos, decisions, discrepancies and receiver |
| Reports | Agreed delivery/discrepancy summaries |

Cross-links connect original request and operational trip. Mobile submissions appear in the same trip record, without staff re-entry.

At delivery, record quantities, condition, receiver and required evidence. A typed receiver name alone does not prove authority; use the approved receiving method. Expected 10/picked up 9/delivered 9 means all collected boxes delivered while the order shortage stays visible. Picked up 9/delivered 8 creates a separate delivery discrepancy; do not infer cause/blame. Define which unresolved issues block transport closure and which require a named exception outcome. Trip closure remains separate from inventory/order closure.

Acceptance: staff can reconstruct what was expected, collected, authorized and received.

## 5. Source feedback and offline reliability

Agree versioned messages for pickup, discrepancies, decisions, delivery and transport closure. Include source/request/trip/event IDs, manifest revision, stage, quantities/units, timestamps and authorized evidence references. Authenticate source identity from credentials; scope reads, evidence and decisions to the authorized source.

Save records and outbound messages together. Show send pending, acknowledged and failed; partner receipt differs from business approval and inventory posting. Retry with stable event IDs and duplicate-safe processing. Reject conflicting/stale decisions. Provide reconciliation and recorded manual handoff. The demo may simulate the partner explicitly; live release requires real authenticated round trips and durable retry/reconciliation.

Offline mobile retains account-scoped drafts/evidence and visible sync status. It cannot invent server clearance or partner approval. Until an offline-clearance policy is approved, blocked departure waits for online authoritative clearance. Reconnects, repeated taps and account changes cannot duplicate or misattribute evidence.

Acceptance: retries preserve one logical event; unsent reports never appear received.

## 6. Mobile UX and visual design

Apply Impeccable to task hierarchy/states; UI UX Pro Max to native interaction/accessibility; High-End Visual Design to typography, spacing, restrained depth and tactile feedback. The app uses Expo/React Native. Impeccable's loaded context is web-focused/partly stale; current mobile components, vault notes and the user's mobile requirement take precedence. No unrelated design-file repair is included.

Inspect incumbent mobile tokens/screens, then review mockups for normal pickup, shortage, awaiting decision and delivery before code. Preserve existing identity unless a redesign is chosen; available Plus Jakarta Sans is a candidate consistent with current dependencies. Field use overrides decorative website patterns: no oversized headings, delayed task content, scrolling blur or hover-only actions.

Use single-column item rows, readable expected/actual counts, progress summary and one primary action per step. Separate Report Issue from Confirm Pickup, and safety inspection from receipt verification. Provide loading, empty, error, offline draft, syncing, awaiting decision, rejected and confirmed states. Retain input after failures; explain blocked actions; do not convey status through color alone.

Targets: text contrast >=4.5:1, meaningful control contrast >=3:1, touch targets >=44pt iOS/48dp Android, safe-area/keyboard clearance, large text/screen readers, small-phone/landscape and reduced motion. Verify both themes independently. Use stable lazy image placeholders. Verify Expo dependency compatibility before applying newer React Native recommendations. Perform bounded screenshot/device review and corrections.

Acceptance: reviewed mockups and functional accessible screens for both normal and exception flows.

## 7. Reporting and release acceptance

Approve definitions for complete/partial deliveries, pickup/delivery discrepancies, unresolved cases and partner-send failures. Keep shortages and damage distinct; never total incompatible units or blame a driver for a supplier shortage without evidence.

Test shared cargo-group eligibility across all three cargo services, Passenger-group Guest/VIP eligibility and cross-group rejection unless explicitly qualified for both; then full receipt; 10/9 approved/9 delivered; denied shortage; wait then complete pickup; 9/8 delivery; damaged/wrong items; unauthorized decisions/foreign evidence; manifest changes; revoked qualification; duplicate submissions/events; offline/reconnect; partner timeout/reconciliation; passenger regressions. Backend, database, web, Expo and partner acceptance need separate evidence.

For migrations, use live status and the repository runner, regenerate schema, classify tables/views and verify RLS/grants with contract/anon gates. Run relevant tests, lint/build with legitimate configuration and browser/device acceptance. Release after policy, privacy and integration gates pass; sandbox demos use isolated reversible fixtures and never fabricate qualifications or license reviews.

## Deferred scope and next step

Separate apps, specialized/refrigerated monitoring, extra requester accounts, split/multi-trip fulfillment, physical returns and Fleet inventory posting are outside the initial scope. Signatures/OTP depend on the approved receiving method. Post-load cancellation is blocked/escalated until a physical custody recovery flow is approved.

Next artifact: approved design, then separate detailed implementation plans for qualifications, execution/evidence, integration and mobile UX. The brainstorming skill requires design approval before implementation; this roadmap does not grant missing owner-policy approvals.

Verification: reviewed idea assessment, supply foundation, passenger/cargo closeout/implementation notes and owner worksheet; read all three requested UI skills, loaded Impeccable context, queried native form/touch/accessibility guidance and read native quality rules. Checked the proposal for ownership, quantity semantics, approval versus acknowledgement and offline consistency. No feature, database or partner integration was implemented/tested, and no messages were sent.
