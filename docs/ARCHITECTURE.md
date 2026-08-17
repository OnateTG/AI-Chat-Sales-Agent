# File Architecture

This maps the codebase to the six specification documents (as of the version
reviewed 2026-07-08: Runtime_Specification-4, Prompt_Specification-3,
Domain_Package_Specification-1, State_Model_Specification, Evaluation_Protocol,
AI_Chat_Agent_SOP). Every file below states which spec section governs it, so
a future change to a spec has a direct address in code — this mirrors the
"contracts between documents" property Arch1 identified as the core value of
the six-document design.

Language: **TypeScript** throughout `src/`. This is a deliberate call, not a
default — the entire point of the spec review process was nailing down exact
contracts (action enums, lifecycle enums, evidence types, output schemas).
A type system turns "acknowledge is not a valid action" from a runtime
surprise into a compile error. Given how much of this project's value is in
its contracts, paying for a type system is the correct trade.

---

## Top-level shape

```
whatsapp-sales-agent/
├── src/
│   ├── engine/       ← THE KERNEL. Everything in the 6-doc spec lives here.
│   ├── domain/        ← Domain Package loading (config, not conversation logic)
│   ├── llm/            ← Call A / Call B / model routing (Prompt Specification)
│   ├── store/          ← Per-lead conversation persistence (Platform, not kernel)
│   └── whatsapp/       ← Platform Integration layer (Runtime §7's "platform concern")
│
├── domains/            ← Domain Package content (data, not code)
│   └── website-development.yaml
│
├── config/
│   └── tone.md         ← tone_config input to Call B (Prompt Spec §3.2)
│
├── docs/
│   ├── ARCHITECTURE.md ← this file
│   └── ADL.md          ← Architecture Decision Log (per Arch2's handoff requirement)
│
├── eval/               ← Evaluation Protocol, mirrored 1:1 by section
│   ├── callA/           §1.1 Language boundary — Call A
│   ├── callB/           §1.1 Language boundary — Call B
│   ├── state/            §1.2 State boundary
│   ├── decision/          §1.3 Decision boundary
│   ├── conversations/      §2 Engine-level stress tests (the 10 scenarios)
│   └── domain/              §3 Domain-level tests
│
├── nurture/            ← NOT BUILT. Deferred per Arch1's sequencing
│                          (kernel proven first). Stub only.
├── workflow/           ← NOT BUILT. Site build trigger / link expiry / payment.
│                          Explicitly out of scope of the six documents. Stub only.
│
└── server.ts           ← Entry point. Wires webhook → pipeline → sender.
```

---

## `src/engine/` — the kernel

This is the direct implementation of State Model Specification and Runtime
Specification. Nothing in this folder knows it's selling websites — swap the
domain package and the same code could run insurance or SEO, per Arch1's
"conversation kernel, not front half" reframing (accepted).

