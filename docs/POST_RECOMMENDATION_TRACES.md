# Post-Recommendation Conversation Traces — Finding B Evidence

Requested by Arch2, to decide whether Finding B's fix is a lean priority
reorder (if `lifecycle.completed` already cleanly captures things) or
requires refining lifecycle semantics. Traces and observations only, per
the ask — no implementation changes made or proposed here.

**Methodology:** Traces 1, 3a, 3b, and 4 below were run against the real,
already-built Engine (`determineObjective`/`applyEvidence` — not reasoned
about in prose). Call A's output at each turn is a realistic, hand-
constructed hypothesis, not live-model-verified (no API key in this
environment) — but everything downstream of that hypothesis is actual code,
actually executed. Runnable yourself: `npx tsx eval/domain/post-recommendation-traces.ts`.
Traces 5 and 6 are about `lifecycle` vocabulary rather than deterministic
Engine branching, so they're argued narratively instead — the Engine has
no relevant logic to run them against yet.

---

## Trace 1 — Clean acceptance

> **Customer:** "This looks perfect, let's do it 🙌"

Recommendation was already given last turn; nothing about the customer's
situation changed. Call A would plausibly propose `lifecycle: completed` —
the qualification job is done, everything downstream (building the site,
sending the link) is Business Workflow, out of kernel scope.

**Verified:** `determineObjective()` takes no `lifecycle` parameter at all.
Whatever Call A proposes, Step 4 runs the identical priority order on the
next turn regardless — and since `completion_requirement` is still fully
satisfied, it selects `produce_recommendation` again. If the customer sends
one more message after this ("thank you!"), the Engine would tell Call B to
recommend a *third* time.

**This is the cleanest, most concrete evidence in the whole set.** The gap
isn't in `lifecycle` itself — `completed` is arguably the right value and
Call A can express it fine. The gap is that **nothing downstream reads it.**

---

## Trace 2 — Logistics question

> **Customer:** "Ok sounds good. How do I actually pay once I see it?"

Not run empirically — this one's unambiguous. `pending_customer_question`
gets set, `answer_pending_question` fires, `answer` handles it using
`business_knowledge`. This already works today, pre- or post-recommendation
— Step 4 doesn't know or care which phase it's in. No gap.

---

## Trace 3a — Price objection, phrased as a question

> **Customer:** "Can you do this for less?"

**Verified:** `pending_customer_question` set → `answer_pending_question` →
`answer`, with `pricing_context` available to Call B. Handled correctly by
the existing mechanism.

## Trace 3b — Same objection, phrased as a statement

> **Customer:** "Hmm, that's more than I budgeted for."

**Verified:** No pending question (nothing was asked), no clean variable to
attach it to, so Step 4 falls through to `produce_recommendation` again —
identical to Trace 1's gap. Call B would be instructed to restate the
recommendation, which does not address a budget objection.

**Also surfaced in passing, a smaller, separate finding:** `readiness`'s
description promises "timeline, budget awareness, decision authority," but
`completion.required` only tracks `["timeline"]`. There's no sub-attribute
for Call A to tag budget-related evidence against even if it wanted to —
the description overpromises relative to what's actually wired up. Content-
level gap, not Finding B itself; noting it here since this is where it
surfaced, not filing it as its own numbered finding.

---

## Trace 4 — New information reopens qualification

> **Customer:** "Actually, thinking about it more — I might want people to
> be able to pay a deposit online too."

This contradicts earlier evidence ("just a contact form, no booking or
payments"), which fed into the Lead-Generation Website recommendation.

**Verified:** Flagged as a `possible_conflict` on `booking_or_ecommerce_needs`
→ `resolve_conflict` → `clarify`. **Works correctly, no gap.** Conflict
detection doesn't know or care whether it's firing before or after a
recommendation — it's driven entirely by variable status, and that
mechanism is phase-agnostic by construction. This is the one place a real
branch is already handled properly.

---

## Trace 5 — Silence, then a late return near the decision window's edge

> Day 1, post-recommendation: "Let me think about it and discuss with my
> business partner."
> *(six days of silence — no inbound message, so no turn fires at all,
> confirming ADL-005's point: nothing agent-initiated can happen here)*
> Day 6: "Hi, sorry for the silence — we're still keen, is the offer still
> available?"

Day 1's message plausibly proposes `lifecycle: paused` — an explicit,
expected-return signal, matching Call A's own instructions. Day 6's message
would propose `active` again.

Not run against the Engine — this isn't a branching-logic question, it's a
vocabulary question. **Both Day 1 and Day 6 are describable as `active` (or
`active` then `paused` then `active`) under the current five-value enum.**
But that enum can't distinguish "Day 1, mid-qualification, active" from
"Day 6, post-recommendation, three days from the link expiring, active."
Those are different business situations — one needs qualification questions,
the other needs a countdown-aware nudge — and `lifecycle` alone can't tell
Call B which one it's in.

**This is the trace that ties directly back to ADL-006** (the `outcome`
extension point, logged before this experiment started): the build-then-
decide window this specific business runs on isn't representable by
`lifecycle` today, and no priority reordering fixes that — reordering
changes *which action fires*, not *what vocabulary is available* to
describe the situation in the first place.

---

## Trace 6 — Explicit escalation

> **Customer:** "Can I just speak to a real person about this?"

Not run against the Engine — this is a clean, well-defined case, not a gap.
`escalated` exists specifically for this and Call A's instructions cover it
exactly ("customer explicitly asks for a human"). Included for completeness,
not because it's interesting.

---

## Synthesis — direct answer to the question asked

**Does it stay simple, or does it branch?** It branches, in at least three
distinct ways. But the three branches aren't the same *kind* of problem,
and conflating them would be a mistake:

1. **Already handled, no gap** (Trace 2, 3a, 4): question-phrased follow-ups
   and reopened qualification both work today, because the mechanisms
   involved (`answer_pending_question`, conflict detection) are correctly
   phase-agnostic — they never needed to know about recommendation status
   in the first place.

2. **A lean priority reorder plausibly fixes this** (Trace 1, 3b, part of 5):
   `produce_recommendation` fires repeatedly forever once
   `completion_requirement` is satisfied, because **Step 4 has zero
   awareness of `conversation.lifecycle`**, verified directly from the
   function signature, not inferred. The fix this evidence points toward:
   gate Step 4 on `lifecycle` *before* running the normal priority order —
   if `completed` (or `abandoned`), don't just fall through to recommend
   again. This reuses a field that already exists, which is exactly what
   the Governance Principle's step 3 asks to check first. Whether this is
   the *same* root cause as the original Finding B (`branding_assets`/
   `readiness` permanently blocking recommendation) is a separate
   question — this fix addresses "recommend fires redundantly after
   completion," not "recommend never fires because an optional variable
   won't complete." **Worth architecture review treating these as two
   related but distinct defects in Step 4, not one.**

3. **Requires refining lifecycle semantics, not fixable by reordering**
   (Trace 5): the enum's five values can't distinguish active-qualification
   from active-but-waiting-on-a-decision. No amount of reordering *when*
   things fire changes *what lifecycle can say* about where the
   conversation actually is. This is where ADL-006's `outcome` property —
   already flagged, already logged as needing exactly this kind of
   evidence — becomes directly relevant rather than speculative.

**Recommendation, not a decision:** treat these as two separate follow-up
items rather than one "Finding B fix" — (2) looks like genuinely lean,
low-risk work reusing `lifecycle` as-is; (3) is the one that actually
needs the deeper semantic discussion, and now has a concrete business-
grounded trace behind it instead of just ADL-006's original hypothesis.
