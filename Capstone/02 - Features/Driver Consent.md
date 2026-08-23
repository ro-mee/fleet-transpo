---
type: feature
status: working
tags: [feature, consent, privacy, drivers]
source:
  - src/lib/consent/driver-visibility.js
  - supabase/migrations/017_driver_consents.sql
  - mobile/app/(app)/profile/license.js
  - mobile/lib/permissions.js
last_verified: 2026-08-23
---

# Feature: Driver Consent

## What it does

Governs what a driver can **see** about themselves and what they can **change**, plus recorded consent (migration `017_driver_consents.sql`). 

The mobile app forces drivers through a **3-screen onboarding flow** before accessing the app:
1. **Login**: Authentication screen.
2. **Consent Gate**: Requires acceptance of the Data Privacy Policy.
3. **Permissions Gate**: Requests Location (GPS tracking for shifts) and Camera (for fuel receipts) access via native OS prompts.

## The allow-lists — CONFIRMED (`src/lib/consent/driver-visibility.js`)

```js
DRIVER_VISIBLE_SECTIONS = ["profile", "license", "performance",
                           "trip_history", "attendance"]

DRIVER_SELF_EDITABLE_FIELDS = ["phone", "face_image_url",
                               "license_image_url", "license_back_image_url"]

LICENSE_REUPLOAD_WINDOW_DAYS = 30
```

**Allow-list, not deny-list.** Add a column to `drivers` tomorrow and it is *not* driver-editable until someone deliberately adds it to the array. The safe default is the automatic one. → [[Fail Closed By Default]]

Note what a driver **cannot** edit: name, licence number, licence expiry, employment status. They can update contact details and re-upload photos of documents — the things only they can supply — and nothing that would let them misrepresent their credentials.

## The 30-day re-upload window

`canUpdateLicenseScan()` blocks licence re-scans inside a 30-day window. INFERRED: to prevent repeated re-uploads being used to churn the licence record — but the repository does not currently document why this specific window was chosen.

## OS permission registry — CONFIRMED (`mobile/lib/permissions.js`, 2026-08-23)

The mobile app tracks **five OS permissions** in one registry: foreground location, background location, camera, photo library, notifications. Each entry carries `check()` / `request()` against the matching Expo API and normalizes to `{ status: granted|denied|undetermined, canAskAgain }`.

Two consumers:
1. **Onboarding gate** (`mobile/app/permissions.js`) — now requests all five from the registry (was hardcoded to location + camera only) and shows a live status pill per card. Still non-blocking: denials are recorded, not fatal.
2. **Settings → PERMISSIONS** (`mobile/app/(app)/settings.js`) — the revisit point. A summary cluster ("DEVICE ACCESS · 4 OF 5" with one tappable segment per permission) sits above an accordion list: each row expands to show what it powers, what breaks without it ("Without it: …"), and an explicit action — **Allow** (re-prompt), **Open device settings** (permanently blocked → `Linking.openSettings()`), or a quiet "Managed in your device settings" note when approved. Statuses refresh on screen focus and on return from OS Settings via `AppState`; expand/collapse animates via `LayoutAnimation`, skipped when the OS reduce-motion setting is on. Layout is centered at `maxWidth` on wide screens (tablet/landscape/web).

The PREFERENCES toggles above it (Push Notifications, Location Tracking) remain app-level choices in `settings-context` — deliberately separate from what the OS has actually granted.

## Mobile scan upload flow — CONFIRMED (`mobile/app/(app)/profile/license.js`, 2026-08-23)

The mobile **License & Compliance** screen implements the full self-service scan replacement:

1. Driver picks **Take Photo** (camera) or **Gallery** (`expo-image-picker`) per side (front/back).
2. The image is resized to ≤1400 px and compressed to JPEG, then sent as a base64 data URL.
3. `POST /api/driver/license-scan` runs the OCR gate first — an unreadable scan is shown the retake guidance and **never saved**.
4. On pass, `PATCH /api/driver/me` with `license_image_url` / `license_back_image_url`; the server re-runs `canUpdateLicenseScan()` and rejects outside the window (**fail closed** — UI gating is cosmetic, the DB gate is authoritative).
5. The screen shows a compliance status pill (Expired / Expires in N days within the 30-day window / Valid) computed with the same local-calendar math as `daysUntilLicenseExpiry()`, plus an explanatory hint on locked sides.

## Consent records

`driver_consents` (migration 017) records that a driver agreed to something — INFERRED: location tracking and personal-data handling, given the GPS feature. **TODO:** read the migration to confirm the consent types.

## Why this feature exists at all — INFERRED

A driver app that reports continuous location and stores licence photographs collects personal data. Recording consent and constraining self-service is the minimum responsible handling. For a Philippine deployment, the Data Privacy Act is the relevant backdrop.

## Related

[[Driver Management]] · [[Tracking]] · [[RBAC]] · [[Fail Closed By Default]] · [[Feature Index]]
