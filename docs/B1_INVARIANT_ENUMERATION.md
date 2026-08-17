# B1 — Invariant Enumeration

**Note before reading further:** the "5 zero-objective cases" this
document originally identified were reclassified after a follow-up
specification review — see the Addendum at the bottom. **3 are actually
correct behavior** (post-recommendation, `lifecycle` legitimately moving
toward completion), **2 are a genuine, separate, still-open gap**
(explained by Problem B, below). Read the Enumeration section below with
that in mind, not as "5 equally-open bugs."

Per Dev2's handoff. Part 1 (interface-only `lifecycle` parameter) is done —
verified behavior-neutral: full regression suite (typecheck, state model
sanity tests, insurance friction demo) produces byte-identical output
before and after. See `src/engine/objective.ts` and the reordering note in
`src/engine/pipeline.ts` (lifecycle resolution moved earlier so it could be
passed in; no logic changed).

This is Part 2 — the enumeration and invariant check, run against real code
where possible (`npx tsx eval/domain/post-recommendation-traces.ts`), using
Traces 1–6 from `docs/POST_RECOMMENDATION_TRACES.md`. `lifecycle` is
treated as one of the observable inputs to check against the invariant, not
assumed to be the answer to anything.

**Invariant under test:** *every reachable conversation state should map to
exactly one valid objective.*

Note on method: the code always returns exactly one objective mechanically
— it's a deterministic priority chain with `produce_recommendation` as the
terminal fallback, so it can never literally return zero or multiple.
"Valid" here means something the current four-objective taxonomy can
actually justify, not what the code happens to output. Where the code's
single mechanical answer isn't defensible, that's recorded as a zero-valid
case, not a code error — the code is doing exactly what it's specified to
do; the specification's coverage is what's in question.

---

## Enumeration

| Trace | State (completion_requirement) | Lifecycle | Pending question? | Code's objective | Valid objectives (judgment) |
|---|---|---|---|---|---|
| 1 | satisfied | `completed` | no | `produce_recommendation` | **Zero** among the current four |
| 2 | satisfied | `active` | yes (payment logistics) | `answer_pending_question` | Exactly one — matches |
| 3a | satisfied | `active` | yes (price, phrased as Q) | `answer_pending_question` | Exactly one — matches |
| 3b | satisfied | `active` | no (price, phrased as statement) | `produce_recommendation` | **Zero** among the current four |
| 4 | satisfied, then conflicted | `active` | no | `resolve_conflict` | Exactly one — matches |
| 5, Day 1 | satisfied | `paused` | no | `produce_recommendation` | **Zero** among the current four |
| 5, Day 6 (a) | satisfied | `active` | yes, if Call A classifies it as a question | `answer_pending_question` | Exactly one — matches |
| 5, Day 6 (b) | satisfied | `active` | no, if Call A treats it as pure re-engagement | `produce_recommendation` | **Zero** among the current four |
| 6 | satisfied | `escalated` | no (treated as lifecycle signal, not a question — see assumptions) | `produce_recommendation` | **Zero** among the current four |

**No multi-valid-objective case turned up** in this trace set. Worth
flagging as a limitation of the evidence, not a conclusion — six
hand-constructed traces aren't exhaustive, and a case where two objectives
are both independently defensible (as opposed to zero being defensible)
might exist but isn't represented here.

---

## Addendum — Step 1 verification (specification reconciliation check)

Per Arch2's follow-up: Runtime Specification §Step 4 contains a sentence
— present since the very first `lifecycle`-introducing addendum, verified
directly against the actual uploaded zip from that round, not assumed —
stating that once a recommendation is produced, `lifecycle` moving toward
`completed` is itself the resolution, not a further runtime objective.
This raised the question of whether the 5 zero-objective cases originally
reported above were actually a documentation gap (the exhaustiveness proof
was only ever scoped to the pre-recommendation region) rather than a
kernel bug — investigated below, not assumed either way.

**Required check: does every zero-objective case coincide with `lifecycle`
having moved away from `active`, or did any occur while still `active`?**

| Case | Lifecycle | Coincides with non-`active`? |
|---|---|---|
| Trace 1 | `completed` | Yes — literal match |
| Trace 3b | `active` | **No** |
| Trace 5, Day 1 | `paused` | Yes, if "moves toward completed" is read as a trajectory through non-`active` terminal-ish states generally, not the literal value `completed` only — see note below |
| Trace 5, Day 6 (b) | `active` | **No** |
| Trace 6 | `escalated` | Yes, same reading as above |

