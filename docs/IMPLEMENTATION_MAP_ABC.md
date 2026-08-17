# Implementation Map — Deltas A, B, C

Required deliverable before any code is written. No source files were
changed to produce this — every claim below was checked against a
throwaway test script, not asserted from memory, then discarded. The two
tests worth keeping permanently are noted under Delta A and B; they don't
exist as committed files yet.

## Headline answer to the explicit question: one change or several?

**One coherent implementation pass through `pipeline.ts`, not three
separate pieces of work — but not because the three deltas are the same
problem.** They're logically independent. They converge because:

1. **Deltas A and B, checked against the current code before assuming
   anything, are already structurally satisfied.** The real work for both
   is verification + a permanent regression test, not new construction.
   See below — this changes the shape of "the implementation" a lot from
   what the delta descriptions might suggest in isolation.
2. **Delta C is the only one requiring substantial new logic**, and it has
   a real dependency on Delta B already holding (its branching logic reads
   `lifecycle` and needs that signal uncontaminated by automation state) —
   not a new dependency to build, just one Delta C's design leans on.
3. Touching `determineObjective()`'s call site in `pipeline.ts` three
   separate times for three separate reviews is more error-prone than one
   careful, fully-tested pass through the same ~40 lines.

Delta D (provider adapters) is correctly excluded from this map — it's
sequenced later and wasn't part of what was asked for here.

---

## Delta A — TurnContext

### Current state, verified empirically, not assumed

Built a throwaway test: a `chatCompletionFn` that, when Call A resolves,
triggers a **real** `ConfigurationService.saveChanges()` mid-turn — the
exact race the delta describes — before Call B runs.

**Result:** `domainRef.current` genuinely changed mid-turn (confirmed by
reading it directly after the reload). Call B, running later in the same
`runTurn()` call, still received the **old** value. The property Delta A
requires already holds.

**Why, mechanically:** `server.ts`'s webhook handler reads
`domainRef.current` exactly once, before calling `handleInboundMessage()`,
and passes that as a plain object reference. Every downstream read inside
`runTurn()` — extraction, objective determination, pricing, Call B's
input — uses that same parameter, never re-touching `domainRef.current`.
This wasn't designed as "TurnContext"; it's an accurate byproduct of
threading a plain object through function parameters and never re-reading
the mutable ref. `RunTurnParams` (the existing type in `pipeline.ts`) is,
structurally, already what this delta calls `TurnContext`.

### Gap

The guarantee is **implicit**, not enforced or self-documenting. Nothing
stops a future change from reading `domainRef.current` again inside some
deeper function and silently breaking this without anyone noticing —
there's no named concept marking "this is a frozen snapshot," and no test
proving the property, just an accident of how the code happens to be
wired today.

### Proposed minimal change

Not a new abstraction — hardening an already-correct property:

