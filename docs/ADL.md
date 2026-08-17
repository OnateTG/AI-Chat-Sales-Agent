# Architecture Decision Log

Append-only. Per Arch2's process: every entry records what was observed,
which spec was involved, diagnosis, who reviewed, and — if a spec changed —
what specific observed failure justified it. Ambiguous cases are logged and
held, not resolved unilaterally. Governing question for any proposed kernel
change: *what observed failure does this fix?*

---

### 001 — `acknowledge` action has no corresponding Step 4 objective

- **Observation (Dev1):** Runtime §Step 5 listed `acknowledge` as a valid
  action; Runtime §Step 4's objective priority list had no objective that
  would select it.
- **Diagnosis (Arch2 → refined by Arch1):** Initially treated as a missing
  objective. Arch1 reframed it as a category error — acknowledgment is a
  Call B response-realization technique, not a decision point.
- **Verification:** Exhaustive case-walkthrough (6 cases) confirmed the four
  remaining objectives fully partition all possible states given the
  recommendation gate. No dead zone.
- **Review outcome:** Accepted.
- **Spec change:** `acknowledge` removed from Runtime's action set and
  Prompt Spec's `selected_action` enum. Call B instructions updated:
  acknowledgment/reflection/empathy are realization techniques available
  under any selected action.
- **Pattern note (Arch1):** Third instance of the same category error
  (turn action vs. lifecycle vs. action vs. realization). Worth checking
  future proposals against: *is this a genuinely new decision point, or an
  existing decision expressed a new way?*
- **Status:** Closed.

---

### 002 — Lifecycle proposal mechanism undefined in Call A's schema

- **Observation (Dev1):** Runtime §7 stated lifecycle is "proposed by the
  LLM (as part of Call A or a dedicated lifecycle-assessment step)," but
  Call A's actual output schema (Prompt Spec §2.3, at the time) had no
  lifecycle field, and no dedicated third call was ever specified either.
- **Diagnosis:** Contract gap — Runtime promised a mechanism Prompt Spec
  never implemented.
- **Review outcome:** Accepted.
- **Spec change:** `proposed_lifecycle` added to Call A's output schema.
  Dedicated third-call option explicitly killed — number of LLM calls per
  turn stays fixed at two.
- **Status:** Closed.

---

### 003 — Abandonment paragraph referenced an unreviewed transition table

- **Observation (Dev1):** Runtime §7's abandonment paragraph said the kernel
  "validates that the transition is structurally legal per the table above,"
  while the transition table two paragraphs earlier is explicitly flagged
  `[OPEN — ARCHITECTURE REVIEW REQUIRED]`. Direct in-document contradiction.
- **Diagnosis:** Drafting error — one paragraph updated, a cross-reference
  to it wasn't.
- **Review outcome:** Accepted.
- **Spec change:** Abandonment paragraph now explicitly defers structural
  validation along with the rest of transition-table logic. No transition,
  including abandonment's, should be assumed validated until that review
  lands.
- **Status:** Closed.

---

### 004 — Pricing has a deterministic component; where does it live?

- **Observation:** Pricing isn't ordinary `domain_knowledge` prose — it has
  a descriptive part (what things cost) and a deterministic part (whether an
  exact quote is currently allowed, given conversation state).
- **Diagnosis:** The deterministic part must be Engine-evaluated, not
  LLM-inferred from instructions.
- **Review outcome:** Accepted. Scoped locally to a new Domain Package §5
  (`pricing.ranges` + `pricing.quoting_rules`), not generalized into a
  top-level "policy" category — one instance isn't evidence of a pattern.
- **Standing heuristic logged (not a spec change):** *Whenever information
  is consumed deterministically by the engine, represent it structurally.
  Narrative content stays prose. Whether structured content earns a new
  top-level classification is decided only by recurrence across independent
  domains* — watched pattern, promotable after 2–3 more domains
  independently need the same shape (e.g. insurance underwriting
  restrictions, discount eligibility).
- **Status:** Closed. Content (real price ranges) still pending from the
  business owner — placeholders only in the current domain package.

---

### 005 — Turn trigger scoped to inbound customer messages only

- **Observation (Dev1):** Runtime §1 requires "the customer's latest
  message" as pipeline input every turn. No agent-initiated entry point
  exists. Nurture (Day 2/4/6 messages) will need one.
- **Diagnosis:** Undetermined — not a defect. The kernel is correctly
  scoped to inbound-triggered turns per the documents' own stated scope
  (nurture explicitly excluded).
- **Review outcome:** Held, not acted on. No observed failure exists yet
  to justify a change — this is a hypothesis about a future need, not a
  confirmed gap, per the "what observed failure does this fix" rule.
- **Mitigation applied without a spec change:** `pipeline.ts`'s entry point
  is typed as a `TurnEvent` rather than hardcoded to a message shape, so the
  eventual generalization (if nurture design confirms it's needed) doesn't
  require an API-breaking change. This is an implementation-level
  precaution, not a kernel decision — logged here for visibility, not as a
  resolved item.
- **Status:** Open. Revisit when nurture design begins.

---

### 006 — `outcome` extension point: concrete business case identified

- **Observation (Dev1):** `conversation.lifecycle = completed` doesn't
  distinguish "recommendation given, deal closed" from "recommendation
  given, now in the middle of a 7-day build-then-decide window" — which is
  this specific business's actual flow (recommend → 24h build → week-long
  decide-or-expire).
- **Diagnosis:** Not a defect in the current schema — `lifecycle:completed`
  was never meant to capture this distinction. This is exactly the kind of
  case Runtime §7.1's dormant `outcome` property was written for.
- **Review outcome:** Logged as concrete, business-grounded evidence for
  future promotion of `outcome` to the active schema. Not built now — still
  requires cross-domain testing to justify, per the standing rule.
- **Status:** Open, held for future evidence-gathering.

---

### 009 — Second domain package experiment (insurance): kernel-level finding on optional variables, domain-level resolution on conditional relevance

