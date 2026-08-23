---
type: learning
tags: [learning, architecture, reliability]
source:
  - src/lib/ai/
  - src/lib/integration/contracts.js
  - src/lib/ocr/
last_verified: 2026-08-11
---

# Concept: Graceful Degradation

## What it is

When a non-essential component fails, the system loses that component's *value* and keeps functioning. The alternative is that every dependency becomes a single point of failure for the whole request.

The design question is always the same: **is this feature load-bearing?** If not, its failure must be survivable, and you have to decide *what survival looks like* up front.

## How it appears in my project — CONFIRMED

Five instances, five different fallbacks:

| Component            | Failure                           | Degrades to | Consequence                                                  |
| -------------------- | --------------------------------- | ----------- | ------------------------------------------------------------ |
| LLM narration        | no API key, timeout, bad response | `null`      | scores still shown, no prose → [[AI Advisory]]               |
| Priority translation | unknown value from Booking        | `Medium`    | ingest never blocks → [[Anti-Corruption Layer]]              |
| OCR                  | 6-second timeout                  | `""`        | driver types the licence by hand → [[Driver Consent]]        |
| Booking gateway      | `BOOKING_GATEWAY` unset           | mock        | Fleet works, nothing reaches Booking → [[System Boundaries]] |
| Web dashboard queries | report API error                 | zeros / "empty" copy | **was** the dishonest one — fixed 2026-08-23 with `QueryErrorBanner`/`QueryBoundary` retry panels across reports, analytics, executive, documents, predictive, history, driver performance (see [[Reports]]) |

The dashboard row used to be the counter-example: TanStack failures fell through to `data || {}` defaults and rendered confident zeros or "No records in this period" — the exact "broken looks like normal" failure in the table below.

## Example from my codebase

The AI adapter is written so it **cannot** throw — a failure returns `null` and callers treat narration as optional. `src/lib/ai/dispatch-advisor.js:11-14`:

> *"DETERMINISTIC AND ADVISORY. The same inputs always produce the same output, every number traces to a rule in this file, and nothing here writes an assignment — a human confirms via the assign endpoint. LLM narration, when enabled, is a nullable presentation layer on top and never the decision."*

**"Nullable presentation layer"** is the whole pattern. The advisory works today with no LLM key at all, which is the current state — and nothing in the UI is broken by it. → [[Deterministic Core With Nullable Narration]]

## Choosing the fallback direction

Note the fallbacks lean **conservative**, not convenient:

- Unknown priority → `Medium`, not `High`. Drift can't jump the queue.
- OCR failure → `""`, not a half-parsed licence number. A blank field is obviously incomplete; a wrong one looks fine.

That's [[Fail Closed By Default]] applied to degradation: when unsure, produce the *less* consequential output.

## The cost — silence

Every one of these fallbacks is **invisible in the UI**. A dispatcher can't tell "the LLM is down" from "narration is off", or "priority was translated" from "priority was guessed". Nothing surfaces that a degraded path was taken.

That's the trade this codebase has made, and it's the right one for an MVP — but it's why `BOOKING_GATEWAY` being unset can go unnoticed while everything *looks* fine. → [[Current State]]

**INFERRED improvement:** record which fallbacks fired. [[integration_log]] already does this for ingest; the LLM and OCR paths don't.

## Common mistakes

| Mistake | Consequence |
|---|---|
| Letting an optional dependency throw | Optional feature becomes mandatory |
| Degrading to the *permissive* value | Failure becomes privilege escalation |
| No timeout | "Degrades gracefully" after 90 seconds is an outage |
| Silent fallback with no record | Broken config looks like normal operation |
| Degrading something load-bearing | Wrong answers instead of an honest error |

## Related concepts

[[Deterministic Core With Nullable Narration]] · [[Anti-Corruption Layer]] · [[Fail Closed By Default]] · [[AI Advisory]] · [[Learning Dashboard]]
