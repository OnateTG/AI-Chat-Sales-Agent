# Per-Domain Regression Suite

Gates any future package edit before it's publishable (production handoff
requirement). Run before publishing any change to a domain package:

```bash
npm run regression
```

Both domains currently pass, all four required path types each:

| Path type | website-development | insurance |
|---|---|---|
| Happy | multi-turn qualification -> recommendation | same, life insurance |
| Objection | price question -> range_only | coverage cost -> range_only |
| Clarification | contradictory booking info -> clarify | contradictory coverage -> clarify |
| Recommendation | all 4 options reach Call B | all 4 options reach Call B |

## Honest scope boundary

Same as Item 5A: this verifies **wiring and domain content correctness**
(does the right data reach the right place, given this domain's actual
variables and options), not Call B's live judgment. "Recommendation path"
confirms all of a domain's `available_options` actually reach the point
where Call B would choose between them — it does NOT confirm Call B picks
the *correct* one for a given situation, since that needs live model
access this environment doesn't have (see the reachability finding in
`docs/ADL.md`).

**Proven to actually catch regressions, not just pass on known-good
input** — tested against a deliberately broken copy of
`website-development.yaml` (one `available_options` entry removed): the
recommendation-path scenario failed with a precise error, while happy/
objection/clarification correctly kept passing since they didn't depend on
the removed option. A regression suite that's only ever seen passing input
isn't proven to catch anything.

## Adding a scenario, or a third domain

`regressionFramework.ts` is domain-agnostic — `insurance.regression.ts`
was written by copying `website-development.regression.ts`'s scenario
*content* and adapting it to insurance's actual variables, with zero
changes to the framework itself. A third domain package follows the same
pattern: new `<domain>.regression.ts` file, same framework import, four
scenarios (one per required path type), add it to `package.json`'s
`regression` script.

Each scenario is a sequence of turns; each turn scripts what Call A and
Call B would return (via `callAResponse`/`callBResponse` from
`eval/5a-harness/scriptedProvider.ts`) and asserts against the real
`RunTurnResult` — actual `pipeline.ts` execution, not a mock of it.

## Resolved: does not gate the boot-time deployment gate

Kept separate from `server.ts`'s boot-time verification check, deliberately.
Verification is cheap/deterministic and appropriate on every boot,
including crash-triggered restarts unrelated to whether behavior needs
re-checking. Regression is more expensive and belongs once per *deploy*.
See `docs/DEPLOYMENT.md`'s "Why four separate mechanisms" section for the
full reasoning and the pipeline shape this implies.

