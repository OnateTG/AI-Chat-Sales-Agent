# Deployment & Operations

Per production handoff's Operations checklist. Covers logging, error
reporting, misbehavior detection, the kill switch, backup, environment
variables, and deployment procedure — in that order, since each builds on
the one before it.

## Why four separate mechanisms, not one

Four things catch problems in this system, at four different times, for
four different kinds of problem. Worth stating this directly rather than
leaving it implicit across ADL entries — it's the answer to "why didn't
you just build one check" if that question ever comes up.

| Mechanism | Catches | Runs | Cost |
|---|---|---|---|
| **Verifier** (`verify-domains`) | Structural/config issues — a business package that can't function correctly (bad references, invalid pricing conditions, impossible completion requirements) | Every boot | Cheap, deterministic |
| **Regression suite** (`npm run regression`) | Behavioral issues — a package edit that's structurally valid but breaks a real conversation path | Every deploy | More expensive, not appropriate every boot |
| **Runtime logging** (structured `signal` fields) | Production issues that only show up under real traffic — `NoValidObjectiveError`, repeated objectives, stuck conversations | Always-on, in production | Ongoing, passive |
| **Kill switch** (`bin/kill-switch.ts`) | Operational issues a human needs to intervene on — nothing systematic will catch these, by design, since the reason can be anything | On-demand, operator-triggered | Manual |

The reason verification and regression are two separate gates, not one,
rather than merged: verification is cheap and appropriate on *every*
boot — including restarts triggered by a crash or routine ops, unrelated
to whether behavior needs re-checking. Regression is more expensive and
belongs once per *deploy*, not once per boot. Merging them would mean
every crash-triggered restart re-runs full behavioral regression, coupling
an unrelated operational event to a check that isn't what triggered it.

Correct pipeline shape:

```
Developer → Regression → Deploy → Server starts → Verification → Serve traffic
```

Regression gates the deploy step. Verification gates the boot step. They
stay separate on purpose.

## Environment variables

See `.env.example` for the full list with defaults. What each one actually
does if missing (checked at boot — see "Deployment procedure" below):

| Variable | Required for | If missing |
|---|---|---|
| `NVIDIA_API_KEY` | Model calls (Call A/B) | Falls back to Ollama at `OLLAMA_BASE_URL` — needs `ollama serve` running |
| `WHATSAPP_ACCESS_TOKEN` | Sending replies | Outbound sends fail at runtime, not at boot |
| `WHATSAPP_PHONE_NUMBER_ID` | Sending replies | Same as above |
| `WHATSAPP_VERIFY_TOKEN` | Webhook registration | Meta's verification handshake fails |
| `WHATSAPP_APP_SECRET` | Webhook signature verification | **Fails closed**: every inbound `/webhook` POST is rejected (500, logged as `WEBHOOK_MISCONFIGURED`) until this is set — see "Webhook security" below |
| `PORT` | Server binding | Defaults to 3000 |

All checks except `WHATSAPP_APP_SECRET` are warnings, not hard boot
failures — booting without WhatsApp/model credentials is legitimate for
local testing (it's how the 5A harness runs). `WHATSAPP_APP_SECRET` is
the one exception: it's still only a *warning* at boot (consistent with
everything else here — a missing credential shouldn't block the process
from starting), but the webhook route itself refuses to process any
request without it, per-request, every time, rather than degrading to
"accept unauthenticated traffic." See below.

## Webhook security

Two independent protections on `POST /webhook`, both added as P0
production-hardening findings (see `docs/ADL.md`):

**Signature verification.** Meta signs every webhook delivery with an
HMAC-SHA256 of the raw request body, keyed by the app secret, sent as the
`X-Hub-Signature-256` header. `server.ts` captures the raw bytes via
`express.json()`'s `verify` hook (before JSON parsing — re-serialized JSON
can have different whitespace/key order and would break a legitimate
signature) and `src/whatsapp/webhook.ts`'s `verifyWebhookSignature()`
checks it with a constant-time comparison before any other webhook
processing happens. A missing or invalid signature gets a 401 and nothing
downstream runs. A missing `WHATSAPP_APP_SECRET` gets a 500 for every
request — fails closed, not open — logged as `WEBHOOK_MISCONFIGURED`.

**Delivery idempotency.** Meta retries a webhook POST that didn't get a
fast, successful-looking response, so the same `message.id` can arrive
more than once. `src/store/webhookIdempotencyStore.ts` persists a
24-hour window of seen message IDs to `data/webhook-seen-messages.json`
(disk-backed, not in-memory, so it survives a process restart) and
`handleInboundMessage()` checks it before doing anything else. A repeat
delivery is logged as `DUPLICATE_DELIVERY` and skipped — no second Call
A/B, no second state mutation, no second outbound reply.

