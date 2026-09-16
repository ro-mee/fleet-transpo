---
type: feature
status: working
tags: [feature, mobile, driver, guide, onboarding, academy]
source:
  - mobile/lib/driver-guide.js
  - mobile/components/guide/DriverGuideModal.jsx
  - mobile/components/guide/DriverGuideCard.jsx
  - mobile/app/(app)/guide.js
  - mobile/app/(app)/_layout.js
  - mobile/app/(app)/(tabs)/_layout.js
  - mobile/app/login.js
  - mobile/app/permissions.js
  - mobile/app/(app)/(tabs)/index.js
last_verified: 2026-09-16
---

# Feature: Driver Academy & In-App Guide

## What it does

The **Driver Academy** is a dedicated in-app interactive training sandbox built directly into the FleetOps mobile app. It replaces static, passive text documentation with hands-on, zero-risk simulations of actual mission-critical UI interactions:
- Conducting 7-point pre-trip vehicle roadworthiness inspections.
- Executing the 48% slide-to-confirm gesture to prevent accidental status transitions while driving.
- Calculating and recording ending odometers and providing valid geofence detour reasons.
- Framing fuel receipts in the camera viewfinder with simulated Gemini AI OCR extraction.
- Deploying the floating SOS emergency command medallion and dispatch hotlines.
- Navigating cellular dead zones (tunnels/basements) with local outbox queuing and automatic background sync.

---

## Mandatory Onboarding Gate (Absolute Enforcement)

Training is an **absolute prerequisite** for vehicle operations. All drivers—both newly created driver accounts and existing drivers who have not completed all 6 academy missions—are strictly locked out of dispatch operations until certified.

```mermaid
flowchart TD
    A[Driver Logs In] --> B{Consented to Policy?}
    B -->|No| C[/consent - Data Privacy Policy/]
    C --> D[/permissions - Device Permissions/]
    D --> E{Academy Complete?}
    B -->|Yes| E
    E -->|No - 0-5 Missions| F[/guide - Driver Academy Hub/]
    F --> G[Complete All 6 Missions]
    G --> H[Certified Road-Ready]
    H --> I[/(tabs) - Home Dashboard & Dispatches]
    E -->|Yes - Certified| I
```

### Perimeter Guarding Rules

1. **Root Perimeter Guard (`mobile/app/(app)/_layout.js`)**:
   - On every screen focus, the layout evaluates `calculateProgress(res.completedMissions).isComplete` for the active `driverId`.
   - Any driver whose training is incomplete (`!guideComplete`) attempting to navigate to any route other than `/guide` is immediately trapped and redirected back to `/guide`.
   - **Privacy & Sensor Protection**: The background GPS tracking poster (`useActiveTripGpsPoster`) is held dormant until the driver is certified, ensuring uncertified sessions never stream live location data.

2. **Secondary Defense-in-Depth (`mobile/app/(app)/(tabs)/_layout.js`)**:
   - If an uncertified driver ever attempts to load the tab bar or tab views (`Home`, `Map`, `Trips`, `Profile`), the tabs layout intercepts the session and redirects to `/guide`.

3. **Direct Login & Permissions Handshake (`mobile/app/login.js`, `mobile/app/permissions.js`)**:
   - Immediately following credential verification or device permission granting, the app evaluates guide progress and routes uncertified drivers directly to `/guide`.

4. **Locked Exit on Academy Screen (`mobile/app/(app)/guide.js`)**:
   - The navigation back button is guarded while uncertified: drivers cannot back out into the dashboard. Tapping back triggers a confirmation alert giving them the option to either **Continue Training** or **Sign Out**.

---

## Per-Driver Progress Isolation

To prevent shared mobile devices from leaking training completion stamps across different accounts, progress is isolated per driver ID:

```javascript
// mobile/lib/driver-guide.js
export const GUIDE_STORAGE_KEY = '@fleetops_driver_guide_progress';

export function getGuideStorageKey(driverId) {
  return driverId ? `${GUIDE_STORAGE_KEY}_${driverId}` : GUIDE_STORAGE_KEY;
}
```

* **New Account Guarantee**: When a newly registered driver logs into a shared device, their scoped key is empty (`completedMissions: []`), immediately triggering the mandatory training gate.
* **Independent Reset**: Calling `resetGuideProgress(driverId)` wipes only that specific driver's stamps without affecting other drivers who use the same physical device.

---

## The 6 Training Missions

