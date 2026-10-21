# Trips Date Tabs Implementation Plan

> Execute inline with executing-plans. The user approved Today / Upcoming / History and continued trip visibility while off duty.

**Goal:** Give drivers a readable date-based schedule with raised trip cards, independent of duty attendance.

**Architecture:** Add optional scoped, paginated reads to the existing owned-driver endpoint without changing its legacy array response. Compose the existing mobile card, badge and button components with segmented tabs. Store each scope separately in the existing driver cache and preserve error/offline honesty.

**Tech stack:** Existing Next.js route handler, PostgreSQL read queries, Expo/React Native, shared Clay components. No dependencies or migrations.

## Constraints

- Use Asia/Manila scheduled departure dates. Today includes ongoing, overdue and undated nonterminal work; Upcoming contains future nonterminal work; History contains completed/cancelled work newest first.
- Keep viewing independent of duty. Preserve all existing server action gates.
- Keep raised cards, theme tokens, 48 dp navigation targets and bottom clearance.
- Preserve existing endpoint consumers and driver ownership filtering.
- No automated tests are added or run unless requested; use scoped lint, encoding/whitespace checks, Android export and fixture visual review. Native/live database acceptance remains explicitly unverified.

## Tasks

- [x] Add `view=today|upcoming|history` and validated offset pagination to `src/app/api/mobile/driver/trips/route.js`. Scoped responses return `{trips, hasMore, nextOffset}`; legacy requests remain arrays. Apply date/status predicates before limit, priority sort Today and descending History.
- [x] Add date/section presentation in `mobile/lib/trips-schedule.js`, reuse existing queue labels, and add static scoped cache keys with logout cleanup in `mobile/lib/offline-cache.js`.
- [x] Update `mobile/app/(app)/(tabs)/trips.js` to show the three accessible tabs, work-schedule calendar action, scoped cached reads, guarded refresh/load-more and tab-specific empty/error states. Retain existing detailed trip card and operational navigation.
- [x] Inspect real-component fixture previews for populated/empty tabs, narrow/light/dark/large-text presentation. Run lint, encoding, whitespace and Android export; review the focused diff.
- [x] Update Trips, Mobile Architecture, UI UX Audit and SYSTEM with implemented behavior and actual verification limits.

## Completion evidence

- Strict scoped ESLint passed for all touched production files and updated existing layout fixtures.
- Android Hermes export passed: 1,471 modules, 5.73 MB, 88 assets.
- Encoding and whitespace gates passed. No automated tests added or run.
- Real-component fixture previews covered normal light/dark populated and empty views, future-date grouping, History older-page loading, explicit selected state and 48 dp targets. At 320 px with simulated 1.6x text, stacked tabs measured 231 x 51.66 px without overlap. Final preview console had no errors after replacing nested Details buttons with a cue inside each tappable card.
- Added owned `trip_id` loading and newest scoped-cache lookup in trip detail because list pagination otherwise hid selected trips. Cached vehicle context uses the newest work-list snapshot; scoped cache keys participate in logout cleanup.
- Documentation updated: Trips, Mobile Architecture, UI UX Audit - Mobile and SYSTEM.
- Preview: `scratch/trips-tabs-preview.png`. Native/device/OS text scaling/screen-reader and live API/database acceptance remain unverified. No deployment, migration, dependency change, commit or operating write.