Regression coverage: `npx tsx eval/webhook/security-regression.ts`.


## Logging

Every module logs through `pino` (structured JSON), named per-module
(`server`, `pipeline`, `lifecycle`, `inbound-handler`, etc.) so log lines
are filterable by component. This is the foundation everything below is
built on — there's no separate metrics/alerting system wired up (nothing
in this project's network allowlist reaches one; see the environment
reachability finding in `docs/ADL.md`), so "monitored signal" currently
means "structured, greppable log line," not "paged someone." Documented
here so that's an explicit, known scope boundary, not an assumed one.

## Error reporting & monitored signals

Three specific, structured signals to watch for, all logged with a
`signal` field for easy filtering (`grep '"signal":"X"'` or the equivalent
in whatever log aggregator eventually sits in front of this):

| Signal | Meaning | Where it's logged |
|---|---|---|
| `NO_VALID_OBJECTIVE` | The B1 gate's open fallback question was hit — no automated reply sent | `handleInboundMessage.ts`, error level |
| `REPEATED_OBJECTIVE` | Same (objective, target) fired 3+ times in a row — conversation may be stuck | `handleInboundMessage.ts`, warn level |
| `AUTOMATION_PAUSED` | Kill switch is active — message received, not processed | `handleInboundMessage.ts`, warn level |

**`REPEATED_OBJECTIVE` deliberately does not auto-trigger the kill
switch.** Detection and logging only — auto-pausing on this signal would
be a real behavioral decision nobody explicitly asked for. A human reviews
and decides.

## Kill switch

Two interfaces, one implementation path — `bin/kill-switch.ts` (CLI) and
the operator dashboard's per-conversation pause/resume buttons both call
`ConversationService.pause()`/`.resume()` directly. Neither duplicates the
other's logic.

```bash
npx tsx bin/kill-switch.ts pause  <phone> "<reason>" [operator-name]
npx tsx bin/kill-switch.ts resume <phone>
npx tsx bin/kill-switch.ts status <phone>
```

Checked at the very start of `handleInboundMessage.ts`, before any model
call, so a paused conversation doesn't burn a Call A/B invocation just to
be told not to reply.

Deliberately NOT the same thing as `conversation.lifecycle === "escalated"`
— that's customer-initiated (Call A proposes it from what the customer
said); this is operator-initiated and works regardless of what lifecycle
currently is.

## Operator Dashboard

Single-business, single-shared-password, same server/process as the bot —
not multi-tenant, no accounts, no database, no roles, per its explicit
scope. Full architecture: `docs/ARCHITECTURE.md`'s dashboard section.

**Setup:**
```bash
npx tsx bin/hash-password.ts "your-chosen-password"
# paste the OPERATOR_PASSWORD_HASH line into .env
```

**Access:** `http://<host>:<port>/dashboard/` in local development — browser's
native HTTP Basic Auth prompt, username ignored, only the password checked.

**Before this is exposed anywhere beyond localhost, it MUST sit behind
TLS.** (P0 finding, see `docs/ADL.md`.) HTTP Basic Auth credentials are
base64-*encoded*, not encrypted — trivially reversible by anyone who can
observe the raw request (a shared network, a plain-HTTP reverse proxy, a
logging intermediary). Over plain HTTP, the operator password is
effectively sent in cleartext on every single dashboard request. This is
a deployment-environment requirement, not something the application code
itself can guarantee: `requireDashboardAuth` (`src/dashboard/auth.ts`)
has no way to distinguish "the client connected to me over HTTPS" from
"a reverse proxy terminated TLS upstream and forwarded plain HTTP" (the
normal, correct topology on Railway/Render/Fly.io and similar platforms)
without knowing which of those this actually is — and that's the same
still-open hosting decision item 9 above is blocked on. Concretely:
whichever platform is chosen, confirm its default-provided TLS is active
on the domain serving `/dashboard` before the `OPERATOR_PASSWORD_HASH` is
ever set to a real password and used over a real network — not just that
the platform *supports* TLS, that it's actually terminating it on the
URL operators will use.

**Governing rule, enforced structurally, not just by convention:** the
dashboard never touches a file or `ConversationStore` directly — every
operation goes through `ConfigurationService` or `ConversationService`.
Checked by an automated test (`npm run dashboard-verify`) that greps the
dashboard's own source for violations, not just asserted in code comments.

