---
type: learning
tags: [learning, ai, architecture, design]
source:
  - src/lib/ai/dispatch-advisor.js
  - src/lib/ai/
last_verified: 2026-08-11
---

# Concept: Deterministic Core With Nullable Narration

## What it is

A pattern for putting an LLM in a product without making the product nondeterministic:

1. **All decisions** come from explicit rules you can read, test, and reproduce
2. **The LLM only explains** the decision the rules already made
3. **The explanation is nullable** — no key, a timeout, a malformed reply, and the feature is just quieter

The model never chooses. It narrates.

## Why it matters

Two problems disappear at once:

- **Auditability.** "Why was driver 7 recommended?" has a real answer — a rule and a number. Not "the model said so."
- **Reliability.** The LLM is a third-party network call with variable latency and no uptime guarantee. Keeping it off the decision path means it can be down and the feature still works.

And a third: you can **test** it. Same inputs, same scores, every time.

## How it appears in my project — CONFIRMED

`src/lib/ai/dispatch-advisor.js:11-14` states the contract:

> *"DETERMINISTIC AND ADVISORY. The same inputs always produce the same output, every number traces to a rule in this file, and nothing here writes an assignment — a human confirms via the assign endpoint. LLM narration, when enabled, is a nullable presentation layer on top and never the decision."*

Three separate guarantees in one sentence, worth separating:

| Guarantee | Enforced by |
|---|---|
| Reproducible | pure scoring, no randomness, no I/O → [[Pure Core Imperative Shell]] |
| Traceable | each score component maps to a named rule in the file |
| Non-authoritative | the module has **no write path**; a human calls the assign endpoint |

That last one is architectural, not a policy note. There's no code path from the advisor to a database write, so the guarantee doesn't depend on anyone remembering it. → [[ADR-003 Deterministic AI]]

## Currently running with narration off — CONFIRMED

`.env` has **no LLM key**. Narration is `null` for every request today, and the advisory still produces scored, ranked candidates. The nullable path isn't a theoretical fallback — it's the one in production. → [[Environment Setup]] · [[Graceful Degradation]]

## The one soft edge

The prompt asks the model to *"separate distinct points with periods so the UI can parse them cleanly into bullet points."*

That's a **structural contract expressed in prose**, and it's the weakest link in the design: an abbreviation or a decimal in the output breaks the bullets. Everything else here is enforced by code; this one relies on the model complying. JSON output with a schema would close it. → [[Open Questions]]

## Common mistakes

| Mistake | Consequence |
|---|---|
| Letting the model pick, then explaining after | Explanation is a rationalisation, not a reason |
| LLM failure throws | Optional feature becomes required |
| Model output parsed by string splitting | Fragile; use structured output |
| Feeding model output back as input | Nondeterminism compounds |
| "The AI decided" in the audit log | Unauditable, and unusable in a defence |

## Related concepts

[[AI Architecture]] · [[AI Advisory]] · [[Graceful Degradation]] · [[Pure Core Imperative Shell]] · [[ADR-003 Deterministic AI]] · [[Learning Dashboard]]
