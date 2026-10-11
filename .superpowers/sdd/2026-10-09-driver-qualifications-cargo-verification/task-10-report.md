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

Final scoped re-review correction: moved the stage-specific receipt-ID lookup into `updateCargoDraft`'s serialized mutation callback, so no read that informs the submitted state can race another owner mutation. After this final code adjustment, the exact affected-suite command above was rerun: 4 files / 35 tests passed (cargo drafts 6, cargo sync 13, API refresh 15, cargo API 1); zero-warning touched ESLint and `git diff --check` passed again. This 35-test count is the final amended focused run only; no unchanged generic outbox/offline-cache tests are included. The delivery receipt-ID Minor is addressed.

## Fix round 2 — sign-in ordering and verification evidence

The successful login persistence flow now lives in `mobile/lib/auth-session.js`, which is called by the real `signIn` callback. It invalidates the previous cargo actor generation before invoking the serialized token write, then binds the newly authenticated employee after that write. This closes the ordering window where an A refresh already queued behind B's token write could still pass its predicate while A remained current. The regression invokes this production persistence helper, pauses the new login's SecureStore write, queues a stale A token commit behind it, and confirms A is already fenced and the stale commit never reaches SecureStore. The existing same-generation cargo/generic refresh single-flight regression remains in the same suite.

### RED evidence

Command:

`npx vitest run mobile/lib/api-refresh.test.js -t "reproduces sign-in writing B credentials before invalidating A's queued refresh"`

On the pre-fix sign-in ordering, the deterministic paused-write reproduction failed the final preservation assertion: 1 test failed, 15 skipped, exit code 1. The failure showed that the late A refresh write replaced the expected B refresh token. Test fixture credential values are intentionally omitted here.

### Final affected-suite evidence

Command:

`npx vitest run mobile/lib/cargo-drafts.test.js mobile/lib/cargo-sync.test.js mobile/lib/api-refresh.test.js mobile/lib/cargo-api.test.js`

Captured runner summary:

```text
✓ mobile/lib/cargo-api.test.js (1 test)
✓ mobile/lib/cargo-drafts.test.js (6 tests)
✓ mobile/lib/cargo-sync.test.js (13 tests)
✓ mobile/lib/api-refresh.test.js (16 tests)
Test Files  4 passed (4)
Tests       36 passed (36)
Duration    3.88s
Exit code   0
```

The same-generation cargo/generic refresh single-flight case remains covered. No unrelated outbox/cache suites are included in this round's 36-test result.

Lint command:

`npx eslint mobile/lib/auth.js mobile/lib/auth-session.js mobile/lib/api-refresh.test.js mobile/lib/api.js mobile/lib/storage.js mobile/lib/cargo-sync.js mobile/lib/cargo-drafts.js --max-warnings 0`

Captured result: exit code 0, no output and no warnings.

Whitespace command:

`git diff --check`

Captured result: exit code 0, no whitespace findings. Git printed only existing fsmonitor IPC and line-ending normalization warnings for this dirty Windows checkout.

No provider activation, real evidence upload, UI change, device acceptance claim, retention policy or photo policy was introduced. The existing unrelated fuel/mechanic checkout changes remain unstaged.

Task 10 review fix round 3 (2026-10-11): Generic 401 refreshes now capture a generation snapshot even when no employee is signed in; `null` no longer means an unfenced global refresh. Cargo sessions distinguish anonymous, authenticated, and sign-in transition phases. A transition is not refreshable, and sign-in invalidates the prior generation before token persistence. Generic and cargo refreshes in the same authenticated generation still share one flight. The auth storage layer writes a durable transition marker before replacing credentials, marks the session active only after both tokens and the employee record are saved, and writes a signed-out marker before credential cleanup. Cold start restores only complete token pairs with a stored user and no transition/signed-out marker.

If SecureStore rejects token persistence, the real sign-in persistence helper clears the React identity and attempts cleanup while keeping the in-memory session in its non-refreshable transition phase until cleanup finishes. If cleanup itself fails, the durable signed-out marker prevents cold-start restore of a stale or partial pair. Token-pair writes await both native writes before reporting failure, so cleanup cannot race an outstanding half-write.

Regression coverage includes a generic 401 during a paused B sign-in write (no refresh request), generic refresh success and rejection arriving after B binds (neither overwrites nor clears B), rejected SecureStore token persistence with failed deletion (no UI actor and no cold-start restore), and the existing same-generation cargo/generic single-flight case.

RED evidence (before the transition-generation fix):

Command: `npx vitest run mobile/lib/api-refresh.test.js`

Captured runner summary: `mobile/lib/api-refresh.test.js (17 tests | 1 failed)`; `Tests 1 failed | 16 passed (17)`; exit code 1. The deterministic generic-401 case observed one refresh during the pending sign-in write where zero were expected. No fixture credential values were emitted.

Final affected-suite evidence after all round-3 code changes:

Command: `npx vitest run mobile/lib/cargo-drafts.test.js mobile/lib/cargo-sync.test.js mobile/lib/api-refresh.test.js mobile/lib/cargo-api.test.js`

Captured runner output summary:

```text
✓ mobile/lib/cargo-api.test.js (1 test)
✓ mobile/lib/cargo-drafts.test.js (6 tests)
✓ mobile/lib/cargo-sync.test.js (13 tests)
✓ mobile/lib/api-refresh.test.js (20 tests)
Test Files  4 passed (4)
Tests       40 passed (40)
Exit code   0
```

The runner printed only the normal missing `EXPO_PUBLIC_API_URL` development warning; these tests stub network calls and did not activate a provider or send evidence.