**What's editable:** `business.pricing.ranges` (not `quoting_rules` —
narrowed deliberately from the original "business.pricing" scope, since
`quoting_rules` is Engine-evaluated and must match one of two fixed
condition strings; an operator typo there wouldn't error, it would
silently misbehave, per the verifier's `UNKNOWN_QUOTING_CONDITION` check),
`business_knowledge` topics, and `domain.recommendation.available_options`.
Everything else — `domain.variables`, `completion_requirement`, and
`fits_when`'s role as a matching mechanism — is kernel-structural and
genuinely absent from what the API returns, not just hidden by the UI.

**One flagged judgment call, not silently decided:** verification warning
messages (shown in the dashboard's status strip) can legitimately mention
a kernel-structural field NAME as part of explaining what's wrong (e.g. "
variable `goal` has 2 required sub-attributes...") — that's diagnostic
text fulfilling the explicit "last verification status" display
requirement, not the structure itself being exposed for viewing or
editing. Worth knowing this distinction exists rather than assuming the
absence rule is airtight in every sense.

**Save pipeline:** load → modify → verify → version increment → backup →
atomic write (temp file → fsync → rename) → hot reload → result. Verify
runs before backup deliberately — a rejected edit consumes no backup.
Version increment runs before backup and before the write, not after
either — the bumped version has to be embedded in the document content
itself, so it can't be applied once the file is already written.
Comment-preserving: uses the `yaml` package's Document API for surgical
edits, not a naive parse-modify-dump cycle — confirmed directly that the
naive approach silently drops every comment in these files (21 → 0,
checked before writing any of the write-path code) before choosing this.

**Reload-failure recovery:** if verify/backup/write all succeed but
re-reading the just-written file fails, the in-memory configuration is
NOT swapped — the process keeps serving the previous, already-verified
config, with the failure reported clearly. The file write did succeed in
this case; only the in-memory swap was withheld, so a subsequent real
restart would pick up the new version normally.

**Concurrent saves:** a simple lock, checked and set synchronously before
any `await`, rejects a second save while one is in flight. Worth knowing
honestly: `ConfigurationService.saveChanges()` currently uses only
synchronous filesystem calls end-to-end, which means genuine interleaving
between two calls can't actually happen yet within one process — Node's
single-threaded execution already serializes them, as a side effect of
the whole operation blocking the event loop for its (very short, small-
file) duration. The lock pattern itself is verified correct against a
genuine artificial yield point (see `eval/dashboard/verification.ts`), so
it's already correct if the implementation ever moves to async I/O — not
dead code, just not currently load-bearing.

## Backup

The store is JSON files under `data/conversations/` (one per phone
number) — genuinely simple to back up.

```bash
npx tsx bin/backup.ts                          # data/conversations -> backups/<timestamp>/
npx tsx bin/backup.ts <source-dir> <dest-root>  # custom paths
```

**Restore:** copy the desired timestamped folder's contents back into
`data/conversations/`. There's no merge logic — restoring overwrites
whatever's currently there for any phone number present in the backup.

**Not built:** remote/cloud backup (S3 or equivalent) and scheduling
(cron). Both are real deployment-environment decisions — which bucket,
which credentials, which schedule — that depend on where this actually
runs, not something to guess at from here. Wire `bin/backup.ts`'s output
directory to whatever remote sync tool the deployment environment
provides once that's decided.

## Deployment procedure

```bash
git clone <repo> && cd whatsapp-sales-agent
npm install
cp .env.example .env   # fill in real values
npm run verify-domains  # confirm business packages pass before going further
npm start               # prestart re-runs verify-domains automatically;
                         # server.ts itself also re-checks at boot and
                         # refuses to serve traffic on a failing package —
                         # see docs/ARCHITECTURE.md and ADL-013/014 for why
                         # this is three layers, not one
```

Health check: `GET /webhook` (Meta's own verification endpoint) responding
200 confirms the process is up and the domain package passed verification
— if it hadn't, the process would have exited before ever binding to
`PORT`.

**Before exposing `/dashboard` beyond localhost:** confirm TLS is
actually terminating on the URL operators will use — see "Operator
Dashboard" above for why this is a hard requirement, not a nice-to-have,
and why the exact mechanism depends on the hosting platform chosen.

**Rollback:** revert to the previous `domains/*.yaml` (or previous
`business_package.version`) and restart. Since verification runs before
`app.listen()`, a bad rollback target is caught the same way a bad forward
deploy is — the process simply won't come up.

## Regression suite — where it actually lives

Covered conceptually above (it's the second row of the table, and the
first step of the pipeline shape). Detail — the four required path types,
how to add a scenario, the proof that it actually catches breakage rather
than just passing on known-good input — lives in
`eval/regression/README.md`, not duplicated here.
