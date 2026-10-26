---
type: assessment
status: native-acceptance-and-operating-integration-pending
last_verified: 2026-10-23
related: ["[[Mobile Architecture]]", "[[Mobile Map Functionality Repairs 2026-10-21]]", "[[Cargo Remaining Work 2026-10-20]]", "[[Driver Guidance Redesign Implementation Plan 2026-10-20]]"]
---

# Mobile remaining work - 2026-10-23

The owner asked what still needs doing in mobile. This is a source and note review of the current driver app, not an implementation, build, provider activation or deployment request. Existing map/tracking working-tree changes were preserved.

## Recommended next milestone

Install the latest compatible Android build and complete one authorized Passenger trip on a real phone. The recent map, branding, performance and odometer work has automated/export evidence, but that does not close physical-device acceptance. Record failures against this checklist before choosing further UI work.

## Priorities

1. **Native build and map/navigation acceptance.** Check location denied/revoked/re-granted, disabled GPS, tab changes, background/return, screen lock and restart. Verify Google Maps handoff, distance collection, route outages/retry, stale guidance and completion cleanup. Review native cold start, real release-build responsiveness, small screens, OS large text, TalkBack and the existing themes. See [[Mobile Map Functionality Repairs 2026-10-21]], [[FleetOps Mobile Identity]] and [[UI UX Audit - Mobile]].
2. **One complete driver workflow, including real odometer evidence.** Use approved test identities/data for sign-in/consent, duty and Pre-Shift, assignment/acceptance, Pre-Trip, starting odometer, pickup/drop-off, ending odometer, history/next assignment and End Duty. Include fuel/incident paths, response loss, session changes and camera permission recovery. The odometer acceptance set remains at least 20 readable and 10 deliberately unsuitable actual fleet-dashboard photos; wrong values classified ready block release. Local odometer enforcement was already enabled, so this is validation rather than a missing feature. See [[Trip Odometer Photo Verification 2026-10-19]].
3. **Offline and notification reliability.** Cached reads, supported queued writes, background GPS and server push already exist. Verify supported actions through airplane mode, kill/relaunch and reconnect without duplicate outcomes; verify driver switching does not expose another driver's saved/private data. Check real assignment notifications while locked/backgrounded and their tap destination. A genuine remaining server improvement is push-outbox failure recovery and delivery-receipt checking: the current implementation marks unsuccessful rows `error` without an automatic retry loop. See [[Notifications]] and `src/services/push.service.js`.
4. **Real Cargo operating integration.** The count/condition/signature screens and history reviews exist. Production manifest intake, execution, private evidence, partner gateway and staff feedback remain unavailable. Connect an approved job source and storage, source/Fleet/receiving authority, usable vehicle capacities/eligibility and result-delivery/recovery paths before proving an end-to-end Cargo trip on phone and staff web. This requires adapter/operating work, not simply enabling a flag. See [[Cargo Remaining Work 2026-10-20]] and [[FleetOps Cargo Rollout Runbook]].
5. **Accept and roll out the new driver guides.** V2 software is implemented with the build flag off by default. Complete native Android accessibility/interruption/isolation checks and observe at least three unfamiliar participants per workflow. Fix safety misunderstandings before enabling V2 or deleting legacy guidance. Cargo practice does not establish operating integration. See [[Driver Guidance Redesign Implementation Plan 2026-10-20]].
6. **Replace unverified release contacts and decide guest-contact scope.** About still explicitly marks its sample hotline and support email for verification; Help uses the same unverified email. Configure genuine support details before release. Guest calling is a separate data-contract task: the map repair confirmed no upstream guest-phone field and now states unavailability honestly. If calling the passenger is required, complete approved intake/storage/privacy/projection rather than inventing a number. See [[Reservation Luggage and Customer Contact Implementation Plan]].

## Scope and stale checklists

- The current app is driver-only; guest booking is additional product scope, not an unfinished driver screen.
- `mobile/README.md` has a stale Not implemented list for push/offline/background work and outdated auth/setup details. Use the current architecture and implementation notes for readiness; reconcile that README in a documentation cleanup.
- The Google Maps preflight and optional Android floating bubble have a separate branch/rollout record. They are not established as shipped in this checkout. Navigation acceptance comes first; the bubble remains optional. See [[Google Maps Navigation and Android Bubble Implementation Plan]].
- Current EAS production configuration targets an internally distributed Android APK. Public-store/iOS release work depends on the chosen distribution scope.

## Verification and limits

Reviewed current mobile configuration, driver-only login, trip detail loading, guide flag, support screens, Cargo production exports/evidence refusal and push-outbox failure handling against the linked notes. Two independent read-only reviews covered native/release readiness and operating workflows. The old online fabricated Completed-trip fallback was found already removed and is not listed as pending.

No app tests, fresh APK/export, live database/API checks, messages, provider activation or operating-data writes were performed for this assessment. Prior test/export counts remain historical evidence in their original notes. Documentation verification: repository UTF-8 gate and scoped whitespace checks; no application behavior changed.
