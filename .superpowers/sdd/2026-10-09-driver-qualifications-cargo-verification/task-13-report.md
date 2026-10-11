# Task 13 cargo demo scenarios and mobile preview

Status: implemented and verified as a read-only mobile demo. It does not enable production cargo APIs, data writes, provider access or reporting.

## Implemented

- Added deterministic sample records for Guest/VIP transport and the three shared restaurant/hotel cargo services.
- Added clean receipt, accepted shortage, WAIT/recount, rejected shortage, delivery discrepancy and partner-timeout cases. The recount retains the sample trip, manifest and execution identity but uses a new receipt.
- Added the public `/cargo-demo` mobile route and a sign-in entry. It opens on the 10-expected / 9-counted WAIT case. The user can switch to the recount and other sample cases without sending a request or saving data.
- Kept all cargo image references null and evidence lists empty. The screen contains no API, draft, sync, device-storage, upload or partner-message calls.
- Kept Guest/VIP in a separate passenger example; restaurant and hotel cases use one shared cargo presentation.

## Verification

- Focused fixture, presentation and rendered-screen tests: 16 passed.
- Complete mobile regression: 59 files and 632 tests passed.
- Touched-file ESLint: zero warnings; `git diff --check` passed.
- Expo export: Android, iOS and web completed. Expo reported the intentionally absent Google services config file; this did not prevent export.

The fixtures and screen do not call a live provider or write to the database.

## Still required for live operation

The current cargo runtime remains fail-closed/503. No production source, Fleet safety, lifecycle, receiver, storage or partner provider was installed. The owner worksheet still has no named/approved source API contract, load-securement procedure, receiver confirmation authority or evidence privacy/retention policy. Source thumbnails remain unavailable. D09 reporting definitions also remain unapproved, so no cargo KPI labels or production report were added. Use real owner decisions and integration documentation before implementing or enabling those paths.
