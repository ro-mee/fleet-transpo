---
type: plan
title: Mobile Pre-Shift and Pre-Trip Inspection UI UX Enhancement Plan
tags: [mobile, inspection, ui-ux, operate-mode, claymorphism]
created: 2026-09-30
status: completed
---

# Mobile Pre-Shift & Pre-Trip Inspection UI/UX Enhancement Plan

See full execution plan in [docs/superpowers/plans/2026-09-30-mobile-inspection-ui-ux-enhancement.md](../../docs/superpowers/plans/2026-09-30-mobile-inspection-ui-ux-enhancement.md).

## Executive Overview
Elevate the FleetOps Mobile Pre-Shift and Pre-Trip Inspection screens (`mobile/app/(app)/inspection.js`) based on **UI/UX Pro Max** and **Impeccable (Operate Mode)** audit findings:
1. **Sticky Segmented Progress Tracker:** Real-time visual progress pill bar (`[ 🟩 ][ 🟩 ][ ⬜ ][ ⬜ ][ ⬜ ]` → "2 of 5 Verified") located under the top bar with auto-scroll.
2. **Instant Scannable Category Icons:** Leading squircle icons (`volume-high`, `bulb`, `warning`, `compass`, `disc`) so drivers scan parts of the vehicle in <0.5s instead of reading 15-word questions outdoors.
3. **Semantic Amber for Lost Items:** Decouple `passenger_items` ("Items Found") from punitive red (`colors.error`) and use warm amber (`#D97706`), clarifying that reporting leftover passenger items is good service and does not cancel the trip.
4. **Cabin Ready Acknowledgment:** Refine the card so it is distinct from the primary screen CTA.
5. **Mobile Form Ergonomics & Tactile Vibration:** Wrap in `KeyboardAvoidingView` to prevent keyboard occlusion on remarks inputs, wire built-in `react-native` `Vibration` on button taps, and display pre-submission safety warnings before locking out a shift.

