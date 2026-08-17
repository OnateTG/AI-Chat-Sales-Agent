# Evaluation Protocol — directory map

Mirrors Evaluation_Protocol.md 1:1. Only `state/sanity.test.ts` has real
content right now — it's directly transcribable from State Model
Specification's own worked examples, so there was no ambiguity to resolve.
Everything else needs deliberate case construction (§1.1's Call A/B tests
need real conversational examples; §2's 10 stress conversations need
expected outcomes written down BEFORE running, per the protocol's own
governing rule) — that's substantive work for the next pass, not something
to fill in as a formality.

| Folder | Protocol section | Status |
|---|---|---|
| `state/` | §1.2 State boundary | `sanity.test.ts` implemented, passing |
| `callA/` | §1.1 Language boundary (extraction) | Not started |
| `callB/` | §1.1 Language boundary (generation) | Not started |
| `decision/` | §1.3 Decision boundary | Not started |
| `conversations/` | §2 Engine-level stress tests | Scenario list only, no expected outcomes yet |
| `domain/` | §3 Domain-level tests | Not started |

Run what exists: `npm run test:state`
