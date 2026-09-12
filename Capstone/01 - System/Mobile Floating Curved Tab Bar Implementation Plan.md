---
title: Mobile Floating Curved Tab Bar Implementation
date: 2026-09-12
status: implemented
tags: [mobile, navigation, ui-ux, claymorphism, 1-to-1]
---

# Mobile Floating Curved Pill Bottom Navigation Bar — 1:1 Implementation

## Overview
Recreated the mobile driver app bottom navigation bar 1-to-1 matching the reference design with authentic FleetOps claymorphic depth:
- Floating pill bar detached from screen edges with dynamic device-adaptive clearance across any phone model.
- Mathematical cubic Hermite spline S-curve wave contour with lowered 10dp peak that gently cradles the center button without vertical walls, stepped layers, or covering neighboring tab items.
- Lowered, flush circular green scan button nestled gently in the cradle, free of dark crescent shadow rings or harsh borders.
- Tactile icon hierarchy and centered active indicator dot under the active tab label.

## Visual & Structural Architecture

### 1. Floating Pill Container
- File: `mobile/components/CurvedPillTabBar.js`
- Capsule ends: `borderRadius: 36`
- Height: `64dp`
- Dynamic device-adaptive bottom clearance:
  ```js
  function getDynamicBottomOffset(insetsBottom) {
    if (!insetsBottom || insetsBottom <= 0) return 10;
    if (insetsBottom >= 40) return insetsBottom + 4; // 3-button nav safe clearance
    return Math.max(Math.round(insetsBottom * 0.55), 10); // Gesture nav low clearance
  }
  ```
- Stage colors:
  - Light mode: Clean warm white `#FFFFFF` with clay edge lighting (`borderTopWidth: 2`, `borderTopColor: '#FFFFFF'`, `borderBottomWidth: 2.5`, `borderBottomColor: 'rgba(0,0,0,0.06)'`)
  - Dark mode: Dark forest obsidian `#17221D` (`borderTopWidth: 2`, `borderTopColor: 'rgba(255,255,255,0.12)'`, `borderBottomWidth: 2.5`, `borderBottomColor: 'rgba(0,0,0,0.50)'`)
- Multi-layer drop shadow:
  `shadowOffset: { width: 0, height: 8 }`, `shadowOpacity: 0.09`, `shadowRadius: 18`, `elevation: 8`

### 2. Mathematical S-Curve Clay Wave & Tab Clearance
- Rendered via high-precision 4x supersampled anti-aliased assets:
  - `mobile/assets/images/clay_wave_light.png`
  - `mobile/assets/images/clay_wave_dark.png`
- Dimensions: Compact 92dp width × 28dp height (276px × 84px @ 3x Retina)
- Formulation: C2-continuous smootherstep spline $y(x) = 10 \cdot (1 - s(t))$
- Baseline: Aligns tangent with the horizontal pill top line (dy/dx = 0 at left and right edges), rises smoothly to a subtle 10dp peak (dy/dx = 0 at the crest), and overlaps seamlessly into the pill bar body.
- Clearance: The compact 92dp width plus elevated `zIndex: 120` on `tabCluster` guarantees that the Live Map and Trips icons are completely clear and never covered.

### 3. Lowered Flush Circular Action Button (Scan)
- Position: Lowered to `top: CONTAINER_PAD_TOP - 12` (nestled gently only 12dp above pill top)
- Shape: 54dp circle (`width: 54, height: 54, borderRadius: 27`)
- Texture: Deep forest green gradient (`['#204E3C', '#143828']` light / `['#2E634F', '#193E2F']` dark)
- Zero bottom shadow ring:
  - `elevation: 0`, `shadowOpacity: 0`, and `borderWidth: 0` so the button sits completely clean and flush against the white wave cradle without any dark crescent shadow ring.
- Icon: Viewfinder / scanner reticle (`Ionicons` `scan-outline`, 25dp, white `#FFFFFF`)
- Behavior: Navigates directly to fuel report with camera scanner active (`router.push({ pathname: "/fuel-report", params: { scan: "1" } })`)
- Tactile response: Scale down to `0.93` on press

### 4. Tab Items & Active Dot
- 4 primary tabs: Home, Live Map, Trips, Profile
- Active tab state:
  - Icon: Solid icon in deep forest green `#1B4332` (or `#4ADE80` in dark mode)
  - Label: Semibold typography in deep forest green
  - Active indicator dot: 4.5dp circle placed 3dp directly under the label (`opacity: isFocused ? 1 : 0` to prevent layout reflows)
- Inactive tab state:
  - Icon: Outline icon in muted slate `#55606F` (or `#8E9E96` in dark mode)
  - Label: Medium typography in muted slate
  - Dot hidden

### 5. Layout & Android Touch Clearance
- Integrated via `<Tabs tabBar={(props) => <CurvedPillTabBar {...props} />}>` in `mobile/app/(app)/(tabs)/_layout.js`
- Maintained hidden tabs (`history`, `notifications`, `vehicle`) via `href: null`
- Preserved `<DriverSos />` emergency distress floating button overlay
- `CONTAINER_PAD_TOP = 16`: Encompasses the lowered button within the layout bounds so Android touch events on the upper rim of the button are 100% captured.
- Updated scroll padding in `trips.js` and `profile.js` to `paddingBottom: insets.bottom + 96` so cards and action buttons remain 100% visible above the floating pill.

## Verification
- ESLint: Clean (0 errors, 0 warnings across all touched files).
- Vitest: All 101 test suites (1,112 tests) passing.
- Hot Reload: Instant live preview in running Expo dev client.
