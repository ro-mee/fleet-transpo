# Travel Expenses & Company Cards

The Travel Expenses & Company Cards module handles driver-submitted trip and business expenses outside of fuel. It enforces strict financial invariants identical to the Fuel module: no expense enters official financial analytics without explicit authenticated Finance approval.

## Financial Invariant
> No expense enters official financial analytics without explicit authenticated Finance approval.

OCR extraction does NOT mean Approved.
Driver confirmation does NOT mean Approved.
Payment by Company Card does NOT mean Approved.

Only when a Finance user reviews the system-determined context (OCR vs Driver Confirmed vs Trip Attribution vs Duplicate Flags) and clicks "Approve" does the expense become recognized for analytics and budgeting.

## Architecture & Data Flow

### 1. Database Schema
- **`company_cards`**: Tracks physical or virtual cards (label, last four digits, provider, status, monthly limit).
- **`company_card_assignments`**: Maps cards to employees or vehicles over time (allows historical assignment tracking, unassigned cards, shared cards).
- **`expense_records`**: Central ledger for all expense submissions (Toll, Parking, Meals, Lodging, Other). Stores both raw AI-extracted OCR data and driver-confirmed data.

### 2. Submission Pipeline (Mobile API)
1. **Upload**: Drivers scan a receipt. The image is uploaded securely to Supabase Storage (`expense-receipts` bucket) and returning a secure storage key.
2. **Scan**: The image is analyzed using Google Gemini 2.5 Pro (`gemini-expense-receipt.js`). The server returns a structured snapshot containing inferred category, merchant, amount, date, and currency.
3. **Submit**: The driver confirms or edits the data. The server receives the submission and computes anomalies.

> **The stored object's extension is server-derived — 2026-09-17.** It used to come
> from `file.name?.split(".").pop()`, so a `receipt.html` declared as `image/png`
> was stored as `<uuid>.html` under `Content-Type: image/png`. The file is now
> always `receipt.<ext>` where `<ext>` is what the magic-byte validator returned.
> The path shape (`{driverId}/{clientSubmissionId}/`) and `upsert: true` are
> deliberate and unchanged — SEC-RACE-002 verified they are what makes retries
> idempotent. Found by the security assessment (SEC-UPLOAD-002, LOW); [[Fuel]]
> carries the same fix. The `expense-receipts` bucket is the one storage path that
> already does this correctly end to end: it stores a **key**, not a URL, and
> `getExpenseReceiptSignedUrl` mints a 1-hour URL per read.

### 3. Server-Side Context & Attribution (Phase 5 & 6)
Upon submission, the backend automatically derives context:
- **Trip Attribution**: Is the driver currently on an Active Trip? If yes, `trip_id` and `vehicle_id` are derived and locked to the expense.
- **Vehicle Attribution**: If no trip, is the driver assigned to a vehicle? If yes, `vehicle_id` is assigned.
- **Anomaly Detection (Duplicate Flags)**:
  - `NO_ACTIVE_TRIP` / `NO_VEHICLE_ASSIGNMENT` / `UNATTRIBUTED_EXPENSE`: Driver is untethered from operations.
  - `DUPLICATE_RECEIPT_HASH`: Same receipt image SHA256 was uploaded previously.
  - `POTENTIAL_CARD_DUPLICATE`: Same merchant and amount on the same company card within a 1-hour window.
  - `POTENTIAL_DRIVER_DUPLICATE`: Same merchant and amount submitted by the same driver within a 24-hour window.
- **Idempotency**: Submissions use a `client_submission_id` to prevent duplicate rows during network retries.

### 4. Finance Verification Studio
Finance reviewers access the dashboard to see all Pending submissions.
The review modal presents a side-by-side comparison:
- OCR Extracted values vs Driver Confirmed values.
- Trip and Vehicle attribution context.
- System-generated Anomaly Flags.
- The secure receipt preview resets its loading state and cancels the previous
  URL request when reviewers switch records, so a prior receipt cannot appear
  under a newly selected expense.

The reviewer can:
- **Approve**: Marks the expense as verified. It now contributes to analytics.
- **Reject**: Requires a written `review_remarks` explaining the rejection.

## Role Based Access Control
- **Driver**: Can submit expenses and view their own history.
- **Admin / Super Admin / Fleet Manager / Management**: Can access the Finance Dashboard to view all expenses and their analytics.
- **Review Authority**: Only `admin`, `super_admin`, `fleet_manager` possess the `review` permission for expenses. `management` can inspect records/receipts and analytics but cannot approve or reject.

## Verified web audit corrections - 2026-10-26

Source inspection confirmed complete employee/reviewer records were being serialized by the expense registry, and complete employee/assigner records by card reads. These joins now select only employee ID and first/last names; expense driver identity no longer includes unrelated driver fields. A read-only live query check verified the current SQL and identity keys without disclosing records. This is a source fix, not a claim of a production deployment.

The registry now uses the shared table's actual server-pagination, search and sort properties. The API honors only explicitly allowlisted sort columns, with a stable ID tie-breaker; invalid page values fail before querying. CSV collection walks the whole selected status/search/sort result and includes Currency. A later-page error or collection limit fails the export rather than producing a successful partial file. Empty results do not claim a download succeeded. The PHP approved-cost summary excludes other/missing currencies and states their count separately; records and exports retain them.

The `/expenses` route and list/receipt APIs now share the documented expense read permission. Super Admin, Admin, Fleet Manager and Management have sidebar access; Dispatcher, Driver and Mechanic are denied the all-employee registry. Management's modal is read-only. Existing review permission, required rejection reason and audit transaction remain authoritative. Receipt and card-detail/history routes correctly await Next.js route parameters.

Verified with API/service/rendered-page regression tests, role allow/deny checks, strict touched-source lint and actual read-only expense/card SQL. An isolated synthetic browser fixture checked the 360 px expense layout and contained table scrolling. Full authenticated review/receipt/CSV acceptance remains separate. See [[FleetOps Web Audit]] for the consolidated verification and [[Reports]] for approved-expense reconciliation.