| File | Owning spec | Responsibility |
|---|---|---|
| `types.ts` | State Model §1–3, Runtime §7 | Every enum and shape: `Status`, `EvidenceType`, `Confidence`, `Action` (4 values, not 5), `Lifecycle` (5 values), `VariableState`, `ConversationState` |
| `stateModel.ts` | State Model §2–4 | Confidence derivation (§3.4), status transition validation (§2.2, rejects invalid transitions), completion checking (§4) — all pure functions, deterministic, no LLM |
| `objective.ts` | Runtime §Step 4–5 | The four-objective priority order (conflict → pending question → progress → recommend), the objective→action map, plus the tri-state `ObjectiveOutcome` split beyond those four (ADL-021, "Delta C"): `objective` \| `no_objective` (legitimate post-recommendation terminal state, `lifecycle !== active`) \| `error` (genuine gap, `lifecycle === active`, Problem B's territory). `Objective` itself stays exactly four values — the split is a property of the return type, not a fifth objective. See `ObjectiveOutcome`'s invariant comments in `types.ts` |
| `lifecycle.ts` | Runtime §7 | Accepts Call A's `proposed_lifecycle`. **Transition validation is explicitly unimplemented** — the transition table is `[OPEN — ARCHITECTURE REVIEW REQUIRED]` per the spec itself. See in-file comment; this is not an oversight |
| `pricing.ts` | Domain Package §5 | Evaluates `quoting_rules` against finalized state each turn, resolves `pricing_context` for Call B. Deterministic |
| `pipeline.ts` | Runtime §2 (the 6-step diagram) | Orchestrates one turn via `runTurn(context: TurnContext)` — renamed from `RunTurnParams` (ADL-021) once verified this genuinely already was a per-turn snapshot, not just a parameter bag: Call A → append evidence → detect conflicts → evaluate completion → determine objective (tri-state) → select action → resolve pricing → Call B, switching on `outcome.kind`. This is the only file that calls both `llm/` and `engine/` |

**Design note on the turn trigger:** `pipeline.ts` takes a `TurnEvent`, not a
`CustomerMessage`, even though only one event type (`inbound_message`) is
implemented right now. This was flagged during spec review (my own
"trigger-abstraction" hold item, logged in ADL) — nurture will eventually need
an agent-initiated event type, and typing the entry point as an event now
costs nothing but avoids a signature change later. This is a naming/typing
choice only; no nurture logic exists.

## `src/domain/`

| File | Owning spec | Responsibility |
|---|---|---|
| `types.ts` | Domain Package Spec §1 | TypeScript shape matching the current domain/business/business_knowledge three-section template (organized by consumer: Engine reads `domain`, Engine+Call B read `business`, Call B only reads `business_knowledge`) |
| `domainLoader.ts` | Domain Package Spec §1 | Parses a domain YAML file into the typed structure `pipeline.ts` consumes |

## `src/llm/`

| File | Owning spec | Responsibility |
|---|---|---|
| `router.ts` | (not in the six docs — your original NVIDIA/Ollama requirement) | OpenAI-compatible chat completion client with provider rotation. Exposes a `tier: "fast" \| "quality"` param so Call A can use a cheap/fast model and Call B a stronger one — the optimization Arch2 flagged as consistent with the spec but worth deferring until measured. Implemented now since it costs nothing to have the option |
| `callA.ts` | Prompt Spec §2 | Builds Call A's input, sends it, validates the output against the exact schema in §2.3 with zod, retries once on schema violation per §4's validation requirement |
| `callB.ts` | Prompt Spec §3 | Builds Call B's input (state + objective + action + lifecycle + pricing_context + tone_config + `business_knowledge_snippet` — renamed from `domain_knowledge_snippet`, see ADL sync entry), sends it, checks for state-leakage per §4's validation requirement. **Also folds in SOP §3 (Conversation Design Principles) and §4 (Conversation Control table)** — Prompt Spec §3.4 references these by name rather than restating them, so the actual system prompt assembled here pulls from both documents, not Prompt Spec alone |

## `src/store/`

| File | Owning spec | Responsibility |
|---|---|---|
| `store.ts` | Not kernel — Platform Integration | Persists `{ variables, conversation }` per lead, keyed by phone number, across a multi-day WhatsApp conversation. One JSON file per phone number under `data/` — no native dependency, no relational modeling needed at this scale (single process, lookup-by-phone only). Originally scaffolded with `better-sqlite3`; switched after hitting native-binary compile issues, and on reflection the simpler choice is the more appropriate one here, not just a workaround. This is the "lead store now needs to hold full evidence-based state" gap Arch2 flagged early in review |

## `src/whatsapp/`

| File | Owning spec | Responsibility |
|---|---|---|
| `webhook.ts` | Not kernel — Platform Integration (Runtime §7 explicitly pushes this out) | Receives Meta Cloud API webhook events, extracts the inbound message, invokes the pipeline |
| `sender.ts` | Same | Sends the pipeline's response back via the Cloud API |

## `domains/website-development.yaml` and `domains/insurance.yaml`

Website-development is Domain Package Specification §7's worked example,
adapted to your actual business. Insurance is a second domain package built
specifically to stress-test whether the kernel is genuinely reusable —
see `docs/ADL.md` entry 009 for what that found (short version: mostly yes,
with one real kernel-level gap identified, not yet fixed). Both currently
run on a documented mitigation for that gap — see ADL-009 before assuming
either domain package reflects the originally intended design for optional/
supplementary variables.

`eval/domain/insurance-friction-demo.ts` is the empirical evidence behind
ADL-009 — runnable, not just asserted: `npx tsx eval/domain/insurance-friction-demo.ts`

## `config/tone.md`

This is **not a placeholder** — it's seeded directly from AI_Chat_Agent_SOP.md
§5 (Tone Guidelines: Nigerian English speakers, ages 20–45, warm-before-
transactional, plain direct English, WhatsApp/Instagram as legitimate
existing presence). That section was already written; it just didn't have a
file to live in until now.

## `docs/ADL.md`

Seeded with every entry already generated across the review process with
Arch1/Arch2, so the paper trail doesn't start from zero. New entries append
here going forward, per Arch2's process.

## `bin/` — operator tools

| File | Responsibility |
|---|---|
| `verify-domain.ts` | CLI wrapper around `src/verify/verifyDomainPackage.ts` |
| `kill-switch.ts` | Pause/resume/status for a single conversation's automation |
| `backup.ts` | Copies `data/conversations/` to a timestamped local folder |

## `src/whatsapp/handleInboundMessage.ts`

The actual per-message logic, extracted from `server.ts` so it's directly
testable — `server.ts` is now a thin wrapper (parse request, call this).
This is where the kill switch is checked (before any model call) and
where the `NO_VALID_OBJECTIVE` / `REPEATED_OBJECTIVE` / `AUTOMATION_PAUSED`
signals are logged. See `docs/DEPLOYMENT.md`.

## `eval/regression/`

Per-domain regression suite, gating future package edits. Reuses 5A's
`ScriptedProvider` pattern via a genuinely shared framework
(`regressionFramework.ts`) — not copy-pasted per domain, proven by
building the insurance suite second with zero framework changes. See its
own `README.md` for the four required path types and scope boundaries.

## `src/services/` and `src/dashboard/` — Operator Dashboard

New scope, parallel to the bot itself — doesn't block or get blocked by
kernel work. Governing rule: **the dashboard owns presentation only; it
never touches a file or `ConversationStore` directly.** Every operation
goes through a service.

| File | Responsibility |
|---|---|
| `src/services/configurationService.ts` | Owns all business-config I/O. Save pipeline: load → modify → verify (reusing `verifyDomainPackage()`, no reimplementation) → version increment → backup → atomic write → hot reload. Version increment runs before backup/write, not after — the bumped version must be embedded in the document content itself before it's written. Comment-preserving writes via the `yaml` package's Document API — confirmed a naive parse-modify-dump cycle silently drops every comment before choosing this approach. |
| `src/services/conversationService.ts` | Wraps `ConversationStore` — the only thing besides `handleInboundMessage.ts` that imports it. `list`/`get`/`search`/`pause`/`resume`. `bin/kill-switch.ts` was refactored to call this too, so the CLI and the dashboard's buttons share one implementation, not two. |
| `src/services/backupUtil.ts` | Shared single-file backup primitive, used by both `bin/backup.ts` (conversation data) and `ConfigurationService` (domain packages) — one implementation of "copy a file into a backup folder." |
| `src/services/authUtil.ts` | `scrypt`-based password hashing (Node core, zero dependency risk — this project already hit one native-binary compile failure with `better-sqlite3`; a core-only solution avoids repeating that class of problem). |
| `src/dashboard/auth.ts` | HTTP Basic Auth middleware. No sessions/cookies/tokens — deliberately, matching the explicit single-shared-password scope. |
| `src/dashboard/routes.ts` | Thin Express router. Every handler is a direct call into one of the two services — no logic of its own, confirmed by an automated grep-based test, not just a comment asserting it. |
| `src/dashboard/public/index.html` | Single-file frontend, vanilla JS, no build step — matches this project's existing "boring technology, actually works" pattern (see the SQLite→JSON-file decision in `store.ts`) rather than introducing a framework/bundler for a single-operator internal tool. |

**Editable fields, narrowed from the original scope, not identically
matched:** `business.pricing.ranges` only, not `quoting_rules` (Engine-
evaluated, must match one of two fixed condition strings — an operator
typo wouldn't error, it would silently misbehave). `domain.variables`,
`completion_requirement`, and `fits_when`'s role as a matching mechanism
are genuinely absent from every API response, not UI-hidden — verified
directly against real HTTP responses, not assumed from the route code.

**Verification:** `eval/dashboard/verification.ts` (`npm run
dashboard-verify`) — invalid-edit rejection, successful-save pipeline
(version/diff/comment-preservation/hot-reload), kill-switch parity against
the real pipeline gate, the governing-rule grep check, lock-pattern
correctness, and reload-failure recovery. One full-stack pass (auth, live
hot reload on a running process, kernel-field absence, kill switch) was
also run manually against a real booted server — not repeated as an
automated test, since spinning up and tearing down a real server per test
run trades real flakiness risk for marginal coverage beyond the service-
layer tests, which are what the HTTP routes actually call.

## What's deliberately NOT built this pass

- **`nurture/`, `workflow/`** — stub `README.md` only. Building these now
  would violate the accepted sequencing (kernel proven first, per Arch1).
- **`eval/conversations/`** — the 10 stress-test scenario names are scaffolded
  as empty files, but their expected-outcome content is not written. Per
  Evaluation Protocol §2, that has to be defined by a human (or reviewed by
  one) *before* the conversation is run — I'm not filling those in as a
  formality.
- **Lifecycle transition validation** — genuinely blocked, not skipped. See
  `lifecycle.ts`.
