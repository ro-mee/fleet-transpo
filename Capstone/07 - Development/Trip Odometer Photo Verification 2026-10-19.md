---
type: verification
status: locally-enabled-device-validation-pending
last_verified: 2026-10-19
related: ["[[Trips]]", "[[Mobile Architecture]]", "[[trip_odometer_captures]]"]
---

# Trip odometer photo verification - 2026-10-19

## Owner-authorized local activation and remaining-check cleanup - 2026-10-19

This checkpoint supersedes the earlier enforcement-off state for this local development environment. The owner explicitly requested activation and repair of the remaining shared checks. The ignored root `.env.local` now sets `ODOMETER_PHOTO_REQUIRED=1`. Next's installed environment loader confirms it is true in development and production modes. The mobile development API still targets `192.168.0.200:3000`, and that LAN address exists on this computer. No deployment or hosted environment setting was changed; `.env.example` retains the safe default of zero. Existing active false-latch trips remain on legacy completion; successful new photo starts latch the ending-photo requirement.

No enabled Gemini database provider was found, so the shared adapter would otherwise choose its old environment fallback model. The local-only `GEMINI_ODOMETER_MODEL=gemini-3.1-flash-lite` explicitly selects the model already configured for receipt scans. A read-only Google model-metadata request with the configured key returned HTTP 200 and `generateContent` support. Google's [model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) confirms image input and structured output support. No dashboard photo, generated content, operating trip write or Gemini accuracy evaluation was performed.

The two failing Off Duty assertions were stale after the approved date-tab redesign: Trips deliberately has no duty notice/artwork. Tests now retain Home and Map artwork/icon coverage and explicitly protect duty-independent Trips tabs and the work-schedule action. Existing actual-screen date-tab/loading/error/offline tests also pass. The Fuel JSX apostrophe is escaped as an HTML entity, preserving the rendered text. No application behavior was changed to satisfy stale tests, and no test or lint rule was skipped or suppressed. Independent scoped review approved these changes with no required findings.

Verification: focused five-file run passed 55/55; strict whole-repository lint passed with zero warnings; production webpack build passed with the flag enabled. Full regression results (349 seconds):

```text
Test Files  518 passed | 12 skipped (530)
Tests  5834 passed | 110 skipped (5944)
```

The whole-suite run used one worker and the Windows permissions required by temporary Git fixtures. The existing geoip dynamic-dependency build warning remains separate from ESLint. Tracked UTF-8/mojibake validation, the same algorithm on nine touched source/document paths including untracked notes, and whitespace checks passed. The local API was started with the updated settings and returned the expected unauthenticated HTTP 401 on both loopback and the mobile LAN address. No native source changed in this activation/cleanup; the earlier post-fix Android export remains applicable. Real phone/provider-photo, authenticated-role, actual private-link expiry and operating-trip acceptance are still unverified. The owner authorized local activation without representing those checks as completed. Command logs, results and scoped review are preserved in the local `odometer-activation-evidence.zip` alongside the earlier verification archive.

## Earlier implementation checkpoint (before local activation)

Tasks 1–6 are implemented and independently reviewed in the shared checkout. Task 7 records current verification and release holds. The effective server flag remains false; no environment edit, deployment, activation, real photo/provider call or operating trip write was performed during this closeout. Migration 164 was applied at the earlier authorized storage checkpoint. Concurrent Fuel migrations 165–166 and other mobile/UI work are preserved.

## Implemented contract

Start Route opens the existing Pre-Trip when needed. Only its server-confirmed pass continues directly to the shared camera/review; an already-passed inspection is reused. The driver confirms the detected total-km reading once to save/start. Ending capture uses the same component in the existing completion screen. Photo-enabled requests have no manual/GPS/saved-mileage/offline-success fallback. Existing account, assignment, timing, inspection, Cargo authority and deliberate geofence-reason rules remain authoritative. Pre-Shift, End Duty and tours are separate.

JPEG/PNG files are byte-validated, at most 5 MB and stored privately. Server-only Gemini reads owned bytes, not client URLs, prior mileage or expected distance. Only clear total km greater than zero and at most 2,000,000, with up to two fractional digits, can become ready. Unknown/miles units, Trip A/B alone and unclear digits require retake/unsupported feedback. Model/schema output shape is not proof of accuracy.

The stable capture ID binds one image to the current trip/driver/vehicle/stage. Retake creates a new ID. Upload retries reconcile exact bytes; scans claim a 30-second lease, cap work at 25 seconds and the provider at 12 seconds, and allow at most three attempts. New drafts are limited to ten per driver/trip/stage per rolling hour. Ready drafts expire after 30 minutes. Compare-and-set finalization prevents an old scan overwriting a newer result. Trip, capture and forward-only vehicle mileage commit together. Same-capture acknowledgement survives later age/geofence/provider changes; a different capture conflicts. Session changes, reassignment and late replies do not submit stale local state. Tracking releases only on confirmed completion.

