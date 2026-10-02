---
type: plan
title: Defense Demo Data Implementation Plan
status: proposed
tags: [plan, demo-data, defense, reports]
created: 2026-10-02
related: ["[[Monday Demo Data Analysis]]", "[[Reports]]", "[[Dispatch]]", "[[Trips]]", "[[Driver Management]]", "[[Fleet And Vehicles]]"]
---

# Defense demo data implementation plan

The authoritative defense date is **Saturday, 2026-10-03**. Historical operations cover **2026-09-03 through 2026-10-02** in Asia/Manila; October 3 is primarily reserved for the real driver and dispatcher walkthrough. The earlier [[Monday Demo Data and Reporting Plan]] describes a different October 5 walkthrough and is superseded for this defense.

The detailed, task-by-task plan is in `docs/plans/2026-10-02-defense-demo-dataset.md`. It proposes a separate reversible seeder with `status`, `plan`, `up`, and `down`; about 10 synthetic drivers, 10 vehicles, 45 requests, and 30 completed historical trips; controlled Philippine-context media; independent report reconciliation; and a D1 mobile plus D4 leave/reassignment rehearsal. It preserves existing users, roles, reference geography, policies, migrations, and unrelated data.

Current code checks for the plan found that `requested_seating_capacity` is still absent, `fleet_status` has no Rejected value, Saturday is unrestricted in the built-in UVVRP preset, the mobile expense API has no corresponding expense screen, and the web Add Card action is a placeholder. `scripts/seed-demo.mjs` provides reusable reversible-ledger ideas but includes obsolete staff/shuttle seed categories and a different date window. `npm run db:status` failed without diagnostic text in the planning environment, so live schema and counts must be rechecked before implementation. No database, storage, account, or application behavior changed in this planning task.