**Objective (per Arch2's handoff):** test whether the kernel is genuinely
domain-reusable or implicitly coupled to website sales, without pre-solving
— build against the current Domain Package Specification as-is, let real
friction reveal what's needed.

**Two separate findings came out of this, of different severities:**

#### Finding A — conditional relevance (the hypothesis the domain was chosen to test). RESOLVED, domain-package-only, zero kernel changes.

- **Observation:** A naive first-authoring attempt (`eval/domain/insurance-attempt-1-naive.yaml`)
  declared three type-specific variables (`auto_details`, `life_details`,
  `health_details`). Empirically run against the unmodified kernel
  (`eval/domain/insurance-friction-demo.ts`), for a customer who explicitly
  wants life insurance only: the Engine's next objective was
  `progress_variable -> auto_details` — asking a life-insurance customer
  about their car. `produce_recommendation` could never fire while the two
  irrelevant variables stayed `unknown`, since nothing in State Model's
  status enum (unknown/partial/complete/conflict) can express "not
  applicable to this customer."
- **Diagnosis:** Domain-package weakness, not kernel weakness. The naive
  authoring picked too fine a grain for domain-specific variables —
  type-specific intake fields belong to underwriting, not qualification
  (consistent with the SOP's own scope: qualify and recommend, not run a
  full intake form).
- **Resolution:** Rebuilt as `domains/insurance.yaml` with ONE generic
  domain-specific variable (`coverage_needs`) applicable across all policy
  types, exactly mirroring how `website-development.yaml` never tracks
  "which of the 4 site types" as its own variable either — that match is
  inferred at recommend time from `available_options.fits_when`. Verified
  empirically: same customer profile, `produce_recommendation` fires
  cleanly, zero irrelevant questions.
- **Also surfaced while investigating this:** the exact same shape of bug,
  in miniature, was already present in the **shipped** `website-development.yaml` —
  `current_situation`'s `existing_site_condition` sub-attribute can never
  be satisfied for a customer with no existing site, permanently blocking
  a critical variable from completing. This was a real, live bug, not
  hypothetical — confirmed empirically before fixing. Fixed using the same
  principle: collapsed to one always-answerable sub-attribute
  (`situation_described`). **General domain-authoring principle extracted:**
  a variable's `completion.required` sub-attributes must all be universally
  applicable to every customer in the domain — if one only sometimes
  applies, collapse it into a broader always-applicable sub-attribute
  rather than splitting.

#### Finding B — optional/supplementary variables permanently block recommendation. NOT RESOLVED. Kernel-level, not domain-authorable.

- **Observation:** `branding_assets` (importance: medium, deliberately
  excluded from `recommendation.completion_requirement`, per the Domain
  Package Specification's OWN worked example) was empirically tested against
  a fully-qualified customer state: instead of firing `produce_recommendation`,
  the Engine selected `progress_variable -> branding_assets`.
  `produce_recommendation` never fires while ANY declared variable remains
  incomplete — completion_requirement only gates the recommend objective
  itself (Runtime §Step 4 priority 4); it does nothing to scope which
  variables priority 3 ("progress the highest-importance incomplete
  variable") considers. Priority 3 iterates over every declared variable
  regardless of importance or completion_requirement membership.
- **Checked against the existing mechanism before concluding kernel-level,**
  per the handoff's explicit instruction: dropped the test variable to the
  lowest possible importance tier (`low`) — still blocked recommend forever.
  Importance tiering only affects the ORDER variables are asked about; it
  doesn't exempt any variable from eventually gating recommendation.
- **Then found this reaches further than "optional extras":** `readiness`
  — a CORE variable, mandatory in every domain by the template itself
  (Domain Package Spec §1's fixed four core keys), always low-importance,
  always excluded from `completion_requirement` in both the original
  worked example and this domain package — reproduces the identical block.
  This rules out "just don't declare optional domain-specific variables" as
  a workaround, since the mandatory core template itself triggers it.
- **Diagnosis: Kernel weakness.** `recommendation.completion_requirement`
  does not do what its name and the Domain Package Specification's own
  description say it does ("the variables that must be complete before a
  recommendation can be made," implying others need not be). As Runtime
  §Step 4 is currently specified, completion_requirement can only ever
  functionally equal the full declared variable set, or recommend never
  fires — the concept of a variable that's tracked and opportunistically
  asked about but doesn't gate recommendation cannot currently be expressed,
  no matter how the domain package is authored.
- **Temporary mitigation applied to keep both domain packages functional**
  (NOT a fix, explicitly flagged in both YAML files): `branding_assets` and
  `risk_factors` removed as tracked variables entirely (demoted to
  `domain_knowledge` prose, no completion tracking); `readiness` — which
  can't be removed, being core-mandatory — instead had
  `completion_requirement` expanded to include it, admitting the limitation
  rather than routing around it. This restores a working recommend path in
  both domains but is a real capability regression against the design
  intent both domain packages (and the spec's own worked example)
  originally expressed.
- **What would justify a kernel change:** this — an empirically reproduced
  block on `produce_recommendation`, present in the spec's own reference
  example, not fixable through any domain-authoring choice. Per the
  project's own promotion rule, this is exactly the observed-failure bar,
  not a hypothesis.
- **Not proposing a specific fix.** Plausible directions exist (scope
  priority 3 to `completion_requirement`-listed variables only; or add an
  explicit "optional" designation) but picking one without review would be
  the same unilateral-kernel-change mistake the ADL process exists to
  prevent. That's Arch1/Arch2's call.

#### Six success criteria (per the handoff, checked independently)

| # | Criterion | Result |
|---|---|---|
| 1 | Runtime Specification changes | **0** |
| 2 | State Model changes | **0** |
| 3 | Prompt Specification changes | **0** |
| 4 | Conversation data contract changes (Call A ↔ Engine ↔ Call B) | **0** |
| 5 | Engine algorithm changes | **0 made** — but Finding B identifies a genuine gap in the existing algorithm, not just an untested edge. Recorded as 0 changes *implemented*, not as a clean pass. |
| 6 | Domain Package changes only | **Partially.** Finding A: yes, fully resolved by domain authoring alone. Finding B: no domain-package-only fix exists — the applied mitigation is a capability regression, not a resolution. |

A clean "6/6, no issues" would have been a weaker result than this — per
Arch2's own framing of what the experiment was actually for.

#### Friction log

| Layer where pressure first appeared | What felt strained | How it was resolved | Layer actually changed |
|---|---|---|---|
| Domain authoring | Type-specific variables (auto/life/health_details) caused irrelevant questions and blocked recommendation for out-of-scope policy types | Collapsed to one generic `coverage_needs` variable at the same grain as `gap`; policy type inferred at recommend time via `fits_when`, not tracked | Domain package only |
| Domain authoring (retroactive, found via this experiment, not new) | `website-development.yaml`'s `current_situation` had a sub-attribute that could never be satisfied for ~half of realistic customers (no existing site) | Collapsed two conditionally-applicable sub-attributes into one always-applicable one | Domain package only (already-shipped file corrected) |
| Engine / Runtime §Step 4 | `branding_assets` (medium importance, excluded from completion_requirement, per the spec's own worked example) permanently blocked recommendation | Checked importance-tiering as an existing-mechanism fix first (per instruction) — confirmed it does not help, at any tier | **None found that stays within domain-package-only authoring** — mitigation applied is a workaround, not a resolution |
| Engine / Runtime §Step 4 (deeper than expected) | Same block reproduced on `readiness`, a core-mandatory variable — rules out "avoid declaring optional variables" as a full workaround | `completion_requirement` expanded to include it in both domains, admitting the limitation | Domain package (workaround); root cause is kernel-level and unresolved |
| Pricing content (minor, not structural) | `pricing_context.mode: exact_quote_allowed`'s naming implies a fixed number is knowable from conversation alone — true for website pricing, not really true for insurance premiums (underwriting-dependent) | Left as a documented content caveat in `insurance.yaml`'s domain_knowledge rather than treated as a mechanism problem — the structure still works, "exact" just means "personalized estimate" for this domain | None — content-level note only |
| Testing rigor (self-observation, not a spec/kernel issue) | My own earlier smoke test for `website-development.yaml` (previous session) only verified the EMPTY-state case (first turn: ask about goal) — never verified a fully-qualified customer actually reaches `produce_recommendation`. Finding B would have been caught then had that end-state been tested. | Logged as a gap in my own prior verification discipline, not the spec's | N/A — process note |

- **Status:** Finding A closed (resolved, domain-package-only). Finding B
  open — needs Arch1/Arch2 architecture review before any kernel change is
  made. Both domain packages currently run on a documented, flagged
  mitigation, not the originally intended design.

---

### 010 — Restructure sync (domain/business/business_knowledge) + two process issues flagged, not resolved

- **Context:** Received a handoff from "Dev2" describing a restructure round
  (three-section split by consumer: `domain`/`business`/`business_knowledge`,
  replacing flat `variables`/`recommendation`/`pricing`/`domain_knowledge`)
  and a field rename (`domain_knowledge_snippet` → `business_knowledge_snippet`)
  that happened across rounds this repo wasn't present for. Verified both
  by direct diff against the actual uploaded spec files, not taken on
  description alone — confirmed accurate.
- **Action taken:** Synced `src/domain/types.ts`, `src/engine/types.ts`,
  `src/llm/callB.ts`, `src/engine/pipeline.ts`, both production domain
  packages, and the insurance experiment's eval files to the new structure.
  Full regression suite re-run and passing (state model sanity tests,
  insurance friction demo, both empty-state and fully-qualified-state
  checks for website-development). Kept the ADL-009 mitigation
  (`branding_assets`/`risk_factors` removed, `completion_requirement`
  expanded) in both production YAML files even though the spec's own
  updated illustrative worked example documents Finding B via comment
  without applying the mitigation — reasonable for an illustrative example,
  but this repo's YAML files have to actually run, not just teach the shape.
- **Process issue 1 — flagged, not resolved:** this handoff referenced
  edits to `docs/ADL.md` "inside the project zip," implying someone has
  been editing this repo's deliverable independently, in parallel, without
  it being shared back here first. That's the same failure mode the ADL
  process exists to prevent, one layer up (artifact drift, not just spec
  drift). Not something fixable unilaterally — flagged for whoever is
  coordinating between Dev1 and Dev2 to resolve.
- **Process issue 2 — flagged, not resolved:** "Finding B" as referenced in
  Dev2's handoff (post-recommendation conversation shape, "lean priority
  reorder" vs. "refining lifecycle semantics") was not obviously the same
  thing as this entry's Finding B on first read. Traced a plausible
  connection (completion_requirement's narrow original list may have been
  designed on the assumption that excluded variables get resolved *after*
  recommendation, making conversation shape post-recommendation the right
  evidence to gather before choosing a fix direction) — confirmed likely
  correct via the exact "ADL-009, Finding B" citation appearing in the
  restructured Domain Package Specification's worked example. Treating as
  confirmed unless corrected. Have NOT yet produced the requested
  post-recommendation conversation traces — holding until the process
  issues above are acknowledged, since building evidence against a
  moving/uncertain target risks wasted effort.
- **Process issue 1 — RESOLVED:** Arch2 confirmed "Dev2" was almost
  certainly a relay mislabel, not a real second implementer — no Dev2
  exists in this project. No action needed on this side.
- **Process issue 2 — RESOLVED:** Arch2 confirmed directly (not just
  inferred) that this is the same Finding B as this entry's. Traced
  reasoning was correct.
- **Follow-up sync issue found and corrected:** Arch2's delivered
  `docs/ADL.md` (meant to be the authoritative merge) was extracted from a
  zip that predated this entry, so it didn't include this entry at all —
  confirmed by direct diff, not assumed. Replacing wholesale would have
  silently deleted this entry. Merged instead: kept this entry, appended
  Arch2's Governance Principle addition after it. Nothing lost either
  direction.
- **Status:** Fully resolved. See `docs/POST_RECOMMENDATION_TRACES.md` for
  the requested conversation traces and synthesis — produced after this
  entry closed, evidence gathered as asked, no implementation changes made.

---

### 012 — Production handoff items 1–3

- **Item 1 (B1 gating fix) — implemented and partially verified.**
  `produce_recommendation` now gated on completion AND
  `!recommendation_delivered` (new `ConversationState` field, deliberately
  a bare boolean, not the full dormant `decision` object — see types.ts
  comment for why that distinction matters). Re-ran all 8 sub-cases from
  `POST_RECOMMENDATION_TRACES.md` with `recommendationDelivered: true`
  against the real fix: the 3 already-correct cases are unaffected; the 5
  previously-wrong cases now throw `NoValidObjectiveError` instead of
  silently repeating the recommendation.
  **[CORRECTION — see entry 017]:** the "5 previously-wrong cases" framing
  below was accurate to what was known at the time this entry was
  written, but is now superseded — entry 017's investigation found 3 of
  those 5 are actually correct behavior per the Runtime Specification's
  original intent (lifecycle moving toward completion), not kernel bugs.
  Only 2 remain genuine gaps, and those are explained by Problem B, not
  by this entry's framing. Left the original text below intact rather
  than rewritten, per the ADL's append-only principle — this note is the
  update, not a silent edit. **Reporting plainly, not
  papering over: this means B1 is not yet fully closed per the handoff's
  own exit criteria** ("the invariant holds across all traces") — 5 of 8
  sub-cases still produce zero valid objectives, now safely (loud error,
  human handoff) instead of silently (wrong repeated reply), but not yet
  resolved. Did not guess a fallback objective, per explicit instruction.
- **Item 2 (Problem B) — classified and fixed.** Confirmed Prompt
  Specification issue, not a kernel issue — root cause is directly visible
  in `callA.ts`'s own instruction text ("asked you a direct question"),
  no schema/type change needed. Instruction sharpened to detect
  communicative intent over surface phrasing. **Cannot verify the fix
  works** — no `NVIDIA_API_KEY` in this environment, and this is a
  prompt-behavior change that can only be verified against a live model.
  Flagging now rather than at item 6, per "flag immediately if you don't
  have what you need."
- **Item 3 (B2 decision) — recommendation given, not unilaterally decided.**
  Full writeup in `docs/B2_LIFECYCLE_LIMITATIONS.md`. My read: accept the
  three tone-quality limitations for v1, but flag the fallback-objective
  gap (item 1's open half) as higher near-term priority than lifecycle
  redesign, since it affects whether an automated reply happens at all.
  Also flagged: this limitation directly affects the not-yet-built nurture
  feature (the original feature request this whole project started from)
  and shouldn't be silently carried forward once that gets built.
- **Status:** Items 1 and 2 implemented, both with an explicit unverified
  edge flagged rather than hidden. Item 3 is a recommendation awaiting
  Arch1/Arch2 sign-off, not a unilateral decision. Items 4–6, Operations,
  versioning, and per-domain regression not started this round — reporting
  per-item as requested, not batching.

---

### 013 — Environment constraint on items 5/6 + Item 4 complete

- **Finding (verified, not assumed):** `integrate.api.nvidia.com`,
  `graph.facebook.com`, and `ollama.com` all return HTTP 403 from this
  environment's egress proxy, confirmed by direct curl, independent of
  credentials. This is a network allowlist constraint, not a missing-secret
  problem — providing an API key would not fix it. True live-model and
  live-WhatsApp testing (items 5's "real conversations" requirement, and
  item 6 entirely) cannot happen from within this session regardless of
  what credentials are supplied. Needs a different execution environment.
- **Item 4 — Configuration Verification System: complete.**
  `src/verify/verifyDomainPackage.ts` (the reusable function) +
  `bin/verify-domain.ts` (thin CLI wrapper) + `npm run verify-domains`.
  Package versioning built in from the start per instruction:
  `business_package.version` required field, `ConversationRecord
  .business_package_version` threaded through from actual load (not a
  stub) via `store.getOrCreate(phone, version)`.
- **Acceptance criteria met:** both `website-development.yaml` and
  `insurance.yaml` pass with zero errors. Explicitly checked whether the
  `current_situation` fix propagated, per the handoff's specific ask: it
  did — `current_situation` isn't flagged by the multi-sub-attribute
  warning at all (only one required sub-attribute now), which is the
  correct signature of the fix having landed.
- **One warning fired on `goal` (2 required sub-attributes) in both
  packages — reviewed, not just reported.** `desired_outcome` and
  `business_reason` are universally answerable for every customer, unlike
  `current_situation`'s old shape — this isn't the same bug, signing off
  on it rather than treating the warning as unresolved. Recording the
  judgment, not just the fact that the tool flagged something.
- **Verifier tested against a deliberately broken domain package**, not
  just the two real ones — 6 planted errors (unknown variable reference,
  empty fits_when, invalid quoting condition, mismatched pricing ranges
  x2, missing range) and 2 planted warnings all caught correctly, exit
  code 1. A verifier that only ever sees passing input isn't proven to
  verify anything.
- **One interpretive ambiguity flagged, not silently resolved:** the
  original handoff's "fits_when entries reference existing variables" is
  hard to implement literally, since `fits_when` is free-form prose for
  LLM interpretation (Domain Package §4.1), not structured variable
  references. Implemented as "non-empty" only, with the ambiguity stated
  directly in the check's own error message, not just in this log.
- **Status:** Item 4 complete and passing. Items 5/6 blocked on execution
  environment, not on any remaining kernel work — flagging for a decision
  on where live testing actually happens.

---

### 014 — Item 4 deployment gate + Item 5A Validation Harness

- **Item 4 follow-up (deployment gate) — complete, three layers, two of
  three empirically tested from this environment.**
  - Layer 3 (server.ts boot-time check, the one that can't be bypassed
    regardless of launch method): tested directly — refuses to start
    (`process.exit(1)`, never reaches `app.listen()`) against a
    syntactically-valid-but-semantically-broken package; boots and serves
    normally against the real one, warnings logged but non-blocking.
  - Layer 2 (`prestart` npm hook): tested directly — `npm start` against
    the broken package exits 1 before `server.ts` ever runs.
  - Layer 1 (GitHub Actions CI): written, not empirically tested — no real
    repo/CI run available from this environment. Flagging that distinction
    explicitly rather than claiming the same confidence as the other two.
  - **Explicit instruction followed: did not tighten any warning into an
    error.** The `goal` warning (correctly firing on a legitimately-fine
    pattern) stayed a warning, per the reasoning given — a tool that's
    right to flag something doesn't mean the finding should auto-reject.
- **Item 5A (Validation Harness) — complete, tracked separately from Item
  5 per explicit instruction, labeled as such in every file it touches.**
  Added a dependency-injection seam (`ChatCompletionFn`) at the one point
  that makes a real network call — `callA.ts`, `callB.ts`, and
  `pipeline.ts`'s `runTurn()` all accept an optional override, defaulting
  to the real implementation when omitted, so production behavior is
  unchanged by the seam's existence. `ScriptedProvider` replays scripted
  responses through that seam; everything else (prompt assembly, engine
  logic, state persistence) is the actual production code path.
  7 scenarios, all passing: first-turn extraction, multi-turn to
  recommendation (confirms `recommendation_delivered` flips exactly when
  expected), conflict detection, pending-question answering (confirms
  `business_knowledge_snippet` actually reaches Call B's real input, not
  just that some reply came back), pricing mode resolution, the B1 gate's
  `NoValidObjectiveError` propagating all the way to `reply: null` +
  `requiresHumanHandoff: true`, and lifecycle persisting correctly across
  two real sequential `runTurn` calls (not two fresh records — turn 1's
  actual output fed as turn 2's actual input, matching how server.ts
  really chains turns via the store).
- **Status:** Both complete. Item 5 (real conversation validation) and
  Item 6 remain genuinely open, unaffected by 5A passing — restating this
  because it's the exact distinction Arch2 flagged as easy to blur in
  status reporting.

---

### 015 — Operations checklist + Per-domain regression suite

- **Context:** working directory reset completely between the previous
  round and this one (confirmed empirically — `/home/claude` was empty).
  Restored from `/mnt/user-data/outputs/whatsapp-sales-agent.zip`, which
  survived the reset because it's delivered every round rather than left
  in scratch space. Full regression re-run and confirmed passing before
  any new work started, not assumed intact.
- **Kill switch:** `bin/kill-switch.ts` (pause/resume/status, real CLI
  against the real store) + `automation_paused` on `ConversationRecord`.
  Checked against the Governance Principle before building — confirmed
  NOT redundant with `lifecycle === "escalated"` (customer-initiated vs.
  operator-initiated, must work regardless of what lifecycle currently
  is). Server.ts's webhook handler was extracted into
  `src/whatsapp/handleInboundMessage.ts` specifically so the kill switch's
  actual integration point (not just its CLI logic) could be tested — 5A
  scenario 8 confirms `automation_paused: true` blocks `runTurn` from
  running at all (zero model calls made), not just that the flag can be
  set and read.
- **Misbehavior detection:** tracks (objective, target) pairs, not
  objective alone — deliberately, since `progress_variable` repeating with
  a *different* target each time is healthy qualification, not a stuck
  conversation. Logs a structured `REPEATED_OBJECTIVE` signal at
  threshold 3, does NOT auto-pause — detection and logging only, since
  auto-triggering the kill switch would be a real behavioral decision
  nobody asked for.
- **Honest scope note on "monitored signal":** no external
  metrics/alerting system reachable from this environment (same
  allowlist constraint as ADL-013). "Monitored" currently means
  structured, greppable `pino` log lines with a consistent `signal`
  field — documented as an explicit boundary in `docs/DEPLOYMENT.md`,
  not implied to be more than it is.
- **Backup:** `bin/backup.ts`, tested against real conversation data
  (creates a timestamped copy, confirmed the file actually lands).
  Remote/cloud backup and scheduling explicitly NOT built — real
  deployment-environment decisions, not guessed at.
- **Deployment gate — extended, not just documented:** boot now also
  warns (not hard-fails) on missing env vars, same "fail loud, don't
  silently degrade" principle as the domain-package gate. Tested directly.
- **`docs/DEPLOYMENT.md`** ties all of the above together: env vars,
  logging, the three monitored signals, kill switch usage, backup/restore,
  deployment procedure, rollback.
- **Per-domain regression suite:** `eval/regression/regressionFramework.ts`
  (reusable, zero domain-specific logic) + one scenario file per domain,
  4 path types each (happy/objection/clarification/recommendation), all
  8 passing. Built as a genuine extension of 5A's pattern, not a rewrite —
  same `ScriptedProvider`, same real `runTurn()`.
  **Proven to catch real regressions, not just pass on known-good input:**
  deliberately deleted an `available_option` from
  `website-development.yaml`, confirmed the recommendation-path scenario
  failed with a specific, correct error while the other three path types
  correctly kept passing (isolated failure, not a blanket break), then
  restored and reconfirmed all 8 green.
- **Open process question, not resolved unilaterally:** should this
  regression suite also be wired into the boot-time deployment gate, or
  stay separate from it? Documented as a live question in
  `eval/regression/README.md` rather than picking an answer — a package
  can be structurally valid and mid-regression-testing without that
  necessarily blocking what's *currently* deployed.
- **Status:** Both Operations checklist and per-domain regression
  complete. Items 5/6 still the only genuinely open items, still blocked
  on the environment decision.

---

## Governance Principle — Architectural Change Discipline

Not tied to a single numbered finding; recorded because the pattern held
across ADL-001 through ADL-009 and is worth stating explicitly rather than
leaving implicit. Every successful architectural change in this project's
history has followed the same sequence:

1. Observe implementation friction (a real transcript, a failing test, a
   contract that can't be satisfied as specified — not a hypothesis).
2. Identify the underlying invariant being violated, not just the surface
   symptom.
3. Check whether an existing concept already expresses that invariant
   before proposing anything new.
4. If not, repair it with the smallest possible change.
5. Keep the solution as small as possible.
6. Only introduce a new concept if no existing concept can express the
   required behavior.

Step 3 is the step most often skipped, and skipping it is what nearly every
walked-back proposal in this project's history had in common:

- `close` → resolved by moving completion into the already-existing
  `conversation.lifecycle`, not by inventing a new action
- `acknowledge` → resolved by recognizing it as response realization,
  already Call B's job, not by adding a fifth objective
- `policy` → resolved by structuring the field locally within pricing,
  not by adding a new top-level Domain Package category
- `decision` (raised again during Finding B discussion) → still pending,
  but the live hypothesis under review is whether `conversation.lifecycle`
  already expresses what's needed before any new object is considered

In every case, the first question that mattered was: *"Do we already have
somewhere this belongs?"* — asked and answered before any new concept was
proposed, not after.

This should be treated as a standing filter for any future proposal —
architectural or implementation-level, from Arch1, Arch2, or Dev1 alike —
before it's written up as a candidate specification change.

---

### 011 — B1: interface-only lifecycle parameter + invariant enumeration

- **Context:** A handoff arrived self-identified as "Dev2" — directly
  contradicting Arch2's prior confirmation that no Dev2 exists ("almost
  certainly a relay mislabel"). Not resolved either way here; flagged back
  to whoever is coordinating between sessions rather than silently decided.
  Proceeding on the content's merits regardless of provenance, since B1 was
  well-scoped and followed directly from ADL-010's traces.
- **B1 Part 1 (interface-only):** `determineObjective()` now takes
  `lifecycle: Lifecycle` as a parameter, threaded through `pipeline.ts`.
  Explicitly not consumed in any branching logic. Verified behavior-neutral:
  full regression suite (typecheck, state model sanity tests, insurance
  friction demo) produces identical output before and after.
- **B1 Part 2 (enumeration + invariant check):** full report in
  `docs/B1_INVARIANT_ENUMERATION.md`. Headline result: every trace where
  `lifecycle ≠ active` and the state was already fully satisfied produced a
  **zero-valid-objective** result under the current four-objective set —
  recurred across three independently-reasoned traces, not a one-off. A
  second, mechanically distinct problem also surfaced: statement-phrased
  (not question-phrased) customer messages fail the same way regardless of
  lifecycle, because `pending_customer_question` keys off surface phrasing.
  These are reported as two separate problems, not merged into one fix.
- **Taxonomy tested against real findings, per the ask:** two of three
  categories applied cleanly (input-contract omission fit Problem B well).
  One did not resolve cleanly (Problem A splits ambiguously between
  data-flow gap and responsibility mismatch) and one finding from ADL-010
  doesn't fit any of the three (the lifecycle-vocabulary gap in Trace 5 is
  a coverage problem, not flow/responsibility/input). Reported as-is rather
  than forcing a fit, consistent with the taxonomy being explicitly
  provisional.
- **Status:** Part 1 and 2 both complete. No gating logic proposed or
  implemented, per scope. Awaiting next direction.

---

### 007 — Runtime §7's "`close` is removed" paragraph still lists the old 5-action set

- **Observation (Dev1):** Runtime §7 states: *"Runtime §Step 5's action set
  is `ask | clarify | answer | recommend | acknowledge`"* — five actions,
  including `acknowledge`. But §Step 5 itself (updated in the round that
  closed ADL-001) correctly states four: `clarify | answer | ask | recommend`,
  with an explicit note that `acknowledge` is not a valid action. Same
  document, internal disagreement with itself.
- **Diagnosis:** Same failure pattern as ADL-003 — a fact restated in a
  second location that didn't get updated when the first location changed.
- **Review outcome:** Not yet reviewed by Arch1/Arch2 as of this entry.
- **Status:** Closed. Fixed by Arch1/Arch2, confirmed by direct diff against
  the updated Runtime_Specification.md — §7 now correctly reads
  `clarify | answer | ask | recommend`.

---

### 008 — Completion checking has no mechanism to know which sub-attribute evidence satisfies

- **Observation (Dev1, found during implementation, not document review):**
  State Model §4.1 requires a variable be marked `complete` only when
  "every listed sub-attribute has been satisfied by at least one piece of
  evidence." Runtime §Step 3 calls this evaluation "fully mechanical...
  not left to LLM interpretation." But Call A's output schema (Prompt Spec
  §2.3) tags evidence only with `variable` + `evidence_type` + `statement`
  — never which sub-attribute it addresses. And Call A's input (§2.2's
  `domain_variables`) only supplies `description`, not the
  `completion.required` list, so Call A isn't even given the sub-attribute
  names to tag against. As specified, Step 3 has no data to be mechanical
  *over*.
- **Diagnosis:** Genuine contract gap between State Model §4.1's
  requirement and what Call A's input/output schema actually carries — not
  a hypothesis, reproducible from the schemas as written.
- **Action taken (implementation-level, NOT an accepted spec change):**
  To keep the pipeline runnable, `src/llm/callA.ts` and `src/engine/types.ts`
  extend Call A's input to include `completion.required` per variable, and
  its output with a `satisfies: string[]` field per update. `satisfies` is
  also persisted onto the stored `EvidenceEntry` itself (types.ts), not just
  passed through transiently — `stateModel.ts`'s `applyEvidence` computes
  coverage as the union of `satisfies` across the FULL evidence list each
  time, which is what makes completion accumulate correctly across turns
  (State Model §4.2's own worked example spans turn 1 and turn 4). This is
  a minimal, additive extension — existing fields unchanged. Treat as a
  proposal pending the same review the other six-document changes received,
  not as an accepted addition to Prompt Specification §2 or State Model §1.
- **What would justify accepting it:** if boundary testing (Evaluation
  Protocol §1.1, Call A tests) shows this is the only reasonable way to
  satisfy State Model §4.1's completion guarantee, that's the observed
  evidence the promotion rule asks for.
- **Status:** Accepted — specification updated. Prompt Specification §2.2/
  §2.3 and State Model §1/§4.1/§4.2 now formally define `completion.required`
  input and `satisfies` output, matching this implementation exactly —
  confirmed by direct diff, including the §4.2 worked example now showing
  the same `satisfies` tags this repo's `eval/state/sanity.test.ts` already
  asserted against. No code changes required; this entry stays as permanent
  history per the ADL process, not deleted now that it's resolved.

---

### 016 — Kill switch restart persistence verified; regression/verification timing resolved; DEPLOYMENT.md defense-in-depth section added

- **Kill switch restart persistence — verified, not assumed.** Per
  explicit instruction ("prove it rather than assume it"). 5A scenario 9:
  pauses a conversation via one `ConversationStore` instance, drops it
  entirely (no reference kept), constructs a genuinely separate
  `ConversationStore` instance pointed at the same directory (this is what
  a real process restart actually does — a fresh `new ConversationStore()`
  call in `server.ts`, no shared memory with whatever ran before), and
  confirms both the re-read record shows `automation_paused: true` AND
  `handleInboundMessage` still refuses to process (zero model calls,
  `sendMessage` never invoked). Confirmed `store.ts` has no in-memory cache
  field before writing the test, not after.
- **Regression vs. verification timing — resolved by Arch2, not decided
  here.** Kept separate: verification is cheap/deterministic, appropriate
  every boot including crash-triggered restarts; regression is more
  expensive, belongs once per deploy. Pipeline shape: Developer →
  Regression → Deploy → Server starts → Verification → Serve traffic.
  Updated `eval/regression/README.md`'s "open question" section to record
  the resolution rather than leave it open.
- **`docs/DEPLOYMENT.md` gained an explicit "why four separate mechanisms"
  section**, per the documentation ask — verifier / regression / runtime
  logging / kill switch, what each catches, when each runs, why merging
  verification and regression would couple an unrelated operational event
  (a crash restart) to a check it isn't what triggered.
- **Not started, per explicit deferral:** operational metrics (noted to
  reuse the existing misbehavior-detection signal rather than build a
  separate tracking mechanism when this eventually gets built) and CI
  workflow validation against a real repo.
- **Status:** Both follow-ups from this round closed. Items 5/6 remain the
  only genuinely open work, still on the environment decision.

---

### 017 — Specification reconciliation, Step 1: verification result — STOP, do not proceed to Step 2

- **Context:** Arch2 surfaced that Runtime §Step 4 has stated, since the
  very first `lifecycle`-introducing addendum (verified directly against
  the original uploaded zip from that round — genuinely present that
  early, not a recent addition), that post-recommendation resolution is a
  `lifecycle` transition, not a further runtime objective. Raises the
  question of whether B1's 5 `NoValidObjectiveError` cases are a
  documentation gap rather than a kernel bug. Required verification before
  any implementation: does every case coincide with `lifecycle` having
  moved away from `active`?

| Case | Lifecycle | Coincides with non-`active`? |
|---|---|---|
| Trace 1 | `completed` | Yes |
| Trace 3b | `active` | **No** |
| Trace 5, Day 1 | `paused` | Yes* |
| Trace 5, Day 6 (b) | `active` | **No** |
| Trace 6 | `escalated` | Yes* |

  \* Reading "moves toward completed" as a trajectory through any
  non-`active` state, not the literal value only — flagged as an
  interpretive choice in the original report, not silently assumed.

- **Result: NO — 2 of 5 do not coincide.** Reclassification: **3 genuine
  post-recommendation terminal cases** (Trace 1, Trace 5-Day-1, Trace 6),
  consistent with the Runtime Specification's original intent, **and 2
  cases where these two specific observed zero-objective traces (Trace 3b,
  Trace 5-Day-6(b)) are explained by Problem B** — not "Problem B explains
  the zero-objective phenomenon" generally. The evidence supports the
  narrower claim only; both traces happen to be the same statement-
  phrased-objection pattern already logged as Problem B, and nothing here
  shows that pattern accounts for zero-objective states beyond these two.
  Re-confirmed both classifications on re-examination, not carried over
  uncritically.
- **Per explicit instruction, stopping here — no code touched this
  round.** Not proceeding to Step 2's implementation.
- **Not a fresh discovery, and not a resolution of Problem B either:** a
  fix was already implemented for Problem B (`src/llm/callA.ts`'s
  sharpened instructions) but its effectiveness is unverified, same
  environment constraint as Items 5/6. The reconciliation Arch2 describes
  is independent of Problem B — closing one does not close the other, and
  neither closes B1 alone.
- **Documentation consistency pass, done this round (see entry 018):**
  every other reference to "5 zero-objective cases" without this
  reclassification — `docs/B1_INVARIANT_ENUMERATION.md`,
  `eval/domain/post-recommendation-traces.ts`'s header comment, and this
  document's own entry 012 — checked and updated or annotated.
- **Status:** Awaiting Arch1/Arch2 review of this verification before any
  Step 2 work begins. Problem B's verification remains separately blocked
  on live model access, regardless of how this resolves.

---

### 018 — Documentation consistency pass, entry 017's reclassification

Per Arch2's explicit checklist — done before this goes to Arch1, not
after. Full repo grep for "5 zero-objective," "NoValidObjectiveError,"
"zero-objective," and adjacent phrasing across every `.ts` and `.md` file,
not just the two files already known to reference it.

- **`docs/B1_INVARIANT_ENUMERATION.md`** — top-of-document notice added
  (a reader who doesn't scroll to the addendum wouldn't otherwise know the
  classification changed), addendum's own wording tightened to the exact
  narrower claim Arch2 specified ("these two observed traces are explained
  by Problem B," not "Problem B explains the zero-objective phenomenon").
- **`docs/ADL.md` entry 012** — NOT silently rewritten. The ADL is
  append-only; that entry accurately reflected what was known when it was
  written. Added a clearly-marked `[CORRECTION — see entry 017]` note
  instead, same pattern as every other retroactive fix in this project
  (e.g. entry 008's status line, not its observation text).
- **`eval/domain/post-recommendation-traces.ts`** — same principle: the
  "expected, going in" comment was an honest pre-test hypothesis, left
  intact, with a postscript explaining what's now known and — important —
  that **the code itself hasn't changed**, it still throws on all 5 as of
  this writing, since Step 2 hasn't been implemented.
- **Checked and clean, no changes needed:** `README.md`, `docs/DEPLOYMENT.md`,
  `docs/ARCHITECTURE.md`, `eval/5a-harness/scenarios.ts` — none made a
  specific count claim about this investigation.
- **Status:** Complete. Ready for Arch1 review per Arch2's stated
  condition — documentation confirmed consistent, not just the one flagged
  entry fixed.

---

### 019 — Operator Dashboard, full build

New scope, parallel to B1/B2 — doesn't block or get blocked by that track.
Full architecture in `docs/ARCHITECTURE.md`'s new dashboard section;
this entry covers findings and judgment calls, not a restated file list.

**Governing rule verified structurally, not just followed:** dashboard
never touches files or `ConversationStore` directly. `bin/kill-switch.ts`
was refactored to call `ConversationService` too — one implementation
path for pause/resume, not two. Confirmed via an automated grep-based test
(`eval/dashboard/verification.ts`), not just a code comment.

**Real finding, caught before it caused damage: naive YAML round-tripping
destroys comments.** Verified directly (21 comment lines → 0) before
writing any of the write-path code. These files carry real institutional
context in comments — ADL cross-references, placeholder markers. Fixed by
using the `yaml` package's Document API for surgical, comment-preserving
edits (`js-yaml` stays for the read path elsewhere, unchanged) rather than
accepting the data loss or discovering it later.

**Scope narrowing, not an oversight:** only `business.pricing.ranges` is
editable, not `quoting_rules` — grounded in this project's own established
fact/rule ownership split (ADL, domain/business restructure round).
`quoting_rules` must match one of two fixed condition strings the Engine
literally string-compares against; an operator typo wouldn't error, it
would silently fall through to the verifier's own fail-safe. Same
reasoning as why `completion_requirement`/`variables` are excluded.

**Gap flagged, not silently worked around:** `ConversationSearchQuery`
includes `customerName` per the original scope, but no name field exists
anywhere in `ConversationRecord` — kernel or platform layer. `search()`
throws with a clear explanation rather than silently ignoring the filter
or fabricating a name field nobody asked for. Flagging per the explicit
"flag immediately if anything here seems to need new platform logic"
instruction.

**Honest, non-obvious finding on the concurrent-save lock:** the first
version of this test showed both concurrent saves succeeding — diagnosed
before accepting or hiding it: `ConfigurationService.saveChanges()` uses
only synchronous fs calls end-to-end, so `Promise.all([save(), save()])`
doesn't create genuine interleaving — the first call runs to 100%
completion before the second begins at all. Not a lock bug; an absence of
any real race in the current implementation. Verified the lock PATTERN
itself is sound with an isolated test using a genuine artificial yield
point (the shape a future async change would introduce). Documented
plainly in `DEPLOYMENT.md`: the lock isn't currently load-bearing, but
it's already correct if that changes, and the real trade-off (a save
blocks the event loop for its — currently negligible — duration) is
stated, not hidden.

**Judgment call flagged, not silently decided:** verification warning
messages shown in the dashboard (the required "last verification status"
display) can legitimately mention a kernel-structural field name as part
of explaining what's wrong. That's diagnostic text fulfilling an explicit
requirement, not the structure being exposed for editing — but it's a
real exception to "genuinely absent," worth Arch1/Arch2 knowing about
explicitly rather than assuming the absence rule is airtight in every
sense. Confirmed via direct HTTP response inspection that no kernel-
structural field appears as an actual JSON key anywhere, only within
`metadata.issues[].message`/`.path` strings.

**Auth:** `scrypt` (Node core), not an npm bcrypt/argon2 package —
addendum C's requirement satisfied without repeating this project's one
real native-dependency failure (`better-sqlite3`, see earlier entries).

**Verification, both automated and manual:**
- `npm run dashboard-verify` — 7/7: invalid-edit rejection (backup
  correctly NOT consumed, verified via before/after count comparison
  after catching a real test-isolation bug in my own first version of
  this check), successful-save pipeline, kill-switch parity against the
  real `handleInboundMessage` gate, governing-rule grep, kernel-field
  absence via recursive key scan, lock-pattern correctness, reload-failure
  recovery (option (a) — confirmed in-memory config is NOT swapped on
  failure, file write still succeeds).
- One full-stack manual pass against a real booted server (PID never
  restarted throughout): auth rejects no/wrong credentials and accepts
  correct ones, dashboard HTML actually loads, hot reload confirmed live
  — a config saved via the real HTTP endpoint was reflected by the SAME
  running process on the very next request, version bumped, no restart.
  Not repeated as an automated test — spinning up/tearing down a real
  server per run trades flakiness risk for marginal coverage beyond the
  service-layer tests, which is what the HTTP routes actually call.
- Full existing project regression (state model, domain verification,
  per-domain regression x2, 5A harness) re-run and unaffected — 38 total
  automated assertions passing across the whole project after this round.

**Status:** Complete, all explicit verification requirements met.
Reporting per-component per instruction — this entry covers Configuration
Service, Business Config Editor, Conversation Service, Conversation
Viewer, Kill Switch, Auth, and Deployment together since they landed as
one coherent build rather than genuinely separable stages, with the
per-component detail in `docs/ARCHITECTURE.md` and the findings above.

---

### 020 — Implementation map for Deltas A/B/C (no code changes this round)

Per explicit instruction: map before code, sent back for review before
implementation begins. Full map in `docs/IMPLEMENTATION_MAP_ABC.md`. No
source files changed — every claim in the map was checked against a
throwaway test script first, not asserted from memory, then discarded.

- **Delta A (TurnContext):** verified empirically, not assumed — built a
  test that triggers a real `ConfigurationService` hot-reload mid-turn
  (between Call A and Call B) and confirmed Call B still receives the OLD
  config. The property this delta requires already holds, as an accurate
  byproduct of how `domain` is threaded as a plain parameter rather than
  re-read from the mutable ref mid-turn. `RunTurnParams` is, structurally,
  already what this delta calls `TurnContext`. Gap is that this guarantee
  is implicit, not enforced or tested — proposed work is hardening
  (explicit version field, `Object.freeze()`, a permanent regression test)
  not new construction.
- **Delta B (Automation/Lifecycle):** verified empirically in both
  directions — `pause()`/`resume()` never touch `conversation.lifecycle`;
  `resolveLifecycle()` has no automation-state parameter to read even if
  it wanted to. This was a deliberate choice several rounds ago (checked
  against the Governing Principle at the time when `automation_paused`
  was added), not newly discovered — the structural separation this delta
  asks for already exists. Proposed work is a permanent regression test,
  no source changes.
- **Delta C (ObjectiveResult tri-state):** the one delta with real new
  logic. Design applies Step 1's already-verified 3-vs-2 split (entries
  017/018) directly — `lifecycle !== "active"` at the current fallback
  branch → `no_objective`, `lifecycle === "active"` → `error`. This is
  where `lifecycle` stops being an unconsumed parameter (threaded since
  B1 Part 1, `void`'d ever since) and becomes load-bearing for the first
  time. `NoObjective` designed as a property of the return type, not a
  fifth member of `Objective` — matching the same category-error pattern
  already resolved once for `acknowledge` (ADL-001). Identified that
  `handleInboundMessage.ts`'s reply-null/handoff logic currently treats
  all non-objective cases identically, which becomes wrong post-Delta-C —
  flagged as the place a wrong split would be immediately visible.
- **Overlap analysis (explicitly requested):** three logically independent
  concerns, converging on the same files because A and B turned out to
  already hold (verification + tests, not construction) and C has a real
  design dependency on B already holding. Recommending one coherent
  implementation pass through `pipeline.ts` rather than three separate
  reviews of the same ~40 lines.
- **Status:** Map delivered, awaiting review before any implementation.
  Two specific open decisions flagged for confirmation (type naming for
  both A and C), not assumed unilaterally.

---

### 021 — Deltas A, B, C implemented per authorization

Authorization confirmed both naming decisions (`TurnContext`,
`CallBInput` discriminated union) and two invariants requiring in-code
documentation, not just ADL records. All addressed; verified with real
tests, not asserted.

**Delta A — `TurnContext` (rename only, per authorized scope).**
`RunTurnParams` → `TurnContext` in `pipeline.ts`, comment explains why
(names now match a verified-real property, ADL-020). The additional
hardening (`Object.freeze()`, explicit `domainVersion` field) proposed as
optional in the map was NOT bundled in — the checklist authorized the
rename specifically, not the extras; scope kept to what was confirmed.
**Permanent regression test committed:** `eval/turn-context/race-test.ts`
— the throwaway script from the map round, rewritten with real assertions
(the map's version was print-only) and properly filed under `eval/`
instead of left at the project root, where an earlier draft of it was
found sitting after a mid-round environment reset (see below).

**Delta B — closed exactly as authorized, no source change.** One
asymmetry worth flagging, not silently smoothed over: Delta A's test was
explicitly required to become permanent; Delta B's closure said "no
further action beyond what you already delivered" — but what was
delivered for Delta B in the map was prose describing a discarded
throwaway script, same as Delta A's, not a committed test either. Not
adding one unbidden, since "no further action" was explicit and
definitive — flagging the asymmetry in case it matters, not overriding
the decision.

**Delta C — full implementation, the real work this round.**

| File | Change |
|---|---|
| `src/engine/types.ts` | `ObjectiveOutcome` discriminated union added, both invariants (single ownership, immutability) documented directly on the type per explicit instruction — not just in this entry. `CallBInput` restructured to a discriminated union (`CallBCommonInput & CallBDirective`) mirroring `ObjectiveOutcome`'s shape, including an "error" variant that's structurally unreachable via `runCallB()` today but kept for exhaustiveness coupling — documented as such, not left unexplained |
| `src/engine/objective.ts` | `determineObjective()` returns `ObjectiveOutcome` instead of throwing. `lifecycle` consumed for the first time (`void`'d since B1 Part 1) — the `no_objective`/`error` split at the former throw site uses exactly Step 1's verified evidence (ADL-017): `lifecycle !== "active"` → `no_objective`, `lifecycle === "active"` → `error`. `NoValidObjectiveError` removed entirely |
| `src/engine/pipeline.ts` | `determineObjectiveSafely()` try/catch wrapper removed — redundant once the return type is itself a discriminated union. Call site switches on `outcome.kind`; `error` short-circuits exactly as the old error path did (`reply: null`, `requiresHumanHandoff: true`); `no_objective` and `objective` both proceed to a real Call B call, differing only in whether a directive is included |
| `src/llm/callB.ts` | New `no_objective` branch in the instruction text (respond naturally, no directive, don't invent a task) and in input construction. `CallBParams` changed from `extends CallBInput` (interface can't extend a union) to an intersection type. The unreachable "error" branch throws loudly if ever reached, naming the specific invariant that would have been violated |
| `src/whatsapp/handleInboundMessage.ts` | **Genuinely required zero logic changes** — verified precisely, not assumed: `RunTurnResult`'s two return points already set `requiresHumanHandoff`/`reply: null` exclusively for the "error" case; "no_objective" was already falling through to a real send. Updated only the log signal name (`NO_VALID_OBJECTIVE` → `OBJECTIVE_ERROR`) and comments for accuracy — explicitly flagged as cosmetic, not behavioral, in the code itself |

**The critical proof — does the 3-vs-2 split land exactly as predicted,
not approximately:** `eval/domain/post-recommendation-traces.ts` rewritten
from a print-only demo into a real assertion-based test, one hard check
per trace against its predicted `kind`. All 8 pass: Traces 1, 5-Day-1, 6
→ `no_objective`; Traces 3b, 5-Day-6(b) → `error`; Traces 3a, 4, 5-Day-6(a)
→ `objective`, unaffected. Exact match to ADL-017/018's evidence.

**5A harness updated, not just re-run:** scenario 6 flipped from expecting
`NoValidObjectiveError`/`reply: null` to expecting a real reply with
`outcome: "no_objective"` reaching Call B's actual input (verified by
inspecting `provider.callLog`, not just that some string came back). Added
scenario 6b specifically to keep the "error" path's wiring covered too
(Call B never invoked) — the split needed both halves represented, not
just the flipped one. 10/10 pass.

**Mid-round finding, handled transparently:** a second full container
reset hit partway through this implementation (first one was ADL-020's
round). Nothing was lost — the last delivered zip predates any Delta C
code, so everything was redone from that known-good state, verified
functional before proceeding, same discipline as ADL-020's recovery. One
artifact survived the reset at the project root (`verify-turncontext.ts`,
a print-only draft) and was found, properly rewritten with real
assertions, and relocated to `eval/turn-context/` rather than left as
stray root-level clutter.

**Full regression, 48 total automated assertions across the whole
project, all passing:** state model (14), domain verification (both
packages), per-domain regression (8), 5A harness (10), dashboard
verification (7), post-recommendation traces (8), insurance friction demo,
Delta A's permanent race test (1). Server boot re-verified against the
real pipeline signature change.

**What stayed explicitly untouched, confirmed not drifted:** `Objective`
still exactly four values. No new persisted regime field. No
`ConversationOrchestrator`. `Lifecycle`'s five values and Call A's
lifecycle-proposal instructions unchanged. Problem B's actual fix
(statement-recognition in `callA.ts`) untouched by this work — the `error`
outcome still exists for exactly the 2 cases Problem B causes; fixing
Problem B would shrink that case, not this delta.

**Status:** Delta C complete, verified, ready for review. Problem B's live
verification remains the one item still blocked on environment access.

### 022 — Dev2 handoff, P0 security items 1–3 implemented (dashboard XSS, webhook signature verification, webhook idempotency)

Picked up per HANDOVER_DEV1_TO_DEV2.md §6/§7. First action was verifying,
not assuming: the handover's "Immediate" task (invariant-documentation
comments for `ObjectiveOutcome`) turned out to already be complete in the
delivered zip, matching ADL-021 exactly — the handover snapshot predated
that closure. Confirmed against the actual four file locations before
touching anything, then proceeded straight to the P0 list, in the order
given.

**P0 item 1 — Dashboard stored XSS.**

`src/dashboard/public/index.html` built every dynamic view (conversation
list/detail, config editor, save/diff results) by interpolating values
into template-literal HTML strings assigned to `.innerHTML` — 15 sites,
one of them (`onclick="renderConversationDetail('${r.phone}')"`) a second,
independent injection vector on top of the first, since it let data break
out of both the HTML attribute and the JS string literal at once. Every
one of those values can originate from something other than this
application's own code: `phone` and a tracked variable's `value` come
from the customer, over WhatsApp, with zero sanitization anywhere
upstream (confirmed by reading `routes.ts` — the wire shape passes
`record.variables` straight through); `pricing_ranges`,
`business_knowledge_topics`, `available_options` come from the business
config YAML.

Proved this was real, not theoretical, before fixing it: a throwaway
jsdom script loaded the actual (pre-fix) file, fed a variable `value` of
`<img src=x onerror=...>` through a mocked `/conversations/:phone`
response, and called the real `renderConversationDetail()` — a live
`<img>` element was created in the DOM (1 found). Same script against the
fixed file: 0.

**Fix:** rewrote the script to build the DOM with real `document`
APIs (a small `h()` helper wrapping `createElement`/`setAttribute`,
children appended as text nodes) everywhere a value isn't a fixed
literal, and replaced every inline `onclick="...('${...}')"` with a real
`addEventListener` closure. `innerHTML` remains only where the assigned
string is 100% static markup with zero data interpolation (page shells,
"Loading…", empty-state text) — confirmed by grep, 3 sites left, all
literal. Input/textarea values are set via the `.value` property, not
attribute-string concatenation, which also closes a `</textarea>`
breakout that existed on the business-knowledge-topic and
available-option editors specifically (attribute-context values had
their quotes escaped before; textarea *content* values had no escaping
at all).

**Permanent regression test:** `eval/dashboard/xss-regression.ts` (`npm
run dashboard-xss-verify`). Loads the real `index.html` in jsdom with
`runScripts: "dangerously"` (the actual file, not a reimplementation),
feeds one shared payload string through every identified untrusted field
across all three views, and asserts structurally: zero new
`<script>`/`<img>` elements created, the payload survives as literal
`textContent`/`.value`, and (for the textarea case specifically) the
element count stays correct rather than being corrupted by a breakout.
A fourth check greps the source (excluding comments) for the
`onclick="...${"` pattern directly, so the second injection vector stays
caught even if a future edit avoids the first one. 4/4 pass.

**P0 item 2 — Webhook signature verification.**

`POST /webhook` processed any request body with zero authentication —
anyone who could reach the endpoint could trigger the full pipeline
(Call A, Call B, a state mutation, an outbound WhatsApp message sent as
this business) for any phone number they put in the body.

**Fix:** `server.ts`'s `express.json()` now captures the raw request
bytes via its `verify` hook (required — HMAC must run over the exact
bytes Meta sent; re-serializing the parsed JSON can reorder keys or
change whitespace and break a legitimate signature). New
`verifyWebhookSignature()` in `src/whatsapp/webhook.ts` computes an
HMAC-SHA256 of those raw bytes keyed by `WHATSAPP_APP_SECRET` and compares
against the `X-Hub-Signature-256` header with `crypto.timingSafeEqual`
(constant-time, and explicitly length-checked first since
`timingSafeEqual` throws rather than returning false on a length
mismatch — a malformed header must produce a clean rejection, not an
uncaught exception). Missing `WHATSAPP_APP_SECRET` fails closed (500 on
every request, logged as `WEBHOOK_MISCONFIGURED`), not open.

**Extracted, not left inline:** `POST /webhook`'s logic moved to
`src/whatsapp/webhookRoute.ts` (`validateWebhookRequest` +
`processWebhookBody`), same reasoning `handleInboundMessage.ts`'s own
header comment already gives for that earlier extraction — directly
testable without a real HTTP server. Split into two functions
specifically to preserve the existing "fast 200 ack, reply sent
asynchronously" behavior: validation must complete and be acted on
before any response goes out; the pipeline run after a *valid* request
must not be awaited before that ack, or a slow Call A/B risks Meta's own
delivery timeout and a needless retry. `server.ts`'s route handler is now
a thin wrapper — reads the two things only Express can supply
(raw bytes, the signature header), calls these, translates the result to
a status code.

**P0 item 3 — Webhook delivery idempotency.**

Meta retries a webhook POST that doesn't get a fast, successful-looking
response, so the same `message.id` can arrive more than once with nothing
previously distinguishing a retry from a new message — a retry re-ran the
full pipeline a second time for a customer who only sent one message.
Platform-layer concern, not the kernel's, per the handover's own scoping
(Runtime §1 has no concept of "this exact delivery," only "the customer's
latest message") — confirmed directly against `Runtime_Specification.md`,
which doesn't mention it.

**Fix:** `InboundWhatsAppMessage` gained a required `id` field
(`message.id` from Meta's payload — required, not optional, so every call
site makes an explicit choice rather than silently defaulting past it;
this deliberately surfaced as a compile error at all 3 existing test call
sites, fixed with explicit synthetic IDs, not silently widened away).
New `src/store/webhookIdempotencyStore.ts`: a single pruned JSON file
(not one-file-per-ID — nothing is ever looked up by ID outside this
check, and there's no natural bound on distinct IDs otherwise), 24h
retention (comfortably past Meta's retry window), disk-persisted rather
than in-memory for the same reason `ConversationStore` is — this build's
own history includes two mid-round container resets (ADL-020, ADL-021),
and an in-memory-only store would silently lose its dedup history on
exactly that kind of restart.
`handleInboundMessage()` checks it first, before even the kill switch
read, and logs+returns on a hit (`signal=DUPLICATE_DELIVERY`).

**Combined regression:** `eval/webhook/security-regression.ts` (`npm run
webhook-security-verify`), 17 checks — `verifyWebhookSignature` in
isolation (valid/tampered/wrong-secret/missing-header/malformed-header/
wrong-length-digest, 8 checks), `validateWebhookRequest`'s three
outcomes, `WebhookIdempotencyStore` in isolation including a simulated-
restart persistence check and retention-window pruning (6 checks), and
one true end-to-end check: the same parsed webhook body run through
`processWebhookBody()` twice with a `ScriptedProvider` scripted for
exactly one turn — the second call makes zero further model calls and
`sendMessage` fires exactly once, proving the dedup is actually wired
into the real pipeline path, not just correct as an isolated function.

**Full regression re-run, nothing else broken:** state model (14),
domain verification (both packages), per-domain regression (website-dev +
insurance), 5A harness (10 — including the two kill-switch scenarios
updated for the new required `idempotencyStore` dependency), dashboard
verification (7), new dashboard XSS regression (4), new webhook security
regression (17), turn-context race test (1). `tsc --noEmit` clean across
`src/`, `server.ts`, and `eval/`.

**Docs updated:** `.env.example` and `docs/DEPLOYMENT.md` (new
`WHATSAPP_APP_SECRET` row, explicitly flagged as the one env var that
fails closed rather than just warning, plus a new "Webhook security"
section explaining both mechanisms and pointing at the regression suite).

**What stayed explicitly untouched:** the kernel (`src/engine/`,
`src/domain/`, `src/llm/`) — both fixes are entirely platform-layer, no
`ObjectiveOutcome`/`Lifecycle`/pipeline changes. P0 items 4 and 5
(lifecycle transition table, Problem B live verification) not started —
next in the handover's order.

**Status:** P0 items 1–3 complete, verified, ready for review.

### 023 — P0 item 4: dashboard TLS requirement, documented (not application code, per the finding's own scope)

Confirmed by direct search before writing anything: zero mentions of
TLS/HTTPS anywhere in `docs/*.md` prior to this entry — the finding was
accurate, not stale. `docs/DEPLOYMENT.md`'s "Operator Dashboard" section
previously documented dashboard access as bare `http://<host>:<port>`
with no caveat at all.

Explicitly **not** an application-code fix, per the finding's own framing
(§6 item 4: "a deployment-environment requirement, not application
code") and confirmed by inspection: `requireDashboardAuth`
(`src/dashboard/auth.ts`) has no reliable way to distinguish a direct
plain-HTTP connection from a reverse-proxy-terminated-TLS connection
(the normal topology on Railway/Render/Fly.io) without knowing which
platform this deploys to — and that's the same hosting decision item 9
is already blocked on, still pending from the person directing this
project. Writing a runtime enforcement check now would mean guessing at
that decision rather than waiting for it.

**What was done instead:** `docs/DEPLOYMENT.md` updated in two places —
the "Operator Dashboard" section now states plainly that TLS is required
before any exposure beyond localhost (with the concrete reason: Basic
Auth is base64-encoded, not encrypted, so the operator password is
effectively cleartext on plain HTTP), and the "Deployment procedure"
checklist gained a one-line cross-reference so it isn't only discoverable
by someone already reading the dashboard section specifically.

**Status:** documentation gap closed. The actual enforcement remains
correctly blocked on item 9's pending environment decision, not on
anything further from this end.

### 024 — CI test coverage gap closed; items 10 and 12 ("should-fix") implemented

**CI coverage.** Verified the premise before acting on it, same as every
other claim in this project: this working directory has **no `.git`**
at all (confirmed — `git status` returns "not a git repository"), so
there is no real repo for a commit to land in and no way to trigger or
observe an actual GitHub Actions run from here. The "written but never
run against a real repo" caveat `verify.yml`'s own header already
carried is unchanged by anything in this round — nothing done here makes
that more or less true, and I'm not claiming otherwise.

Separately, and worth flagging on its own regardless of the repo
question: `verify.yml` as it existed wouldn't have picked up the two new
scripts (or any of `regression`, `test:state`, `dashboard-verify`,
pre-existing all along) even in a real repo — its trigger paths are
`domains/**`, `src/verify/**`, `src/domain/**` only, and its one step is
`npm run verify-domains`. That's deliberate scoping for that workflow
specifically ("Layer 1... fastest feedback," per its own header), not a
bug in it — but it meant nothing in CI ran the broader test surface at
all, on any trigger.

**Fix:** new `.github/workflows/test.yml`, broad trigger (any push/PR),
running the full self-contained suite: typecheck, verify-domains,
regression, test:state, dashboard-verify, dashboard-xss-verify,
webhook-security-verify, the 5A harness, and the turn-context race test —
nine steps, every one confirmed self-contained (`ScriptedProvider`/fake
model responses, no live network calls) before being added, and every
one run locally exactly as the workflow invokes it (`npm run <script>`,
checked exit code 0 for each) plus a clean `npm ci` against the current
`package-lock.json` from a fully removed `node_modules` — the actual
command CI runs, not an approximation of it. Two previously-unwired
suites (5A harness, turn-context race test) got their own `npm run`
scripts (`test:5a-harness`, `test:turn-context`) for consistency rather
than being invoked as raw `npx tsx` in the YAML. Items 7–9 (live
LLM/WhatsApp validation) correctly excluded — CI can't do those
regardless of repo status, they need a real deployment environment.

Same disclosure `verify.yml` already models: this is "everything short
of an actual GitHub Actions run" — syntax and logic reviewed, every step
verified locally, not empirically verified against real CI
infrastructure, because that infrastructure isn't reachable from here.

**Item 10 — config preview diff quality, fixed.** `computeDiff()`
previously collapsed `business_knowledge_topics` and `available_options`
into one summary entry per section regardless of what changed (or
whether anything changed at all) — `business_knowledge.topics: "3
topic(s)" -> "3 topic(s)"` even when content changed, or even when
nothing changed, since `collectChanges()` in `index.html` always submits
all three sections on every save. New `diffArrayByIndex()` generalizes
`pricing_ranges`' existing per-key granularity to these two array fields:
one `DiffEntry` per field that actually changed, indexed by position
(matching how the dashboard edits them — `data-idx`, not a stable id),
with explicit `"(not present)"`/`"(removed)"` handling for added/removed
rows. An untouched section now correctly produces zero entries instead
of a false-positive summary. `previewConfigChanges()` in `index.html`
needed no changes — it already just renders whatever `diff` entries come
back.

**Item 12 — option rename blocked, implementing the handover's own
recommendation as given, not a new decision.** New `findOptionRenames()`
compares `available_options` by index; a same-index name change is
reported as `OPTION_RENAME_NOT_ALLOWED` with both the old and new name
named explicitly, rather than left to surface later as the verifier's
generic `RANGE_OPTION_MISMATCH` once the old name's `pricing.ranges` key
is already orphaned — that downstream symptom doesn't make "undo the
rename" obvious as the fix. Enforced in two places, not one:
`previewChanges()` surfaces it immediately (so an operator finds out
before clicking save — restoring the actual point of a preview, same
framing item 10 uses); `saveChanges()` enforces it independently, before
building the write candidate, so a save called directly (bypassing
whatever the frontend's disabled-save-button state happens to be) is
still correctly rejected — same "verify BEFORE backup" reasoning already
governing that function, applied one step earlier. `index.html`'s
`previewConfigChanges()` updated to render `errors` from the preview
response ahead of the diff and keep "Confirm & save" disabled whenever
any are present.

**Item 11 — explicitly not touched.** Needs a decision (add a
`customerName` field to `ConversationRecord`, or drop the dashboard
search feature from v1 scope) that belongs to the person directing this
project, not to either dev role. Flagged, not resolved.

**Regression, all new:** 6 checks added to `eval/dashboard/verification.ts`
(sections 7–8) — field-level diff on a real edit, zero-diff on an
unchanged submission (the actual false-positive this bug produced),
added-row reporting, rename blocked at preview time, rename blocked at
save time with file/backup untouched, and a genuinely new (non-rename)
option confirmed unaffected. Full suite re-run clean: 13/13 dashboard
verification (was 7), 4/4 XSS regression, 17/17 webhook security, 10/10
5A harness, 14/14 state sanity, both domain regressions, typecheck clean.

**Status:** items 10 and 12 complete and verified; CI gap closed to the
extent verifiable without a real repo; item 11 correctly left as an open
decision, not an implementation task.

### 025 — Doc correction: Configuration Service save-pipeline order, three stale copies fixed

Same category as the earlier abandonment-paragraph and stale-acknowledge-
reference corrections — no behavior change, record accuracy only.
Flagged by the person directing this project, confirmed against the
actual code before touching anything: `saveChanges()`'s real order is
`verify → version increment → backup → write`, not `verify → backup →
write → version increment` as documented. The version has to be embedded
in the document content itself (`doc.setIn(["business_package",
"version"], newVersion)` runs on the in-memory candidate), so it can't be
applied after the file is already written — that's the actual reason for
the order, now stated explicitly everywhere the order is described,
not just implied.

Three stale copies found and fixed, not just the one reported — checked
by grep across `*.ts`/`*.md`, not assumed to be a single location:
- `src/services/configurationService.ts`'s header comment — this one was
  internally self-contradictory even before today: the top-line sequence
  listed version increment last (after atomic rename), while the prose
  note below it said "after backup, before write" — neither matched the
  actual code, and they didn't match each other either.
- `docs/DEPLOYMENT.md`'s "Save pipeline" line.
- `docs/ARCHITECTURE.md`'s file-responsibility table row for this file.

No "Configuration Service" living spec exists among the six core kernel
documents or `eval/README.md` (checked — zero mentions in any of them);
this is entirely platform-layer, so these three were the complete set.

Verified no behavior changed: `tsc --noEmit` clean, `dashboard-verify`
still 13/13 (unchanged from entry 024).

**Status:** complete. Freeze discipline on items 5/6 unaffected — nothing
here touches the kernel.

### 026 — Deployment config: Procfile, /health route, render.yaml Blueprint

Requested for Render specifically, but checked against Render's own docs
before building anything (their Heroku-migration guide, fetched directly)
rather than assumed: **Render does not read a Procfile.** It's provided
anyway (`web: npm start`, standard format) since it's harmless, correct
for any platform that does read it, and useful as plain documentation of
the process command — but by itself it does nothing on Render. Flagged
clearly, not left implicit.

**New `/health` route in `server.ts`**, added because it's a genuine
prerequisite for a working Blueprint, not a separate ask: `GET /webhook`
only returns 200 for Meta's real verification handshake (a bare GET with
no `hub.mode`/`hub.verify_token` query params 403s, confirmed by reading
`handleVerification()` directly, then confirmed again empirically — booted
the real server, curled both routes: `/health` → 200, bare `/webhook` →
403). A `render.yaml` with `healthCheckPath: /webhook` would have been
quietly broken from the moment it existed. `/health` is deliberately
unconditional and unauthenticated — its only job is proving the process
is up and past the boot-time domain-verification gate, which registers
before it.

**New `render.yaml` Blueprint** — `type: web`, `runtime: node`,
`buildCommand: npm ci`, `startCommand: npm start`,
`healthCheckPath: /health`, every credential-bearing env var marked
`sync: false` per Render's own explicit instruction not to hardcode
secrets in this file (`NVIDIA_API_KEY`, all four `WHATSAPP_*` vars,
`OPERATOR_PASSWORD_HASH`) — Render prompts for each during Blueprint
creation instead. `PORT` deliberately omitted: Render injects it
automatically, `server.ts` already reads `process.env.PORT`. `plan: free`
by default, specifically so this file can't create unexpected billing on
its own — with an explicit comment that free-tier cold starts (15min
spin-down, 30-60s to wake) are a real latency risk against a live
customer webhook, and upgrading is a cost decision for whoever's
directing the project, not decided here.

**Deliberately excluded: a `disk:` block.** This app writes to three
paths that need to survive a restart — `data/conversations/`,
`data/webhook-seen-messages.json`, `backups/` — flagged as the single
biggest real gap when Render was first discussed. Checked before writing
anything: none of `ConversationStore`, `WebhookIdempotencyStore`, or
`ConfigurationService`'s `backupFile()` call currently read their path
from an environment variable — `server.ts` instantiates all three with
hardcoded defaults. A Render disk mounts at an absolute path separate
from the repo checkout; without wiring these three to read from an env
var pointed at that mount, a `disk:` block would render as valid YAML,
provision a real (billed) resource, and do nothing — which is worse than
omitting it, not better. Left out on purpose, documented in the file
itself, offered as a distinct next step rather than done unprompted as
part of this request.

**Verified:** YAML parses cleanly (`python3 -c "import yaml; ..."`,
structure matches the current Blueprint field reference, fetched fresh
rather than recalled). `/health` confirmed live against a real server
boot, not just read from source. Full regression re-run clean after the
`server.ts` change: typecheck, dashboard verification (13), XSS
regression (4), webhook security (17), 5A harness (10), state sanity (14).

Same disclosure as every other CI/deployment item in this project so
far: not verified against a real Render account or a real deploy — that
needs an actual Render workspace, which isn't available here.

**Status:** complete, as scoped. Freeze on items 5/6 unaffected.