Driver APIs require current ownership. Staff reads require `trips.read_all`, return committed evidence plus saved trip readings/distance and sign one-hour links with private/no-store responses. Links remain in memory, not caches/outbox or analytics. A holder can use a signed link until expiry; this is not a login check for each object request. Web previews reuse Card/Button/Radix Dialog; unavailable images and failed refresh retain saved numbers and exact focus return. Legacy/missing/active endings are labelled honestly. Later vehicle mileage never replaces a trip's saved ending.

The server setting defaults `ODOMETER_PHOTO_REQUIRED=0`. A successful required or explicit photo start latches the trip requirement. Global rollback stops requiring photos on future starts but preserves latched ending requirements and existing evidence. Older active false-latch trips retain the legacy path.

## Current checks

| Check | Actual result and scope |
|---|---|
| `npm run db:check` | Exit 0; 166 valid migration filenames; frozen historical duplicate set unchanged. |
| `npm run verify:auth` | Exit 0; 339/339 exported methods guarded or explicitly reviewed protocol exceptions. |
| `npm run verify:encoding` | Exit 0; tracked text is valid UTF-8 without reversible mojibake. Existing fsmonitor IPC warning did not fail the check. |
| Supplemental new-file encoding | Exit 0; the unchanged repository UTF-8/mojibake algorithm checked 75 owned feature/document paths, including new untracked source, fixtures and notes. The production gate itself is unchanged. |
| `git -c core.fsmonitor=false diff --check` | Exit 0; only existing LF/CRLF normalization notices. |
| Opt-in SQL | Exit 0; 38/38 cases across the two odometer PostgreSQL files, 48.75 seconds. Includes 21 schema, 7 service and 10 lifecycle cases. |
| Full `test:run` equivalent | Exit 1; 512 passed / 5 failed / 12 skipped files; 5,811 passed / 11 failed / 110 skipped tests. Single worker, no file parallelism. See failure accounting below. |
| Full `lint:ci` equivalent | Exit 1; zero errors, one warning in concurrent `src/app/(dashboard)/fuel/estimates/page.js:487:113` (`react/no-unescaped-entities`); maximum warnings is zero. No suppression added. |
| Webpack production build | Permission retry exit 0 in 105 seconds: installed Next 16.2.11 webpack completed compilation, TypeScript, all 248 static pages, optimization/traces and route output, including all four new odometer boundaries. Existing `src/lib/auth/geoip.js` dynamic-dependency warning persists through sessions/change-password. First attempt exited 1 after 69 seconds on Windows `EPERM` creating `.next/server/app/api/driver-assignments/[id]`; this is retained as a resolved permission failure, not a source compile error. |
| Android export, first attempt | Exit 1; Metro processed 1,475 modules (72.3-second bundle), then Hermes exited 6 because Windows denied writing `index.hbc` in the sandbox temporary directory. Runtime-global/eval and duplicate `borderRadius` warnings were also emitted. This is not a successful bytecode export. Resolved by the automatically approved permission retry: exit 0 in 43 seconds, 1,475 modules bundled in 34.481 seconds, 5.77 MB Hermes bytecode and 88 assets exported to `mobile/.expo/odometer-verify-20261019-permission-retry`. Export is verified; native build/device acceptance is not. |

The SQL command was `ODOMETER_FIXTURE_DB_TEST=1` with `node node_modules/vitest/vitest.mjs run src/services/trip-odometer.service.postgres.test.js src/services/trip-odometer-lifecycle.postgres.test.js --maxWorkers=1 --no-file-parallelism`. It runs actual application SQL in unique throwaway schemas. Schema fixtures roll back; committed concurrency fixtures are dropped afterward. Operating tables/sequences and Storage/Gemini are not exercised. External transport, audit/status and operational authority boundaries are fixtures. Tests cover same-ID upload, changed-image conflict, scan lease/attempt/CAS, expiry, transaction rollback, simultaneous exact/competing confirmations, raw/generic bypass refusal and replay after intervening commit/mileage/age changes.

The initial full run found one stale extracted-handler binding in `cargo-verification-render.test.js` and four stale ownership-query mock cases in `live-monitor/route.test.js`. Those fixtures were corrected without changing production code or assertions; the focused two-file rerun passed 84/84 tests with strict lint. The initial full run is retained as failed, not relabelled green. The three Git temporary-directory permission failures in encoding-gate tests and one Windows Git historical-diff helper failure were retried outside the restricted permission profile after automatic approval: encoding-gate/config-secrets passed 47/47 across two files in 9.06 seconds, with no source edits. Two unrelated date-tab/Off Duty source assertions remain unresolved. No test/threshold was removed or weakened.

Earlier independent scoped reports remain evidence for their own revisions: Task 4 fixed 223 focused cases; Task 5 fix checked 98 cases across seven files; Task 6 fix checked 12 cases across two files. These are not added into an invented combined total. Logs, scoped review reports/diffs, command results and catalog JSON are archived locally at `C:/Users/lenovo/.codex/visualizations/2026/10/16/01a146dd-bcfe-76c1-bd37-5116b68042b3/odometer-verification-evidence.zip`. The plan-specific ignored coordination workspace was removed after the clean final review; the durable notes and archive preserve the evidence.