Scoped lint command: `npx eslint mobile/lib/auth.js mobile/lib/auth-session.js mobile/lib/api-refresh.test.js mobile/lib/api.js mobile/lib/storage.js mobile/lib/cargo-sync.js mobile/lib/cargo-drafts.js mobile/lib/cargo-api.js mobile/lib/cargo-drafts.test.js mobile/lib/cargo-sync.test.js mobile/lib/cargo-api.test.js --max-warnings 0` — exit code 0, no lint findings. The npm client printed only its optional update notice.

Scoped whitespace command: `git diff --check -- mobile/lib/auth.js mobile/lib/auth-session.js mobile/lib/api-refresh.test.js mobile/lib/api.js mobile/lib/storage.js mobile/lib/cargo-sync.js mobile/lib/cargo-drafts.js mobile/lib/cargo-api.js mobile/lib/cargo-drafts.test.js mobile/lib/cargo-sync.test.js mobile/lib/cargo-api.test.js 'Capstone/04 - Architecture/Mobile Architecture.md' SYSTEM.md '.superpowers/sdd/2026-10-09-driver-qualifications-cargo-verification/task-10-report.md' '.superpowers/sdd/2026-10-09-driver-qualifications-cargo-verification/progress.md'` — exit code 0, no whitespace findings. Git emitted only existing Windows fsmonitor and line-ending normalization warnings.

No UI, dependency, Expo version, provider, real upload, native-device claim, media policy, or retention change was introduced.

## Fix round 4 — settle failed cleanup before retrying sign-in

Base: `76bd2c7880a9149da83e6b63b7c5c03661ffee4b`. Status: implemented and verified; independent scoped re-review pending. The interrupted round-4 implementer's existing storage/test diff was inspected and retained without further code changes.

`clearAll` now uses `Promise.allSettled` for its native deletions and releases the shared auth mutation only after every deletion settles. It then throws the first recorded failure. Previously, `Promise.all` could reject while another deletion was pending, allowing a new sign-in to save credentials that the old pending deletion would remove.

The regression suite checks failed deletion with successful sibling cleanup, then separately pauses refresh-token deletion and user deletion during a failed sign-in. A retry cannot write its tokens or finish while that deletion remains pending; after release, its complete session and current actor remain intact. The transition and signed-out marker cases independently start with a restorable complete access-token/refresh-token/user record, change only the persisted marker, verify that all three records remain, and verify that restoration is rejected. Token equality assertions emit booleans instead of credential fixtures.

The prior round-4 implementer reported a pre-fix RED run of 2 failed / 22 skipped and an initial GREEN run of 45 tests, but did not finish the captured report before interruption. Those inherited results are not presented as a fresh run. The final verification below was captured during this completion pass on the unchanged implementation/test diff.

### Final captured verification

Exact covering command:

`npx vitest run mobile/lib/cargo-drafts.test.js mobile/lib/cargo-sync.test.js mobile/lib/api-refresh.test.js mobile/lib/cargo-api.test.js`

The first sandboxed attempt exited 1 before test collection: Vitest reported four `EPERM` errors resolving `node_modules/vitest/dist/spy.js`, with `Tests no tests`. This was an environment failure, not a failing test result. The same command was rerun with approved filesystem escalation. Sanitized concise stdout:

```text
RUN v3.2.7 C:/Users/lenovo/OneDrive/Desktop/capstone
✓ mobile/lib/cargo-api.test.js (1 test) 4ms
✓ mobile/lib/cargo-drafts.test.js (6 tests) 175ms
✓ mobile/lib/cargo-sync.test.js (13 tests) 332ms
✓ mobile/lib/api-refresh.test.js (25 tests) 3476ms
Test Files  4 passed (4)
Tests       45 passed (45)
Duration    4.28s
Exit code   0
```

Stderr contained only the expected missing `EXPO_PUBLIC_API_URL` development warning. Network calls are mocked; no real upload or provider activation occurred. Unchanged generic outbox/offline-cache suites are not included in this round's 45-test total.

Scoped lint command:

`npx eslint mobile/lib/storage.js mobile/lib/api-refresh.test.js --max-warnings 0`

Captured result: exit code 0, no lint findings or warnings; npm printed only its optional update notice.

Scoped whitespace command:

`git -c core.fsmonitor=false diff --check -- mobile/lib/storage.js mobile/lib/api-refresh.test.js 'Capstone/04 - Architecture/Mobile Architecture.md' SYSTEM.md '.superpowers/sdd/2026-10-09-driver-qualifications-cargo-verification/task-10-report.md' '.superpowers/sdd/2026-10-09-driver-qualifications-cargo-verification/progress.md'`

Captured result: exit code 1 from pre-existing CRLF/trailing-whitespace changes throughout the shared recovery ledger. These unrelated ledger changes were preserved and excluded from staging. Repeating this command without the ledger returned exit code 0, no whitespace findings, and only Windows line-ending normalization warnings. `git -c core.fsmonitor=false diff --cached --check` on the staged Task 10-only diff, including only this round's ledger append, returned exit code 0 with no output.

Mobile Architecture and the Task 10 SYSTEM paragraph now identify the current four-suite / 45-test evidence and the cleanup/marker behavior. No provider, UI, real upload, retention/media policy, dependency, native-device acceptance or unrelated fuel/mechanic/status change is included. Recovery status is appended to the existing ledger; other scratch files remain ignored.

Scoped commit title: `fix: wait for mobile session cleanup before retry sign-in`. Exact commit identity is recorded in the recovery ledger after commit.
