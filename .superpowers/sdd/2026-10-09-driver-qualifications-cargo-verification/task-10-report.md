# Task 10 — account-scoped mobile cargo drafts and replay

Status: IMPLEMENTED — scoped commit recorded below. Base: `0b51f028c63240af459cf7251220fbd95d29c4d8`.

## Result

Added a cargo-specific offline queue in `mobile/lib/cargo-drafts.js`; it remains separate from the generic JSON outbox. Draft ownership comes only from the authenticated login's camelCase `employeeId`. No fallback treats `driverId` as employee authority. Data is stored under an employee-keyed AsyncStorage entry, and list/update operations filter by that same owner. The queue holds at most 100 unresolved submissions. A full queue returns `CARGO_QUEUE_FULL` and leaves existing evidence intact.

Each receipt draft gets one persisted UUID `submissionId`; every staged file gets a separate persisted upload UUID. Upload replay extracts Task 7's server ID from `data.evidence_upload.evidence_id`, stores it before proceeding, then places the ID in the receipt's line `evidence_ids`. The original receipt payload and ID remain stable on retries. A recount is saved as a separate draft with a new submission ID. The full response is retained by the API wrapper, and no screen snapshot is replaced by an older exact-replay upload response.

The typed API wrapper uses Task 7's GET execution, POST evidence and POST receipt routes. Cargo requests disable generic outbox queuing and carry the employee actor fence through every fetch. The queue serializes one drain per actor, checks the current manifest before upload, uploads staged evidence first, then submits the receipt. Account switch, logout and session expiry abort the underlying request and fence late responses before they can update A's draft or submit its receipt. Auth restore and login register only the actual `employeeId`; foreground and network reconnection trigger a bounded drain.

The queue distinguishes device-saved, Fleet-saved and partner-received state. A Task 9 ACK remains receipt-only. HTTP 401 is marked for reauthentication; 403/404 are retained for terminal review; 409 preserves the stale draft and prevents replay; transport errors and disabled 503 responses retain device-saved data. No source decision, lifecycle transition, departure or clearance is queued.

The repository has no approved mobile photo or byte limits in the Task 10 preflight. This change does not invent a media-size/capture policy or retention cleanup. Saved files and unresolved drafts are preserved. Server provider routes remain disabled; there were no real uploads, partner sends, production writes, UI changes or native-device acceptance claims. The installed Expo 54 / React Native 0.81.5 versions and dependencies remain unchanged. The required Expo 57 docs were consulted; they target RN 0.86.

## TDD and verification

The initial focused RED run could not resolve Vitest's installed dependency inside the Windows filesystem sandbox (`EPERM`, before test collection). Rerunning the same command outside the sandbox produced 10 expected missing-module failures. Tests were then implemented before production modules.

Final affected suites after actor-signal abort wiring: `cargo-api.test.js`, `cargo-sync.test.js`, and `api-refresh.test.js` — 3 files / 23 tests passed. The account-switch test verifies the actual fetch signal aborts, the late response is rejected, and no receipt or evidence ID is written to the old account's queue. Session expiry and current-owner mismatch are also covered. In the preceding focused run, `cargo-drafts.test.js` (3), `sync.test.js` (6), and `offline-cache.test.js` (12) passed, for 44/44 across the six targeted files; those unchanged suites were not rerun after the final abort-only wiring change.

Touched ESLint with `--max-warnings 0` passed, and `git diff --check` passed. No Android SDK/device was available, so native file access, app-state/reconnect UI behavior and physical-device acceptance remain unverified. No Expo SDK upgrade or Android build was attempted.

## Scoped commit

Commit: `feat: retain scoped offline cargo evidence without false clearance` (this report is included in the commit).

Only Task 10 mobile code/tests, this report, its architecture note, its SYSTEM paragraph and its recovery-ledger checkpoint are to be committed. Pre-existing fuel/mechanic and root documentation edits remain outside this Task 10 commit.

## Fix round 1 — review findings

Addressed all four important findings. Queue `saveCargoDraft` and `updateCargoDraft` now serialize each owner's complete queue mutation, including the unresolved-capacity check and the read/replace/write. Sync passes a generation predicate into the storage mutation; it is checked after queue read and immediately before writing, preventing a late A upload response from checkpointing its evidence into A's queue after the session changes. The existing upload abort test asserts the real request signal is aborted and the late response writes neither evidence ID nor a receipt. Added deterministic paused-read coverage for overlapping saves and account fencing, plus a save concurrent with the upload evidence checkpoint.

Cargo refreshes now capture the authenticated session generation and signal. All refresh requests/retries, awaited response handling, token saves, session cleanup and expiration callbacks recheck the session. Auth token writes and clearing use a shared serialized storage mutation, guarded at execution time, so an old refresh cannot overwrite or clear a later account's tokens. Cargo and generic requests in the same generation share the existing single refresh flight; a different generation cannot join it. Regressions cover account switch and logout while refresh is pending, underlying signal abort, no late token overwrite/restore, and same-session single flight.

Later Task 9 feedback is reconciled on a future drain through Task 7's GET view only when the current stage receipt ID matches the locally saved receipt. A 503 or other unavailable view leaves the local state untouched. ACK is stored/displayed only as partner receipt feedback. Fleet-saved and partner-received summary flags now describe the latest recount, and saved delivery drafts retain the delivery receipt ID when both stage receipts are present.

The minor pickup-versus-delivery receipt ID finding was fixed in this round. UI work remains with Task 12; providers remain disabled; no operational evidence was sent and no media policy or retention cleanup was added.

### Fix-round verification

Initial sandboxed RED and affected-suite attempts were blocked before Vitest collected tests by Windows `EPERM` resolving `node_modules/vitest/dist/spy.js`; these are not recorded as test failures. The exact affected-suite command was then run with approved filesystem escalation:

`npx vitest run mobile/lib/cargo-drafts.test.js mobile/lib/cargo-sync.test.js mobile/lib/api-refresh.test.js mobile/lib/cargo-api.test.js`

At the first successful run: 4 files / 34 tests passed (cargo drafts 6, cargo sync 13, API refresh 14, cargo API 1). The change set then gained one pending-logout refresh regression; final rerun and final counts are recorded below.

`npx eslint mobile/lib/cargo-drafts.js mobile/lib/cargo-drafts.test.js mobile/lib/cargo-sync.js mobile/lib/cargo-sync.test.js mobile/lib/cargo-api.js mobile/lib/cargo-api.test.js mobile/lib/api.js mobile/lib/api-refresh.test.js mobile/lib/storage.js --max-warnings 0` passed. `git diff --check` passed. No native-device acceptance claim is made.

Final fix-round rerun after adding the logout race regression: the same four affected suites passed, 4 files / 35 tests (cargo drafts 6, cargo sync 13, API refresh 15, cargo API 1). This is the final affected-suite count.

Scoped fix commit: `fix: fence cargo queue mutations and refresh sessions` (this report is included). Only Task 10 implementation/tests, the Task 10 report, Mobile Architecture addition, and Task 10-only SYSTEM/progress append hunks were included. Unrelated dirty checkout changes remain unstaged.
