# B2 — Lifecycle Vocabulary: Documented v1 Limitations

Per production handoff item 3. Written honestly, per the explicit
instruction that if it looks bad, that's a signal to reconsider rather than
soften. My actual recommendation is at the bottom, not just the list.

## The concrete situations

1. **A customer on day 1 of qualification and a customer on day 6 of their
   7-day decide-or-expire window are both just `active`.** Call B has no
   input signal to distinguish "still figuring out what they need" from
   "already has a recommendation, deciding whether to pay before a link
   expires." Tone and urgency framing can't adapt to which one it's
   actually talking to.

2. **A customer who's gone quiet for 3 days mid-decision-window and a
   customer who just started the conversation 30 seconds ago are
   indistinguishable in stored state**, beyond `last_customer_activity`'s
   raw timestamp — which nothing currently reads or acts on.

3. **`paused` doesn't distinguish "will return in an hour" from "will
   return in 6 days."** Both get the identical lifecycle value from an
   identical Call A instruction ("customer signaled an intentional,
   expected return"), with no duration signal captured at all.

## The one that isn't cosmetic — flagging clearly, separate from the above

The three above are genuinely "suboptimal, not broken" — worse tone, not
wrong behavior. But there's a fourth thing, surfaced by the B1 fix I just
implemented, that I don't think belongs in the same bucket:

**Right now, once a recommendation has been delivered, almost any
follow-up that isn't captured as a formal pending question results in "no
valid objective" — no automated reply, human handoff required.** That's
not a lifecycle-vocabulary problem specifically (it's B1's separately-open
fallback-objective question), but it means the practical, near-term impact
of *not* having richer lifecycle semantics is currently larger than "tone
is a bit generic" — it's "the bot goes silent at exactly the point in the
conversation where the money decision happens, for most non-question
replies." I'd weight this higher than the three tone-quality items above
when deciding urgency, even though it's technically a different open
question.

## My actual recommendation

**Accept as a documented v1 limitation for the three tone-quality items.**
None of them produce wrong information, a bad recommendation, or lost
data — they produce a slightly less contextually sharp reply. That's a
real cost, not a fake one, but it's the right size of cost to ship past for
a v1.

**One condition I'd attach, not a veto:** this business's core mechanic —
build fast, then a week to decide, with personalized nurture during that
week — was the *original* feature request this whole project started
from, and it depends directly on exactly the distinction item 1 above
describes. Accepting this limitation for v1 qualification is fine. Accepting
it silently *once nurture gets built* is not — at that point this stops
being a tone-polish question and becomes "the flagship feature can't tell
what day of the decision window it's in." I'd want this limitation
re-reviewed at that point, not carried forward by default.

**On the fourth item (fallback-objective gap):** not this document's
decision to make — that's item 1's open sub-question — but I'd treat it as
higher rollout priority than this document's three items, since it affects
whether an automated reply happens at all, not just its quality.
