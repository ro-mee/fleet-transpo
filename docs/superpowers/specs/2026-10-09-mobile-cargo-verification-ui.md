---
title: Driver Cargo Verification UI
date: 2026-10-12
status: Approved interaction direction
platform: Expo / React Native driver app
---

# Driver cargo verification UI

This spec records the mobile cargo direction the user approved on 2026-10-12. The approved visual review covered five portrait screens: manifest, normal pickup, shortage, awaiting decision and delivery. The screens are illustrative; they do not represent live cargo data or an enabled workflow.

## Core interaction

Restaurant and hotel cargo use one shared driver workflow and the same screens. The trip's source, service, item list, locations, quantities and recipient change the data and labels. Passenger Guest and VIP Guest trips keep their existing passenger flow.

From Trip Details, a cargo trip opens a manifest overview. At pickup, each item shows its expected amount and a separate blank actual-count field. The driver records what is physically present, confirms a clean pickup or reports an issue, and keeps entered values if a request fails. Reporting an issue is separate from confirming a clean pickup.

A shortage such as 10 expected boxes and 9 counted is saved as an observation and shown as awaiting an authorized source decision. The driver cannot approve it. A source acknowledgement does not approve the shortage, and a source decision does not replace Fleet clearance or the existing vehicle safety check. After loading, the driver completes a separate post-load securement check. The app enables departure only when a fresh server view confirms any required source decision, Fleet clearance and current securement proof. Offline drafts never appear ready to depart.

At delivery, show expected, picked-up and delivered amounts separately. Receiver confirmation is allowed only when the server provides verified receiver authority. A typed name, photo or partner message does not create that authority.

## Screen responsibilities

- **Cargo overview:** show the trip source/service label, pickup and delivery locations, item count, manifest revision, progress, current execution state and clear blockers. Do not fabricate an empty manifest or show passenger count/call-guest actions.
- **Pickup:** show one compact item row at a time with item name, expected quantity/unit, optional reference image and a blank actual-count input. Validate numeric values and units inline. Keep Confirm Pickup and Report an Issue as distinct actions.
- **Issue and decision:** collect the observed difference, a reason/remark and optional observation evidence. Preserve the draft after an error or while offline. Show waiting, accepted, rejected, recount and stale-manifest states only from current server facts. Do not expose a driver approval action.
- **Delivery:** keep expected, picked-up and delivered quantities visible as separate values. Show the receiver and confirmation method only when provided by the server. Disable final confirmation when receiver authority or required evidence is missing.
- **Status and summary:** distinguish device-saved, Fleet-saved, partner-acknowledged, source-decision and departure-clearance states. Use text and accessible status labels in addition to color.

## Data and authority

Use the existing cargo execution API, account-scoped draft store and cargo sync service. The mobile view model accepts the server execution plus offline/sync state and returns the current stage, primary action, submission permission, summary and blockers. Stable line IDs, manifest references, submission IDs and evidence IDs remain owned by the existing services.

The driver records quantities and conditions; source owners decide order shortages; Fleet decides whether transport can proceed; the receiver confirms delivery through the approved server method. The UI must not infer authority from the signed-in driver's role, a local draft, an upload response or partner acknowledgement.

Trip Started begins travel to the pickup. Keep Start Trip behind the existing pre-trip rules. Cargo pickup/departure and delivery remain separate from trip start and safety inspection. Preserve existing passenger status transitions and navigation.

## Visual system

Use the mobile app's existing forest, warm-ivory and clay visual language, theme tokens and installed Plus Jakarta Sans / IBM Plex Mono fonts. Keep the layout single-column and scan-friendly, with a restrained raised surface for the current task, clear quantity hierarchy and compact progress. Use depth only to separate tasks and statuses; avoid large web-style hero areas, blur, decorative gradients and swipe-only actions.

Support the existing light, dark and high-contrast themes independently. Keep controls in the safe area and above the keyboard, and preserve entered values while navigating back.

## Accessibility and responsive behavior

- Minimum interactive target: 44 pt on iOS and 48 dp on Android.
- Normal text contrast: at least 4.5:1; meaningful controls: at least 3:1.
- Provide labels, roles, values, disabled/busy states and helpful validation text for screen readers.
- Keep quantity and unit readable when text size is enlarged; allow rows and actions to wrap on small phones and landscape.
- Respect reduced-motion settings and do not rely on color, icons, animation or gestures alone to explain state.

## Verification contract

Write view-model and rendered-screen tests before implementation. Cover the same layout for restaurant supply pickup, restaurant food delivery and hotel supply transfer; separate Passenger Guest/VIP behavior; initially blank actual counts; 10 expected versus 9 counted; stale manifest; retry with retained input and stable submission identity; offline draft not becoming READY; partner ACK not becoming approval; and unverified receiver authority blocking delivery confirmation.

Verify the existing static Trip Details route can coexist with nested cargo routes before adding route folders. Preserve Start Trip behavior, passenger map actions and the existing inspection gate. Test small-phone, large-phone and landscape layouts, both themes, safe areas, keyboard behavior, accessibility labels and target sizes. Expo web is supplemental; device acceptance remains a separate release check.

## Scope boundaries

This UI does not enable production cargo APIs, partner providers, supply assignment, source decisions, inventory updates, database migrations, evidence retention changes or release activation. A disabled or unavailable server response must be shown truthfully with retry guidance. It must never be presented as a successful receipt or clearance.

## Documentation references

- Expo SDK 57 reference required by mobile/AGENTS.md: https://docs.expo.dev/versions/v57.0.0/
- Installed Expo Router reference (Expo SDK 54 / Router 6): https://docs.expo.dev/versions/v54.0.0/sdk/router/
- Expo Router route notation: https://docs.expo.dev/router/basics/notation/
- React Native Pressable: https://reactnative.dev/docs/0.81/pressable
- React Native accessibility: https://reactnative.dev/docs/0.81/accessibility
