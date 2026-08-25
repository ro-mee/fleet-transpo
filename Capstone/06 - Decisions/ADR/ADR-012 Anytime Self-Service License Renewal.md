---
type: adr
number: 012
title: Anytime Self-Service License Renewal
date: 2026-08-25
status: accepted
tags: [decision, drivers, gemini, mobile, policy]
---

# ADR-012: Anytime Self-Service License Renewal

## Context

Drivers renew their LTO license physically, then the system's record had to catch up. The original self-serve design allowed a driver to re-upload a license scan only when there was **no scan on file** or when the license was **within 30 days of expiry** (`canUpdateLicenseScan`, `LICENSE_REUPLOAD_WINDOW_DAYS = 30`). The window was INFERRED protection against churn; it also meant:

- a driver who renewed early could not update the record for months;
- even after an upload, `license_expiry` stayed stale — only staff could fix the date, so "self-service" stopped halfway;
- nothing told staff a scan had changed;
- nothing verified the uploaded photo actually *was* an LTO card (the gate checked readability only).

## Decision

1. **Remove the 30-day window.** License scans are re-uploadable at any time, from any side.
2. **One call does everything.** `POST /api/driver/license-scan` is now the single self-serve endpoint: Gemini verifies the photo is genuinely an LTO card (`document_is_license_card` boolean in the response schema), reads the fields, and **on pass persists the scan itself** and applies a future-dated `license_expiry` read off the front of the card (`src/lib/ai/license-scan-policy.js`). The mobile app no longer PATCHes `/api/driver/me` for this (that path still works, ungated, for compatibility).
3. **Fail closed on authenticity.** Anything that fails verification — not a card, unreadable, Gemini unavailable — writes nothing. `null`/missing boolean counts as "not a card".
4. **Notify staff best-effort.** Ops roles (`system_admin`, `admin`, `fleet_manager`) get an in-app notification + push per the established recipe, referencing the driver record.

## Consequences

- The compliance loop is genuinely self-serve: physical renewal → photo → record updated, expiry included.
- Staff attention shifts from *doing* updates to *seeing* them; the notification is quiet (`Info` tier), so noisy abuse would go unnoticed — acceptable at fleet scale.
- Trust shifts from a time window to Gemini's judgment. A convincing forgery that Gemini misjudges as genuine would be stored — the mitigation is the staff notification trail plus the stored image itself being inspectable.
- Expiry auto-apply accepts only future dates, so an expired-card upload cannot roll compliance backwards.

→ [[Driver Consent]] · [[Driver Management]] · [[Graceful Degradation]]
