# Business Workflow — NOT BUILT

Site build trigger, preview link generation, link expiry, payment handling.

Explicitly out of scope of all six specification documents (confirmed
directly in Arch2's handoff). Deferred until after the kernel + nurture are
proven, same reasoning as `nurture/README.md`.

Relevant open item: `conversation.lifecycle = completed` doesn't distinguish
"recommendation given, deal closed" from "recommendation given, now in the
7-day build-then-decide window" — this business's actual flow. Logged as
ADL-006, concrete evidence for eventually promoting Runtime §7.1's dormant
`outcome` property. Don't build a workaround for this here until that's
resolved — see ADL-006 before inventing a parallel status field.
