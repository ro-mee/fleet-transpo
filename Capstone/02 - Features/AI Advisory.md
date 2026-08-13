---
type: feature
status: working
tags: [feature, ai, advisory]
source:
  - src/lib/ai/dispatch-advisor.js
  - src/lib/ai/rule-engine.js
  - src/lib/ai/pair-scoring.js
  - src/lib/ai/predictive-maintenance.js
  - resources/ai/instructions.md
last_verified: 2026-08-11
related: ["[[Dispatch]]", "[[AI Architecture]]"]
---

# Feature: AI Advisory

## What it does

Ranks vehicle + driver pairs for a request and explains why, so the dispatcher chooses from an informed shortlist instead of a raw list of 20 vehicles and 23 drivers.

## Why it exists

Assignment has many competing constraints — availability, category match, number coding, document expiry, driver hours, vehicle condition. A human can hold three of those in mind. The rule engine holds all of them, every time, identically.

## The critical design property — CONFIRMED

**It advises. It never acts.** `src/lib/ai/dispatch-advisor.js:11-14`:

> *"DETERMINISTIC AND ADVISORY. The same inputs always produce the same output, every number traces to a rule in this file, and nothing here writes an assignment — a human confirms via the assign endpoint. LLM narration, when enabled, is a nullable presentation layer on top and never the decision."*

→ [[ADR-003 Deterministic AI]] · [[AI Architecture]]

## How it works

| Module | Job |
|---|---|
| `rule-engine.js` | Deterministic scoring against the constraint set |
| `pair-scoring.js` | Scores vehicle+driver **as a pair**, not separately |
| `predictive-maintenance.js` | Flags vehicles approaching service thresholds |
| `prompt-loader.js` | Loads `resources/ai/instructions.md` (editable content, not code) |
| narration adapter | Optional LLM prose. **Never throws.** |

Scoring pairs rather than ranking vehicles and drivers independently is the non-obvious choice: the best vehicle and the best driver aren't necessarily the best pairing (a driver may not be certified for that vehicle class).

## LLM narration is optional and currently off — CONFIRMED

`.env` has **no LLM key**, so narration is always `null` and the UI shows deterministic scores. The feature degrades to "less prose," not "broken." → [[Deterministic Core With Nullable Narration]]

The prompt in `resources/ai/instructions.md` constrains the model hard:

> *"Never invent fake vehicle records, invalid plate numbers, or hallucinate data. If data is missing, state that it is missing."*

## Database tables used

`ailogs` (731 rows on 2026-08-11 — the largest table, and growing) · `recommendation_snapshots` **0** · `ai_insights` **0** · `ai_recommendations` **0**

The zero rows are notable: the **logging** path is heavily exercised, the **persistence** paths are not. INFERRED: snapshots/insights were designed and wired but never populated.

## Edge cases

- **No LLM key** → narration null, scores still shown. Live path today.
- **LLM returns malformed output** → adapter swallows it, narration null.
- **`ailogs` doesn't exist** → created at runtime. → [[DEBT Runtime DDL On Hot Path]]
- **Narration containing an abbreviation** → the UI splits on periods per the prompt's formatting rule, so "approx. 3 km" would split mid-sentence. INFERRED fragility. **TODO:** verify the UI parser.

## What I learned

The defensible way to put an LLM in a workflow with real consequences: make the decision deterministic and traceable, make the LLM's contribution purely presentational, and make it nullable. Then "the AI hallucinated" is a cosmetic bug rather than an incident.

## Related

[[AI Architecture]] · [[ADR-003 Deterministic AI]] · [[Dispatch]] · [[Maintenance]] · [[Feature Index]]