## Read-only database privacy checkpoint

On 2026-10-19, `db:status` returned 166 applied / zero pending / zero changed-applied checksums. `db:contract` covered 89 relations with zero violations. `verify:anon` returned zero exposed / 41 explicit refusals / 48 inconclusive / zero unreachable; raw exit 1 is preserved. The live contract explains the inconclusive cases; an empty response is never called a refusal. `trip_odometer_captures` explicitly refused HTTP 401 / SQLSTATE 42501.

Scoped catalog verification confirms RLS enabled, no anon/authenticated table grants (including TRUNCATE), no capture policies, and the private JPEG/PNG 5,242,880-byte bucket. Existing permissive Storage policies cover other buckets; no policy permits this bucket. The cargo policy is restrictive and grants nothing. `schema.sql` shows structure, not grants/policies/cron; the catalog JSON is the security evidence. No user photo was uploaded to prove a real link expiry.

## Browser evidence and its limits

Actual mobile capture components with shared Clay controls, theme, Plus Jakarta Sans/data fonts and icons rendered at 390×844 light and 320×740 dark with 2× text. There was no horizontal overflow; actions remained reachable by scrolling/focus. Denied-camera and retry states were also rendered. Camera, OS permissions, focus and insets were mocked; existing react-native-web shadow deprecation warnings were disclosed.

Actual web evidence with shared CSS, Inter, Card/Button/Radix Dialog rendered at 360 dark, 768 light, 1280 light and 1440 error/retry. Images were synthetic and labelled. Two-column alignment, missing ending/distance, saved-reading retention, GPS provenance, normal/broken/null-URL refresh, focus trap, Escape and exact focus return passed. A delayed image retained its 508×317.5 well before/after load and left other controls reachable. These checks do not establish an authenticated whole Trip Details session. Controller evidence: `mobile-visual-check.md`, `web-visual-check.md` and screenshots `odometer-mobile-review.png` / `odometer-web-review.png` in the task's local visualization folder.

## Final implementation review and fixes - 2026-10-19

The final independent whole-feature review identified two mobile integration defects. Both were fixed and independently re-reviewed: the scan POST now has no body, matching the strict server route; an uncertain confirmation can explicitly reconcile the same capture after local expiry. A committed capture reaches normal navigation/tracking cleanup, while an expired uncommitted capture requires Retake. No timer submits a transition and retries do not create a new capture ID.

The affected regression run passed 77/77 tests across seven files; strict lint passed for all four changed source/test files with zero warnings. The route regression executes the real mobile wrapper, apiFetch, Next Node adapter and scan route. Recovery fixtures execute the actual start/end screens and shared hook. External/native/session boundaries remain fixtures. The final scoped review found no additional important defect and requested no further source fixes: ready with acceptance holds.

After these two helper fixes, a fresh Android export passed with exit 0 in 50 seconds: 1,475 modules, 5.77 MB Hermes bytecode, 88 assets, output `mobile/.expo/odometer-final-20261019`. The production server did not change after the successful webpack build. This is export evidence, not an installed native build or physical-device acceptance.

## Remaining release acceptance (local activation explicitly authorized above)

- [x] Complete independent whole-feature review and scoped fix re-review; both findings addressed, no additional important defect found.
- [x] Resolve/review remaining shared regression/lint failures. The later local-activation checkpoint above records the fresh passing whole-suite and strict lint results.
- [ ] Run real native camera and permission denial/Settings recovery; foreground/background; portrait/landscape; small/large phones; large text, dark/high-contrast/reduced motion; TalkBack/VoiceOver; actual SOS/tab/safe-area overlap.
- [ ] Evaluate authorized fleet photos: at least 20 readable and 10 deliberately unsuitable examples, covering every actual dashboard type, digital/mechanical, leading zeros, decimals, glare, low light, blur, Trip A/B and units. Record expected/extracted value, ready/retake result and model/`odometer-v1` scan version. Any wrong value marked ready blocks activation.
- [ ] In an authorized configured environment, complete eligible Passenger and Cargo trips with two real private objects and saved rows; verify distance, forward-only mileage, fuel snapshot behavior and history after a later trip. Cargo production authority remains disabled; fixture refusals are not operational acceptance. Do not enable providers just for this check.
- [ ] Perform real response-loss/concurrent/session/reassignment/geofence/outage/flag-rollback acceptance; mocked and isolated SQL behavior above is not a physical operational pilot.
- [ ] Verify actual authenticated staff/driver roles and real copied private-link expiry. A one-hour parameter and mock URL do not prove observed expiry.
- [ ] Deploy compatible migration/server/mobile/web to hosted production only through the explicit release process. Local activation was explicitly authorized and completed above; this does not establish hosted release acceptance or alter hosted settings.