| # | Mission ID | Title | Key Interactive Simulator |
|---|---|---|---|
| **1** | `inspection` | Pre-Trip Vehicle Inspection | 4-point interactive roadworthiness checklist with PASS/FAIL toggles and critical fault escalation. |
| **2** | `swipe` | Mastering the Swipe Gesture | Live `SwipeButton` testing slide-to-confirm physics (48% threshold) across Route Start, Pickup, and Completion. |
| **3** | `trip_flow` | Trip Lifecycle & Odometer | Quick-increment distance buttons (`+18 km`, `+35 km`, `+72 km`) with live delta calculation, plus 3 real-world geofence detour override tiles. |
| **4** | `fuel` | Fuel Receipt & Scanner | Simulated camera viewfinder with corner targeting brackets, receipt paper mock, hardware-accelerated looping green laser sweep (`Animated.loop`), HUD scanning badge, and OCR chip extraction. |
| **5** | `sos` | Emergency SOS & Breakdowns | Draggable floating SOS medallion with radar pulse animation and simulated dispatch hotline modal. |
| **6** | `offline` | Offline Mode & Tunnel Driving | Multi-phase underground tunnel simulator: manual signal drop (`offline`), milestone outbox queuing, and automatic background sync drain upon reconnect. |

---

## Mission 4: AI Receipt Scanner Details

The fuel receipt scanner uses React Native's `Animated` engine with `useNativeDriver: true`:
1. **Looping Sweep**: An `Animated.loop` translating between `top: 10` and `top: 116` with quad easing.
2. **Dual-Layer Laser**:
   - Razor-sharp neon line (`#00E676`) with glowing shadow elevation.
   - Trailing scan aura (`rgba(0, 230, 118, 0.18)`) simulating camera optical refraction.
3. **Viewfinder Feedback**: Corner framing brackets dynamically turn emerald during scanning, and an `ANALYZING RECEIPT · GEMINI OCR` status badge displays at the top.
4. **Auto-Extracted Chips**: Extracts and presents Station (`Shell Skyway North`), Volume (`42.50 L`), Total (`₱2,911.25`), and Type (`Diesel`).

---

## Mission Auto-Chaining & Completion Flow

1. When a mission is completed in [`DriverGuideModal.jsx`](file:///c:/Users/Joseph%20T%20Lopez/OneDrive/Documents/fleet-transpo/mobile/components/guide/DriverGuideModal.jsx), the modal marks the mission complete in storage via `markMissionComplete(missionId, driverId)`.
2. [`mobile/app/(app)/guide.js`](file:///c:/Users/Joseph%20T%20Lopez/OneDrive/Documents/fleet-transpo/mobile/app/(app)/guide.js) re-evaluates `calculateProgress()`.
3. If training is still in progress, the guide automatically stages and opens the next uncompleted mission modal, creating a smooth guided onboarding journey.
4. Once all 6 missions are finished (`percent === 100`, `isComplete === true`):
   - The hero readiness card displays the **"Certified Road-Ready"** badge.
   - A full-width primary button unlocks: **"Proceed to FleetOps Dashboard 🚀"**.
   - Tapping the button routes to `router.replace("/(tabs)")`, releasing the driver into active dispatch.

---

## Re-Entry Points for Certified Drivers

Once certified, drivers can revisit the Driver Academy at any time to review protocols or retake practice missions:
1. **Profile Screen**: `Profile` → `Driver Academy & Guide` row with `school-outline` icon.
2. **Help Center**: `Profile` → `Help & Support` (`mobile/app/(app)/profile/help.js`) → dedicated **INTERACTIVE TRAINING** hero card.
3. When accessed by certified drivers, the header back button allows standard back-navigation (`router.back()`) to return to settings.

---

## Verification & Automated Tests

* **Unit Tests**: [`mobile/lib/driver-guide.test.js`](file:///c:/Users/Joseph%20T%20Lopez/OneDrive/Documents/fleet-transpo/mobile/lib/driver-guide.test.js) (**7/7 passed**):
  - Mission definitions and complete step metadata.
  - Progress calculations across 0%, partial, and 100% states.
  - Graceful handling of invalid mission IDs or corrupted JSON storage.
  - Strict per-driver isolation verifying that Driver A's completion never leaks to Driver B.
* **Mobile Test Suite**: **25 test files passed (150/150 tests)**.
* **Full Project Suite**: **142 test files passed (1,341/1,341 tests)**.
* **Route Authorization**: `npm run verify:auth` (**270/270 routes verified**).
