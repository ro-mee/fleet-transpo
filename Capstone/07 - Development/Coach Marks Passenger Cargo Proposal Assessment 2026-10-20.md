---
type: assessment
status: recommendation-only
last_verified: 2026-10-20
related: ["[[Driver In-App Guide]]", "[[Trips]]", "[[Cargo Remaining Work 2026-10-20]]"]
---

# Coach marks proposal assessment - Passenger and Cargo

Reviewed the owner's two pasted proposals: the contextual/interactive redesign recommendation and the updated requirement to reuse production UI. This is an idea assessment, not implementation approval or a runtime acceptance result.

## Recommendation

Use the second proposal as the main design requirement and the first as supporting rationale. Short, optional section guides, individual replay and shared production components fit both hotel Passenger and Cargo. Prefer incremental replacement of the current forced sequence over a complete engine rewrite before the first section works.

Use one shared guide system with common, Passenger and Cargo content. Resolve operational content from the saved trip and confirmed driver context, never a URL-only mode. Common guides include duty, inspections, odometer capture, fuel, incidents and connectivity. Passenger guides teach guest pickup/drop-off and the actual trip progression. Cargo guides teach units, actual counts, shortages/damage, releasing/receiving signatures and separate source, Fleet securement and receiving requirements. Vehicle inspection and cargo item verification remain distinct. Signatures acknowledge observations and do not grant clearance.

## Clarifications needed before implementation

- Distinguish contextual help during real work from explicitly selected practice. Real actions remain real and keep their authorization/validation; practice must be local-only across every write path, including uploads, autosave, offline queues, location posting and emergency actions.
- Reuse production visual components with isolated practice data and handlers. Avoid switching a live trip's shared state into simulated progress. Show a persistent Practice mode label and obvious Exit practice action. On exit, discard practice and refresh real state. Use fictional people, quantities and evidence; do not ask for real signatures for practice.
- When no trip or control exists, teach only the available standby controls. An explicitly selected, labeled sample session can use the same components; do not present fabricated assignments, GPS or clearance as live facts.
- Show guides only when relevant and their targets are available. For intrusive or interactive guidance, unknown motion is not confirmed stationary. Movement, emergency, reassignment, logout and background interruptions must safely end or suspend practice without resuming into a real action.
- Keep skipped distinct from completed and store progress by driver, guide, workflow variant and version. Completing Passenger content must not suppress Cargo-specific guidance. Migrating existing progress must not reset every guide for current drivers.
- Keep each guide focused on one task or decision. Test success by whether drivers can complete the task independently, alongside replay, interruption and zero-operational-mutation checks.

## Current-source findings and limits

The current provider still chains welcome into tour_sos and later sections. map-intro.js still defines Passenger-only Picked Up Guest and Dropped Off Guest practice stages. The guide note already states a lightweight contextual philosophy but later documents the forced interactive sequence; implementation should reconcile those sections when behavior actually changes.

The October 19-20 trip notes add shared starting/ending odometer photos and Cargo signed handovers, which the pasted proposals do not fully cover. The current Cargo readiness note reports production intake/execution/evidence/authority connections still unavailable. A tutorial must explain unavailable configuration honestly and cannot activate those capabilities.

Verified this assessment by reading both attachments, the current guide/Trips/Cargo readiness and signature notes, CoachMarkProvider.jsx and map-intro.js. No application code, setting, business data, dependency or database change; no app tests or physical-device checks were performed for this document review.

UX reference: [Nielsen Norman Group: Mobile-App Onboarding](https://www.nngroup.com/articles/mobile-app-onboarding/) supports brief, optional guidance in the user's task context. It does not establish FleetOps-specific effectiveness; that requires driver observation.
