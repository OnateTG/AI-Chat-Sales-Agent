# WhatsApp Sales Agent

Implementation of the six-document AI Chat Agent specification (State Model,
Runtime, Prompt, Domain Package, Evaluation Protocol, plus the SOP they
expand on), wired to WhatsApp via Meta's Cloud API, NVIDIA/Ollama for model
serving.

Start with `docs/ARCHITECTURE.md` for the full file map, and `docs/ADL.md`
for every open/closed spec question this build ran into.

## Status

**Built and working:** the kernel (`src/engine/`) — state model, objective
determination, pricing evaluation, lifecycle handling (with its one honest
gap, see below), and the full pipeline orchestration. `npm run test:state`
passes against the State Model Specification's own worked examples.

**Built, not yet live-tested:** Call A / Call B (`src/llm/`) — complete
per Prompt Specification, but untested against a real model since that
needs your NVIDIA API key. WhatsApp webhook/sender (`src/whatsapp/`) —
complete per Meta's Cloud API shape, untested since that needs your Meta
app credentials.

**Blocked on your input:** `domains/website-development.yaml`'s pricing
block is still `<PLACEHOLDER>` — needs real price ranges and confirmation
of the 24hr-build/7-day-decide timeline language.

**Second domain package built and empirically tested:** `domains/insurance.yaml`
— purpose-built to stress-test kernel reusability (ADL-009). Result: mostly
positive (the main hypothesis resolved with zero kernel changes, via a
domain-authoring principle that also fixed a real, already-shipped bug in
the website domain), but surfaced one real kernel-level gap that isn't
fixed yet. Run the evidence yourself:
`npx tsx eval/domain/insurance-friction-demo.ts`

**One known, flagged gap — kernel-level, not yet resolved:** `recommendation
.completion_requirement` doesn't currently do what its name implies — a
variable excluded from it still permanently blocks `produce_recommendation`
if it's not `complete`, no matter how low its importance. Reproduced on a
core-mandatory variable (`readiness`), not just optional extras, so no
domain-authoring workaround fully resolves it. Both domain packages
currently run on a documented, flagged mitigation rather than the original
design intent. Needs Arch1/Arch2 review of Runtime §Step 4.

**Deliberately not built:** `nurture/`, `workflow/` — stubs only, per the
agreed sequencing (kernel proven first). `eval/callA`, `eval/callB`,
`eval/decision`, `eval/conversations` — structure exists, content doesn't;
writing real test cases is its own pass, not a formality to rush.

**Another known, flagged gap (separate issue):** lifecycle transition
validation (`src/engine/lifecycle.ts`) does not actually validate
transitions — the transition table is `[OPEN — ARCHITECTURE REVIEW REQUIRED]`
in Runtime Spec §7 itself. The code accepts Call A's proposed lifecycle
value unvalidated and logs a loud warning every time, rather than either
inventing a table or silently pretending this is handled.

## Setup

```bash
npm install
cp .env.example .env   # fill in NVIDIA_API_KEY and WhatsApp credentials
npm run typecheck
npm run test:state
npm run dev
```

## Docs

- `docs/ARCHITECTURE.md` — file-by-file map to spec sections
- `docs/ADL.md` — Architecture Decision Log, seeded with the full review
  history through this build
