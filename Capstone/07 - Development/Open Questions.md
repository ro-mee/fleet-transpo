---
type: status
title: Open Questions
tags: [development, questions, unknown]
source:
  - (see linked notes)
last_verified: 2026-08-11
---

# Open Questions

Things that are genuinely **UNKNOWN** — not inferred, not guessed. Answering these is a good use of an hour.

## Design questions only you can answer

1. **Why are notifications database triggers?**
   Real trade-offs either way, no recorded reasoning. → [[ADR-005 Notifications In Database Triggers]]

3. **Why is RLS enabled at all if it's inert?**
   Defence in depth, a Supabase-Auth remnant, or documentation-as-SQL? → [[Why RLS Is Not A Boundary]]

> **Three questions left this list on 2026-08-11 because they were answered or made moot.**
> — *"Should a Minor incident ground a vehicle?"* The rule was documented in three places (`grounding.js:3-6`, `incidents/route.js:114-115`, and a `SYSTEM.md` passage since rewritten). I recorded it as unknown without checking. Now fixed.
> — *"Is `'Pending Reassignment'` a real product state?"* One grep across `src/` answered it: six files, including the first lane of the dispatch board. What rank it should hold was then settled by an explicit `INTERRUPT` set — the monotonic rank couldn't express a cycle. → [[BUG Pending Reassignment Not In State Machine]]
> — *"Why do `transportation_requests` and `vehiclereservations` both exist?"* **Still unanswered as a historical question — the repository does not document why the old table was kept.** It stopped being an open question because the table was dropped in migration 036 rather than explained. → [[DEBT vehiclereservations vs transportation_requests]]
>
> **The lesson:** before filing something as UNKNOWN, grep the whole tree and read the module docstring. An unknown that was answerable is worse than no note — it licenses guessing. → [[Mistakes I Made]]

## Factual questions answerable by reading or querying

5. **What is `workflow/Fleet Management System-2026-07-27-071922.pdf`?**
   Never opened. Could be a requirements document, a defence deck, or a diagram export. If it contains the original requirements, it's the missing "why" for several decisions.

6. ~~**What is `substitute_vehicle_schedules` for?**~~
   **ANSWERED 2026-08-19:** substitute-driver coverage — which driver temporarily covers a vehicle while its custodian is unavailable (migration 040 added the API; the recommendation engine reads it). Managed via `/fleet/assignments` since 2026-08-23. → [[Assignments]]

7. **Does the GPS endpoint append or overwrite?**
   If it overwrites, there is no track history and route replay is impossible. → [[Tracking]]

8. **Does every API route actually call a guard?**
   113 routes, per-route discipline. `scripts/verify-rbac.mjs` checks that the **role lists** agree with the UI matrix (78 checks) — it does not assert a guard is present at all. → [[Authentication]]

9. **Does anything read `notification_preferences`?**
   0 rows. If nothing reads it, it's dead schema. → [[Notifications]]

10. **How does the UI parse AI narration?**
    The prompt says *"Separate distinct points with periods so the UI can parse them cleanly into bullet points."* If it splits on `.`, an abbreviation breaks it. → [[AI Advisory]]

11. **Is there a cleanup job for expired `mobile_refresh_tokens`?**
    57 rows now; it only grows. → [[ADR-009 Separate Mobile Auth]]

12. **Do nav links point at the missing pages?**
    Resolved 2026-08-23: the two availability boards were merged into `/dispatch/availability` and nav entries updated (`workspaces.js`). The planned 2026-08-15 removal had never actually landed — pages stayed live until the merge. → [[Frontend]]

13. **Which of the 13 trip statuses have ever occurred?**
    `SELECT status, count(*) FROM trips GROUP BY status` — with 2 rows, the answer is at most 2. → [[Trips]]

14. **`mobile/AGENTS.md` points at Expo SDK v57 docs, but the installed SDK is 54.**
    `mobile/package.json` pins `expo ~54.0.8` (installed 54.0.36). The push work was verified against the SDK 54 docs (`expo-notifications@0.32.17`). Which is the intended target — upgrade the app to SDK 57, or fix the AGENTS.md link to v54? → [[Notifications]]

## How to use this note

When you answer one, **delete it from here** and write the answer into the note it links to, bumping `last_verified`. A shrinking list is the point.

## Related

[[Current State]] · [[Decision Log]] · [[Roadmap]] · [[Debugging Index]] · [[Home]]
