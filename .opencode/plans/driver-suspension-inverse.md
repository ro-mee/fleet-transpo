# Compliance Suspension With An Inverse — Driver License Renewal

User confirmed: auto-restore **gated by `suspension_reason`** (B folded into A), C as UI surface.
Root cause: `syncDriverStatus()` suspends on expired license; nothing ever restores; renewal
(`PUT /api/drivers/[id]`) never touches `driver_status`.

## Phase 1 — Migration `064_driver_suspension_reason.sql`
- `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS suspension_reason VARCHAR(50)`
- Backfill: `driver_status='Suspended' AND license_expiry < CURRENT_DATE` → `'license_expired'`
  (only writer of Suspended is the compliance sync). Legacy manual suspensions stay NULL = never auto-restored
- Constants: `DRIVER_SUSPENSION_REASON = { LICENSE_EXPIRED: 'license_expired', MANUAL: 'manual' }` in `src/lib/constants.js`

## Phase 2 — Pure module `src/lib/drivers/compliance.js` + `compliance.test.js`
- `suspensionAction({ driverStatus, suspensionReason, licenseExpiry }) → 'suspend' | 'restore' | 'none'`
  - suspend when expired; On Leave keeps precedence
  - restore only when Suspended && reason==='license_expired' && !expired
  - none otherwise (gate that protects disciplinary suspensions)
- ~12 vitest cases (grounding.test.js style)

## Phase 3 — `syncDriverStatus()` rewrite (`status.service.js`)
- Use helper; stamp/clear `suspension_reason`; On Leave precedence preserved
- NEW: system-suspend notifies fleet_manager/admin roles (notification row + sendPush, best-effort)

## Phase 4 — Restore path in `PUT /api/drivers/[id]`
- After payload update, re-read row → helper:
  - restore ⇒ `driver_status='Available'`, clear reason, `writeAudit`, notify staff ("license renewed — reinstated")
  - explicit `driver_status` in request body ⇒ admin wins, auto-logic skipped

## Phase 5 — UI surfaces (C)
- Driver detail page: banner when Suspended + reason license_expired + license now valid,
  with Reinstate button (same endpoint, query invalidation)
- Edit form: hint under status dropdown for license-expired suspension; toast mentions reinstatement
- Ensure `GET /api/drivers/[id]` returns `suspension_reason`

## Phase 6 — Verify & record
- `scratch/qa_suspension_e2e.mjs`: expire → dispatch-touch → assert Suspended+reason+notif;
  renew via PUT → assert Available+reason cleared+notif; manual suspension untouched; [QA] cleanup;
  run vs :3000
- `npm run db:up`, `db:dump`, commit schema.sql diff; strict lint 0; full vitest
- Vault: Drivers Management.md, drivers.md table note, new
  `Problems/GAP Compliance Suspension Had No Inverse.md`, Debugging Index row
