# Nurture — NOT BUILT

Deferred deliberately, per Arch1's accepted sequencing: prove the kernel
first, design nurture using lessons from real conversations against it, not
on whiteboard assumptions.

Known open question before this can start (ADL-005): the kernel's pipeline
entry point (`TurnEvent` in `src/engine/types.ts`) currently only implements
`inbound_message`. Nurture needs an agent-initiated event type (Day 2 / Day 4
/ Day 6 messages fire on a schedule, not in response to a customer message).
The type is already shaped to make that extension additive rather than
breaking — see `docs/ARCHITECTURE.md`'s note on the turn trigger — but the
actual scheduling, the objection/engagement tracking, and the domain-package
shape for a nurture "mode" are all undesigned.

Do not start this until:
1. The kernel has passed Evaluation Protocol §1–2 against the Website
   Development domain package
2. Real conversations have surfaced whatever the kernel actually needs to
   change (per Arch1: "if the kernel needs changes, designing nurture now
   risks baking assumptions into a part of the system that isn't proven yet")
