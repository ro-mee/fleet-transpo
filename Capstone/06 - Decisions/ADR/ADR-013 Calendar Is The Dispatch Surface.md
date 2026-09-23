---
type: adr
number: 013
title: Calendar Is The Dispatch Surface
date: 2026-09-23
status: accepted
tags: [decision, dispatch, ui, calendar]
---

# ADR-013: Calendar Is The Dispatch Surface

## Context

Dispatch had two parallel surfaces: a status-lane board at `/dispatch` and a calendar at `/dispatch/calendar`. The board's lanes duplicated information the calendar already showed, split navigation, and aged as dead code (orphaned `dispatch-card.jsx`, unused departure-alert hook). Dispatchers were landing on the board by default while the calendar carried the richer day/lane view.

## Decision

1. **Delete the status-lane board.** `/dispatch` becomes a `redirect("/dispatch/calendar")` stub; the board component and orphan hooks are removed.
2. **Calendar is the only dispatch home.** Sidebar, command palette, dashboard cards, availability deep-links, detail back-links, and the queue header button all target `/dispatch/calendar`.
3. **Keep `NAV_ROLES["/dispatch"]` as the prefix gate.** Exact-match alone does not cover `/dispatch/*`; removing the prefix entry would open the calendar and detail pages to any authenticated role. Explicit `"/dispatch/calendar"` entry documents the same roles.
4. **Queue ⇄ calendar are peers.** Calendar header links to the queue; queue header links to the calendar. Deep-link `?date=` anchors the calendar day.

## Consequences

- One mental model: dispatch planning happens on a timeline, not a status board.
- Dead code removed with the board; `GET /api/dispatch/by-status` stays (dashboards still read it).
- Any future "status overview" need should reuse the calendar lanes or the queue, not resurrect the board.

→ [[Dispatch]] · [[Request Lifecycle]] · [[State Machines]]
