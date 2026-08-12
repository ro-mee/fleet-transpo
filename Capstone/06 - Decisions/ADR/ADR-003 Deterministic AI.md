---
type: decision
status: accepted
date: 2026-08-11
tags: [decision, adr, ai]
source:
  - src/lib/ai/dispatch-advisor.js
  - resources/ai/instructions.md
last_verified: 2026-08-11
---

# ADR-003: Deterministic AI

## Context

The system recommends vehicle+driver pairs for transportation requests. The obvious modern approach is to hand the problem to an LLM. Assignments have real consequences — a wrong one strands a guest or double-books a van.

## Options considered — INFERRED

1. **LLM decides and writes the assignment** — flexible, but non-deterministic, unauditable, and capable of hallucinating a vehicle that doesn't exist
2. **Deterministic rules only** — auditable, but the output is bare numbers with no explanation
3. **Deterministic rules + optional LLM narration** — the chosen option

## Decision — CONFIRMED

Option 3. Stated verbatim at `src/lib/ai/dispatch-advisor.js:11-14`:

> *"DETERMINISTIC AND ADVISORY. The same inputs always produce the same output, every number traces to a rule in this file, and nothing here writes an assignment — a human confirms via the assign endpoint. LLM narration, when enabled, is a nullable presentation layer on top and never the decision."*

Three guarantees:

| Guarantee | Mechanism |
|---|---|
| **Determinism** | Same inputs → same output. Pure functions, injected `now`. |
| **Traceability** | Every score traces to a named rule in `rule-engine.js` |
| **No write authority** | Nothing in `src/lib/ai/` writes an assignment |

The LLM layer is **nullable** and **never throws** — no key, network failure, or malformed response degrades narration to `null`, and the UI shows raw scores. That is the live path today: `.env` has no LLM key.

## Consequences

**Good:**
- "How do you know the AI isn't wrong?" has a complete answer: it can't be wrong in a way that matters, because it never acts.
- Recommendations are reproducible — a reviewer can re-run and get the same ranking.
- No evaluation harness, guardrails, or rollback story needed for the LLM.
- The system works fully with no LLM configured.

**Costs:**
- Rules must be written by hand; the system can't discover patterns from data.
- Rule quality caps recommendation quality.
- A human is required at the assignment step — no automation of the routine case.

## Revisit if

- Volume makes human confirmation the bottleneck (currently 2 dispatches — not close)
- Enough historical data accumulates that learned scoring would beat hand-written rules
- Someone proposes letting the LLM write. **The answer should stay no** unless the audit story is solved first.

## Related

[[AI Architecture]] · [[AI Advisory]] · [[Deterministic Core With Nullable Narration]] · [[Decision Log]] · [[Dispatch]]
