---
type: learning
tags: [learning, security, design]
source:
  - src/lib/api/utils.js
  - src/lib/consent/driver-visibility.js
last_verified: 2026-08-11
---

# Concept: Fail Closed By Default

## What it is

When a decision is unspecified, unreachable, or errors out, the safe outcome should be the **default**, not the exception. Deny unless allowed. Hide unless listed.

The opposite — fail *open* — means a bug, a typo, or a forgotten config becomes an authorisation grant.

## Why it matters

Defaults are what you get when someone forgets. Every system accumulates forgetting: a new route, a new field, a new role. The question is only whether forgetting is safe.

## How it appears in my project — CONFIRMED

### The role default excludes drivers

`src/lib/api/utils.js`:

```js
const DEFAULT_ROLES = ["system_admin","admin","fleet_manager","dispatcher","management"];
```

Six roles exist; `driver` is **not** in the default. A route written as `requireAuth(req)` with no role list is automatically closed to drivers. Driver access requires typing `requireDriver(req)` — an explicit act.

This is the correct polarity: the largest, least-trusted, mobile-facing population is the one you cannot grant by omission. → [[RBAC]]

### Allowlists, not denylists, for driver data

`src/lib/consent/driver-visibility.js`:

```js
DRIVER_VISIBLE_SECTIONS
DRIVER_SELF_EDITABLE_FIELDS = ["phone","face_image_url","license_image_url","license_back_image_url"]
LICENSE_REUPLOAD_WINDOW_DAYS = 30
```

A new column added to `drivers` tomorrow is **invisible and non-editable** until someone adds it to the list. Under a denylist, that same column would be exposed the moment it existed. → [[Driver Consent]]

### Integration falls back to the *lower* priority

Unknown priority values from Booking degrade to `Medium`, not `High`. A vocabulary drift can't be used to jump the queue. → [[Anti-Corruption Layer]]

## Where the project fails open — CONFIRMED

Be honest about the counterexamples:

| Place | Direction | Why it matters |
|---|---|---|
| ~~`shouldGroundVehicle()` returns `true` always~~ | **Was closed by accident, not design** | Fixed 2026-08-11. Worth keeping as the lesson: failing closed is only a virtue when it's *chosen*. Here it read as safety while it cancelled live trips on a cosmetic scratch — an unintended fail-closed is just a bug that's hard to notice. → [[BUG shouldGroundVehicle Is A Stub]] |
| Missing `CRON_SECRET` | **Open** — no secret means no check | → [[Environment Setup]] |
| Missing `BOOKING_WEBHOOK_SECRET` | **Open** — inbound webhook unverified | → [[System Boundaries]] |
| Route-level auth is per-handler | **Open on omission** — a forgotten call is a public endpoint | → [[Authentication]] |

That last row is the structural weakness. `DEFAULT_ROLES` fails closed *once you call it*; **not calling it fails open.** The fix isn't more care, it's a test that enumerates `src/app/api/**/route.js` and asserts every one calls a guard. → [[Roadmap]]

## Common mistakes

| Mistake | Better |
|---|---|
| `if (user.role === "driver") deny()` | Allowlist the roles that may proceed |
| Denylist of hidden fields | Allowlist of visible ones |
| `catch { return true }` in a permission check | `catch { return false }` |
| Absent config disables the check | Absent config refuses to boot |
| Unknown enum → highest privilege | Unknown enum → lowest |

## Related concepts

[[Defence In Depth]] · [[Why RLS Is Not A Boundary]] · [[Anti Enumeration 404 vs 403]] · [[RBAC]] · [[Driver Consent]] · [[Learning Dashboard]]
