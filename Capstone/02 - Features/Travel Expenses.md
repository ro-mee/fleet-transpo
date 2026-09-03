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

The reviewer can:
- **Approve**: Marks the expense as verified. It now contributes to analytics.
- **Reject**: Requires a written `review_remarks` explaining the rejection.

## Role Based Access Control
- **Driver**: Can submit expenses and view their own history.
- **Admin / System Admin / Fleet Manager / Management**: Can access the Finance Dashboard to view all expenses and their analytics.
- **Review Authority**: Only `admin`, `system_admin`, `fleet_manager` possess the `review` permission for expenses. `management` is strictly read-only for analytics.