**Result: 2 of 5 do NOT coincide — the original "5 zero-objective cases"
framing above is superseded by this reclassification: 3 genuine
post-recommendation terminal cases, and 2 separate cases.** Per
instruction, stopping here rather than proceeding to any implementation —
Trace 3b and Trace 5-Day-6(b) are zero-objective while `lifecycle` is
genuinely `active`, not moving toward completion. Confirmed these are
correct classifications, not misclassification: both messages ("that's
more than I budgeted for," "still keen, is the offer still available")
are ongoing engagement with no signal of intentional return, satisfaction,
or escalation — `active` is the right call for both, re-examined now, not
just carried over.

**Precise claim, not generalized further than shown: these two observed
zero-objective traces (Trace 3b, Trace 5-Day-6(b)) are explained by
Problem B** (this same document's "Problem B" section above, and the
production handoff's Item 2) — not "Problem B explains the zero-objective
phenomenon" as a general claim. Both happen to be the same statement-
phrased-objection pattern already logged as Problem B: messages that
substantively need a response aren't captured by `pending_customer_question`,
regardless of lifecycle. A fix was implemented for this (sharpened Call A
instructions, see `src/llm/callA.ts`) but its effectiveness remains
**unverified** — same environment constraint as Items 5/6, no live model
access from this session. The reconciliation Arch2 describes does not
resolve or subsume Problem B; they're independent, and neither alone
closes B1.

**Interpretive note, not resolved unilaterally:** Arch2's question framed
the check as a binary (`completed` vs. `active`), which doesn't cleanly
cover `paused`/`escalated`. Reading "moves toward completed" as a
trajectory through any non-`active` state (consistent with this
document's own original "lifecycle ≠ active" framing, chosen deliberately
over a narrower one) makes Trace 5-Day-1 and Trace 6 consistent with the
reconciliation. Flagging this reading rather than silently assuming it.

---

## Pattern observed

Two separate patterns showed up in the zero-objective cases — kept
separate deliberately, since collapsing them into "shares one property"
(as an earlier draft of this section did) implied a single mechanism where
there are actually two:

- Across the enumerated traces, every zero-objective state also had
  `lifecycle ≠ active`. This held for all three non-`active` values that
  appeared (`completed`, `paused`, `escalated`), recurring across three
  independently-reasoned traces (1, 5-Day-1, 6), not just the one that
  prompted the original finding — but three traces is still the full
  extent of the evidence gathered, not a proof it holds generally.
- Separately, some zero-objective states involved a message that wasn't
  captured as a formal question, regardless of lifecycle (3b, and 5-Day-6
  branch (b), both `active`) — a different mechanism from the one above,
  and not to be merged with it.

This suggests two separable problems, not one:

**Problem A (lifecycle-correlated):** in every traced case where
`lifecycle ≠ active` and the state was already fully satisfied, no
objective in the current four was defensible. Trace 4 is worth noting as a
boundary check on this, even though it wasn't literally one of the six
lifecycle values under test: it shows conflict-resolution stays valid
regardless of lifecycle, which is reassuring — Problem A appears specific
to the *terminal fallback* (`produce_recommendation`ing repeatedly), not to
the whole objective set.

**Problem B (input-contract correlated):** whether a customer's message
gets treated as a "pending question" depends entirely on surface phrasing
(a literal question mark, roughly), not intent. A budget objection and a
"is the offer still available" check-in are both substantively requests
for a response, and both fail the same way when phrased as statements
rather than questions.

---

## Assumptions made, recorded explicitly (per the ask)

1. **All `proposed_lifecycle` and `pending_customer_question` values are my
   own realistic-but-simulated classifications of what Call A would output
   — not live-model-verified.** Stated in every trace document so far;
   restating here since it's load-bearing for this entire enumeration.
2. **Trace 4's lifecycle** (`active`) wasn't explicit in the original trace
   write-up — assumed here since nothing in that message signals otherwise.
3. **Trace 5, Day 6 was under-specified in the original write-up** — I'd
   described it narratively without committing to whether Call A would set
   `pending_customer_question`. Re-examining for this report surfaced that
   it's a genuine judgment call, so I ran both branches rather than picking
   one silently. This is a correction to my own earlier looser pass, not
   new information.
4. **Trace 6's classification as a pure lifecycle signal, not also a
   pending question,** is a judgment call I could see argued the other
   way — "can I speak to a person" could reasonably set both fields at
   once. Recorded as an open classification question, not resolved here.
5. **"Valid objective" has no formal definition** — this entire invariant
   check is a human-judgment exercise (would a competent agent do this?),
   not something derivable from the code. Worth being explicit that "zero
   valid objectives" is a claim about business defensibility, not a
   provable property.
6. **The taxonomy's three categories didn't cleanly partition Trace 1's
   finding** — see below. Recording this as a finding about the taxonomy,
   not silently picking a label.

---

## Taxonomy application (per Dev2's three categories — data-flow gap /
## responsibility mismatch / input-contract omission)

- **Problem A** (lifecycle ≠ active still falls through to
  `produce_recommendation`): genuinely ambiguous between **data-flow gap**
  (the value now reaches the function per B1, but still isn't acted on —
  though that's now a choice, not an omission) and **responsibility
  mismatch** (arguably Step 4 shouldn't be invoked at all once lifecycle
  is non-active — that's a different layer's decision to make, not
  Step 4's to make correctly). I don't think this resolves cleanly to one
  category as currently defined, and I'd rather report that than force it.
- **Problem B** (statement-phrased objections/questions unrecognized):
  cleanest fit is **input-contract omission** — `pending_customer_question`
  and `readiness`'s sub-attributes don't capture what's needed, and no
  amount of correct behavior downstream can compensate for missing input.
- **Trace 5's separate lifecycle-vocabulary gap** (from
  `POST_RECOMMENDATION_TRACES.md`, not this enumeration): doesn't fit any
  of the three categories as stated — it's not a flow problem, a
  responsibility problem, or an input problem, it's a **vocabulary/coverage
  problem** (the enum itself lacks a needed value). Flagging as a possible
  fourth category, or evidence the three aren't meant to be exhaustive —
  consistent with "explicitly not framed as complete."

---

## Explicitly out of scope here, per the task boundary

No gating logic proposed or implemented. No recommendation on whether
Problem A's fix is "short-circuit before Step 4" vs. "reorder within
Step 4" vs. something else — that's the next decision, not this report's.
