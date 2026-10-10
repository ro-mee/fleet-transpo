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