| File | Change |
|---|---|
| `src/engine/types.ts` | Add `domainVersion: string` to `RunTurnParams` (or rename the type to `TurnContext` if that's preferred for clarity — functionally the same either way, this is a naming call, not a design one) |
| `src/whatsapp/handleInboundMessage.ts` | Where `runTurn(...)` is called — construct the params object explicitly at the top, `Object.freeze()` it, so a future accidental mutation or re-read throws instead of silently succeeding |
| `eval/5a-harness/` (new file) | Commit the race-condition test above as a permanent regression test — this is the actual evidence for the corrected/confirmed behavior, not just this map's prose |

**Not proposing:** a new `TurnContext` class, a construction service, or
anything beyond making an already-true property explicit and tested.

---

## Delta B — Automation / Lifecycle separation

### Current state, verified empirically

Built a throwaway test: paired `pause()`/`resume()` via `ConversationService`
against a record with `lifecycle: "active"`, checked lifecycle after each
call. Then checked the reverse direction — does `resolveLifecycle()` (the
function that sets `lifecycle`) have any parameter or path that touches
`automation_paused`?

**Result:** `automation_paused`/`paused_reason`/`paused_at`/`paused_by`
already live as top-level `ConversationRecord` fields, siblings to
`conversation` (which holds `lifecycle`), not nested inside it. `pause()`/
`resume()` never touch `record.conversation` at all. `resolveLifecycle()`
takes `{current, proposed}` — no automation-state parameter exists for it
to read even if it wanted to. Confirmed in both directions, not just
checked that the fields are separate in the type definition.

This was a deliberate choice several rounds ago (checked against the
Governing Principle before adding `automation_paused`, at the time — not
newly discovered here), not an accident like Delta A. The structural
separation this delta asks for already exists.

### Gap

Naming/typing only: `automation_paused: boolean` isn't formalized as a
named `RUNNING | PAUSED` enum the way `Lifecycle` is. Cosmetic, not
structural — flagging it since the delta's pseudocode suggests an enum,
but I don't think this is worth doing unless there's a reason beyond
matching the pseudocode literally.

### Proposed minimal change

| File | Change |
|---|---|
| `eval/dashboard/` or a new `eval/` file | Commit the independence test above as a permanent regression test |
| — | No source changes proposed. The property already holds; a test proving it is the actual deliverable. |

**Explicitly not touching:** anything about what `lifecycle` values mean
or when they're assigned. B2 stays exactly as open as it was — this delta
doesn't touch Call A's lifecycle-proposal instructions at all, confirmed
by there being no code path connecting automation state to lifecycle
assignment in either direction.

---

## Delta C — B1's `ObjectiveResult` tri-state

**This is the real work in this map.** Unlike A and B, nothing here
exists yet — `determineObjective()` currently throws `NoValidObjectiveError`
for every case that isn't a clean objective match, undifferentiated. This
delta asks for that to split into three outcomes, using evidence already
gathered and verified (ADL entries 017/018): the exact 3-vs-2 split from
Step 1's verification — 3 legitimate terminal cases, 2 genuine Problem B
gaps — maps directly onto `NoObjective` vs `Error`.

### Design, following the explicit rule (`NoObjective` is not a disguised
### fifth objective)

```typescript
// src/engine/types.ts
type ObjectiveOutcome =
  | { kind: "objective"; objective: Objective; target: string | null }
  | { kind: "no_objective" }   // terminal, expected -- Call B responds with no directive
  | { kind: "error"; reason: string };  // genuine gap -- Problem B territory, unchanged behavior
```

This is a property of the **return type**, not a member of the `Objective`
union — `Objective` itself stays exactly four values, untouched. The
distinguishing logic reuses exactly what Step 1 already verified: reaching
the current fallback branch, then checking `lifecycle !== "active"` → `no_objective`;
`lifecycle === "active"` → `error`. Not new investigation — applying
already-verified evidence.

### Files and functions touched

| File | Change |
|---|---|
| `src/engine/types.ts` | New `ObjectiveOutcome` discriminated union. `CallBInput.selected_action` becomes `Action \| null` (or an equivalent variant) — Call B needs a "no directive, respond naturally" mode for `no_objective` |
| `src/engine/objective.ts` | `determineObjective()` returns `ObjectiveOutcome` instead of throwing. The current single fallback throw splits into the two outcomes above, using the `lifecycle` parameter for real for the first time — it's been threaded through since B1 Part 1 but never consumed until now. `NoValidObjectiveError` likely retired or narrowed to only the genuine `error` case |
| `src/engine/pipeline.ts` | `determineObjectiveSafely()` — the try/catch wrapper added specifically to convert the old throw into a result — becomes redundant once the return type itself is a discriminated union, and should be removed rather than kept alongside the new type. Call site switches on `outcome.kind`: `objective` → existing path unchanged; `no_objective` → call Call B with no `selected_action`; `error` → existing `reply: null` / `requiresHumanHandoff: true` path, unchanged |
| `src/llm/callB.ts` | New branch in the instruction/input assembly for "no selected_action" — respond naturally per Prompt Spec §3.4's realization guidance, no directive driving the turn |
| `src/whatsapp/handleInboundMessage.ts` | Currently treats "no objective" as always meaning `reply: null` + human handoff. That's only correct for the `error` case now — `no_objective` needs to produce and send a real reply. This is the one place a wrong split here would be immediately visible (a customer who just said "thanks!" either gets silence or gets a reply, no in-between) |

### Existing tests this invalidates or requires updating, not silently left stale

- `eval/5a-harness/scenarios.ts` scenario 6 — currently asserts
  `NoValidObjectiveError` fires and `reply: null`. That customer profile
  (recommendation delivered, lifecycle completed, "thanks!") is exactly a
  `no_objective` case per Step 1's own findings — this test's expected
  outcome flips from "no reply" to "a real reply, no directive."
- `eval/domain/post-recommendation-traces.ts` — its entire premise was "5
  traces should throw." Post-Delta-C, 3 of those become `no_objective`
  (real reply expected) and 2 remain `error` (unchanged). This file's own
  postscript already flags this is coming; this is where it actually
  lands.
- `docs/B1_INVARIANT_ENUMERATION.md`, ADL entries 012/017/018 — referenced,
  not rewritten, per the established pattern of not silently editing
  historical entries — a new entry documents the implementation against
  this already-verified evidence.

### What Delta C does NOT touch

Problem B's actual fix (Call A's statement-vs-question recognition) is
unaffected by this — the `error` outcome still exists for exactly the 2
cases Problem B causes, and fixing Problem B is what would eventually
shrink that case to zero, not this delta. Kept deliberately separate, per
the handoff's own "Problem B — narrow fix only" section.

---

## Explicit dependency map (what the handoff asked for)

```
Delta A (config snapshot) ─── logically independent of B and C
Delta B (automation/lifecycle) ─── already holds; Delta C's design
                                     depends on it holding (verified,
                                     not a new dependency to build)
Delta C (ObjectiveResult) ─── the only delta with real new logic;
                                touches the same functions A and B's
                                tests exercise, hence one coherent pass
```

## What I'm explicitly not proposing, per the freeze rule

No new persisted "regime" field. No `ConversationOrchestrator` or similar.
No change to `Lifecycle`'s five values or to Call A's lifecycle-proposal
instructions. No broad intent taxonomy anywhere near Delta C's Call B
branch — "no selected_action" is a single new case, not a new
classification system.

## Sending back for review before writing anything

Two specific decisions worth confirming before implementation, not assumed:
1. Delta A: rename `RunTurnParams` → `TurnContext`, or add `domainVersion`
   to the existing type and leave the name alone? Functionally identical;
   purely which is clearer to whoever reads this next.
2. Delta C: `CallBInput.selected_action: Action | null`, or a cleaner
   discriminated variant on `CallBInput` itself mirroring `ObjectiveOutcome`?
   Leaning toward the latter for consistency, not fully decided.
