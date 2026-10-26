---
type: implementation-plan
date: 2026-10-21
status: implemented; physical-device acceptance pending
related: ["[[Tracking]]", "[[Live Map Radar]]", "[[Mobile Architecture]]"]
---

# Mobile Map Functionality Repairs

The supplied static audit is the starting evidence. The user authorized verifying
its findings and fixing confirmed functional issues. Preserve the current visual
design, cargo clearance, trip ownership, canonical targets, and manual arrival
confirmation. A tutorial redesign and a wholesale screen rewrite are separate work.

## Repair slices

- [x] GPS ingestion: reproduce late posts on both real handlers; share timestamp
  validation and an atomic observed-time guard; retain valid history without
  publishing stale advisories. Check emitted SQL against the live catalog.
- [x] Assignment feed: confirm the real contact schema; return no invented phone
  number. Bound repeated advisory ETA lookups without caching authoritative start
  validation. Test cache expiry, movement and concurrent requests.
- [x] Map screen: keep pending rows in the radar and accepted/ongoing work in the
  trip screen. Preserve a valid session while an unchanged poll is in flight.
  Guard acceptance synchronously against repeated taps.
- [x] Tracking lifecycle: remove subscriptions that finish starting after cleanup,
  ignore callbacks after cleanup, surface local GPS failure/freshness, and preserve
  active-trip distance collection across tab changes.
- [x] Route recovery: distinguish renderer loading, ready and failed states; allow
  retry, release route-option controls after a missing bridge response, expire ETA
  and advisory hints by observation time, and scope readiness to a renderer mount.
- [x] Renderer: stop hidden periodic route requests, refresh on return when due,
  report native/document errors, and restrict file access and page navigation.
- [x] Production radar: advertise only supported layers; keep simulated entities
  explicitly development-only. Remove the duplicate locate control.
- [x] Run regression tests before and after each nontrivial fix, then combined
  tests, changed-file lint, UTF-8 and diff checks. Review changes independently.
- [x] Update Tracking, Live Map Radar, Mobile Architecture and SYSTEM.md with
  actual results and remaining physical-device acceptance.

## Acceptance limits

Automated checks do not establish physical GPS accuracy, Android/iOS permission
behavior, Google Maps background drives, floating-bubble operation or native
rendering. Those remain a device acceptance checklist. No deployment is requested.

Guest contact has a separate proposed ingest/schema/privacy plan. If the live
catalog confirms no source, the Map must state unavailability rather than offer
a button that cannot dial.

## Implementation and verification record - 2026-10-22

Confirmed and repaired the GPS ordering, watcher cleanup, radar reachability,
repeated acceptance, polling-session churn, route loading/retry, stale guidance,
hidden provider refresh and unsupported production-layer findings. Tracking moved
to a focused app-level owner; the existing trip/cargo state machine and actual
odometer workflow remain authoritative. No full Map or tutorial rewrite was made.

The passenger phone assertion was confirmed as a missing upstream data model,
not a forgotten selectable column: live information_schema returned guest_name
as the only request guest/phone/contact field. The existing proposed contact
feature is still needed to collect a legitimate number. Map now communicates
unavailability and exposes Call only with an available authorized Passenger number.
No new contact field, guessed number or schema migration was introduced.

Independent review checked server GPS/ETA and the full Map integration. It exposed
additional races which now have executable coverage: an older Map/poster read
restoring an earlier leg or clearing a newer trip; a resumed renderer routing
before receiving the resumed observation; and stale GPS silently receiving a new
ETA timestamp. Shared read revisions, capture-time bridge data and fresh-position
routing guards address those paths. Cached route alternates retain their provider
calculation time. A replacement renderer inherits hidden-tab state. Current
assignment browsing also works when tracking is disabled. Unknown heading stays
unknown rather than being converted to north.

Verification actually run:

- Full repository run: **553 passed files / 6,183 passed tests**; the existing
  **12 opt-in PostgreSQL integration files / 114 tests skipped**. The first
  sandbox run hit temporary-Git permission failures and two old Map fixtures;
  those fixtures were updated to execute the actual new lock/contact conditions,
  and the full rerun passed with local temporary-Git access.
- Later combined mobile/GPS/privacy/ETA/start-window run: **125 files / 1,449
  passed tests**. After the final hidden-renderer guard, the final Map routing,
  generated-document, bridge and lifecycle regression run passed **70/70**.
- Changed JavaScript/JSX strict ESLint passed; UTF-8 gate and diff whitespace
  checks passed; migration filename/checksum-shape gate passed (166 files).
- The new ingest SQL was checked against the configured live PostgreSQL catalog
  with EXPLAIN and session-local temporary-table sequences, rolled back without
  changing persistent rows or sequences. Newer/older/equal samples retained history
  while only newer observations updated current position. A separate read-only
  catalog check established the missing guest phone source.
- Android Hermes export passed (1,517 modules, approximately 5.4 MB, 95 assets).
  The first attempt reached Hermes but could not write its sandbox temporary
  bytecode file; a workspace temporary directory resolved that environment failure.
- A source-render smoke check with native/provider boundaries mocked covered
  standby, active Passenger, map-error retry and GPS-lost retry. This proves the
  real component renders those states, not native pixel/gesture/permission behavior.

Tracking, Live Map Radar, Trips, Mobile Architecture and SYSTEM.md were updated.
No dependency, database migration/apply, operating-data write, deployment, push or
commit was performed. Preserve unrelated working-tree edits.

## Physical-device release acceptance still open

- Two pending assignments; active trip plus an earlier pending trip; off-duty future
  assignment; available versus unavailable passenger contact.
- Location denied/revoked/re-granted, disabled GPS, stale/parked observations,
  screen blur/return, app background/return and restart; no orphan native watcher.
- Slow/unavailable TomTom and a missing WebView command; retry and route-option
  controls recover, old ETA does not look current, pickup-to-destination has no
  prior-leg guidance and hidden maps issue no periodic routing.
- Google Maps background drive with per-leg collection/merge and Android bubble
  permission/tap/drag/return; cancellation/completion/account shutdown while a
  native start is pending.
- Passenger progression and Cargo verification/source/Fleet/receiver holds,
  audited geofence override, real ending odometer capture and network recovery.

These checks require the actual development build/device and authorized workflow
participants. Automated/export results do not close native production acceptance.

## Commit-review correction (2026-10-26)

Before the first commit of this batch, the Map screen's fix subscriber was corrected
not to treat the app-level owner's `null` publication as a stream failure: `null` is
the owner's benign reset signal (Retry action, trip change, dispose — see
`mobile/lib/trip-location-owner.js`), so it now clears the local stale-fix timestamp
and error and leaves the GPS state to the freshness machinery (neutral
"GPS signal unavailable" copy plus the Retry card) instead of instantly raising
"Location updates stopped" — most visibly right after tapping Retry GPS. `fail()`
remains reserved for the display-only watcher's third-argument error callback and for
malformed fix objects. Two mangled or duplicated comments in `map.js` were restored.
Mobile map/GPS library checks re-run after the edit: 10 files / 214 tests passed.
