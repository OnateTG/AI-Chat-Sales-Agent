/**
 * Webhook security — regression suite for two P0 production-hardening
 * findings (see docs/ADL.md, HANDOVER §6 items 2 and 3):
 *   1. Signature verification — POST /webhook previously processed any
 *      request body with zero authentication.
 *   2. Delivery idempotency — a retried Meta delivery re-ran the full
 *      pipeline a second time for the same customer message.
 * Run: npx tsx eval/webhook/security-regression.ts
 *
 * Tests validateWebhookRequest/processWebhookBody directly (the functions
 * server.ts's POST /webhook handler is now a thin wrapper around) rather
 * than spinning up a real HTTP server — same reasoning
 * eval/dashboard/verification.ts's header gives for testing
 * ConfigurationService/ConversationService directly instead of the Express
 * routes layer: the extraction exists specifically so this is possible
 * without that cost, and the routes/server.ts layer left behind has no
 * logic of its own beyond reading two things off the request and passing
 * them through (confirmed by inspection, same as routes.ts's governing
 * rule check does for the dashboard).
 */

import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyWebhookSignature } from "../../src/whatsapp/webhook.js";
import { validateWebhookRequest, processWebhookBody } from "../../src/whatsapp/webhookRoute.js";
import { WebhookIdempotencyStore } from "../../src/store/webhookIdempotencyStore.js";
import { ConversationStore } from "../../src/store/store.js";
import { loadDomainPackage } from "../../src/domain/domainLoader.js";
import { ScriptedProvider, callAResponse, callBResponse } from "../5a-harness/scriptedProvider.js";

let passed = 0;
let failed = 0;

async function check(label: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${label}`);
    console.log(`        ${String(e)}`);
    failed++;
  }
}

function sign(body: Buffer, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

console.log("=".repeat(70));
console.log("1. verifyWebhookSignature — the actual cryptographic check");
console.log("=".repeat(70));

await check("correct signature, correct secret -> accepted", () => {
  const secret = "test-app-secret";
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const sig = sign(body, secret);
  if (!verifyWebhookSignature(body, sig, secret)) throw new Error("expected a valid signature to be accepted");
});

await check("tampered body after signing -> rejected", () => {
  const secret = "test-app-secret";
  const original = Buffer.from(JSON.stringify({ amount: 10 }));
  const sig = sign(original, secret);
  const tampered = Buffer.from(JSON.stringify({ amount: 10000 }));
  if (verifyWebhookSignature(tampered, sig, secret)) throw new Error("a body modified after signing must not verify");
});

await check("correct signature, wrong secret -> rejected", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const sig = sign(body, "the-real-secret");
  if (verifyWebhookSignature(body, sig, "a-guessed-secret")) throw new Error("signature computed with a different secret must not verify");
});

await check("missing signature header -> rejected", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  if (verifyWebhookSignature(body, undefined, "any-secret")) throw new Error("no signature header at all must not verify");
});

await check("missing raw body -> rejected (not a crash)", () => {
  if (verifyWebhookSignature(undefined, "sha256=abc123", "any-secret")) throw new Error("undefined rawBody must not verify");
});

await check("malformed header (no 'sha256=' prefix) -> rejected, not thrown", () => {
  const body = Buffer.from("{}");
  if (verifyWebhookSignature(body, "not-a-real-header-format", "secret")) throw new Error("malformed header must not verify");
});

await check("truncated/wrong-length hex digest -> rejected, not thrown (timingSafeEqual length mismatch)", () => {
  const body = Buffer.from("{}");
  // A well-formed prefix but a hex digest that's the wrong length --
  // this is exactly the input that would make a naive
  // crypto.timingSafeEqual call throw instead of returning false.
  if (verifyWebhookSignature(body, "sha256=abcd", "secret")) throw new Error("wrong-length digest must not verify, and must not throw");
});

await check("empty string secret does not silently verify everything", () => {
  const body = Buffer.from(JSON.stringify({ x: 1 }));
  const realSig = sign(body, "real-secret");
  if (verifyWebhookSignature(body, realSig, "")) throw new Error("an empty configured secret must not make an unrelated signature verify");
});

console.log("\n" + "=".repeat(70));
console.log("2. validateWebhookRequest — the phase-1 gate server.ts calls before responding");
console.log("=".repeat(70));

await check("no app secret configured -> fails closed with 500, not silently skipped", () => {
  const body = Buffer.from("{}");
  const result = validateWebhookRequest(body, "sha256=irrelevant", undefined);
  if (result.ok) throw new Error("expected ok:false when WHATSAPP_APP_SECRET is unset");
  if (!result.ok && result.status !== 500) throw new Error(`expected 500, got ${result.ok ? "ok" : result.status}`);
});

await check("configured secret, invalid signature -> 401", () => {
  const body = Buffer.from("{}");
  const result = validateWebhookRequest(body, "sha256=wrong", "real-secret");
  if (result.ok) throw new Error("expected ok:false for an invalid signature");
  if (!result.ok && result.status !== 401) throw new Error(`expected 401, got ${result.ok ? "ok" : result.status}`);
});

await check("configured secret, valid signature -> ok:true", () => {
  const secret = "real-secret";
  const body = Buffer.from(JSON.stringify({ entry: [] }));
  const result = validateWebhookRequest(body, sign(body, secret), secret);
  if (!result.ok) throw new Error("expected ok:true for a genuinely valid signature");
});

console.log("\n" + "=".repeat(70));
console.log("3. Delivery idempotency — WebhookIdempotencyStore in isolation");
console.log("=".repeat(70));

await check("first sighting of an id -> false (not a duplicate), recorded", () => {
  const dir = mkdtempSync(join(tmpdir(), "idempotency-test-"));
  const store = new WebhookIdempotencyStore(join(dir, "seen.json"));
  const isDuplicate = store.checkAndRecord("wamid.abc123");
  if (isDuplicate) throw new Error("first sighting must not be reported as a duplicate");
  rmSync(dir, { recursive: true, force: true });
});

await check("second sighting of the SAME id -> true (duplicate)", () => {
  const dir = mkdtempSync(join(tmpdir(), "idempotency-test-"));
  const store = new WebhookIdempotencyStore(join(dir, "seen.json"));
  store.checkAndRecord("wamid.abc123");
  const isDuplicate = store.checkAndRecord("wamid.abc123");
  if (!isDuplicate) throw new Error("a repeated id must be reported as a duplicate");
  rmSync(dir, { recursive: true, force: true });
});

await check("a DIFFERENT id is never conflated with a previously-seen one", () => {
  const dir = mkdtempSync(join(tmpdir(), "idempotency-test-"));
  const store = new WebhookIdempotencyStore(join(dir, "seen.json"));
  store.checkAndRecord("wamid.first");
  const isDuplicate = store.checkAndRecord("wamid.second");
  if (isDuplicate) throw new Error("a genuinely new id must not be treated as a duplicate of an unrelated prior one");
  rmSync(dir, { recursive: true, force: true });
});

await check("persists across a fresh instance pointed at the same file (survives a process restart)", () => {
  const dir = mkdtempSync(join(tmpdir(), "idempotency-test-"));
  const path = join(dir, "seen.json");
  const before = new WebhookIdempotencyStore(path);
  before.checkAndRecord("wamid.restart-test");
  // Fresh instance, no shared in-memory state -- same "new
  // ConversationStore() on restart" scenario 5A scenario 9 verifies for
  // conversation state, applied to idempotency state.
  const after = new WebhookIdempotencyStore(path);
  const isDuplicate = after.checkAndRecord("wamid.restart-test");
  if (!isDuplicate) throw new Error("idempotency record did not survive a simulated restart -- an in-memory-only store would fail this");
  rmSync(dir, { recursive: true, force: true });
});

await check("retention window: an entry older than the window is pruned and no longer blocks reprocessing", () => {
  const dir = mkdtempSync(join(tmpdir(), "idempotency-test-"));
  const path = join(dir, "seen.json");
  const shortRetentionMs = 50;
  const store = new WebhookIdempotencyStore(path, shortRetentionMs);
  store.checkAndRecord("wamid.will-expire");
  // Not sleeping in the test proper -- busy-wait is fine here, this is a
  // short deterministic delay, not a network-dependent one.
  const start = Date.now();
  while (Date.now() - start < shortRetentionMs + 20) { /* wait out the retention window */ }
  const isDuplicateAfterExpiry = store.checkAndRecord("wamid.will-expire");
  if (isDuplicateAfterExpiry) throw new Error("an entry past the retention window should have been pruned, not still block as a duplicate");
  rmSync(dir, { recursive: true, force: true });
});

console.log("\n" + "=".repeat(70));
console.log("4. Wired end-to-end through processWebhookBody — a retried Meta delivery does not re-run the pipeline");
console.log("=".repeat(70));

await check("same message.id delivered twice -> Call A/B and sendMessage only fire once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "webhook-e2e-"));
  const store = new ConversationStore(join(dir, "conversations"));
  const idempotencyStore = new WebhookIdempotencyStore(join(dir, "seen.json"));
  const domain = loadDomainPackage("domains/insurance.yaml");
  const toneConfig = "Friendly and concise.";

  let sendCount = 0;
  // Scripted with exactly one turn's worth of responses -- if the second
  // delivery actually re-ran the pipeline, the provider would be asked
  // for a second Call A/B and throw on running out of scripted responses.
  const provider = new ScriptedProvider([
    callAResponse({
      updates: [{ variable: "goal", evidence_type: "explicit", statement: "wants auto insurance", satisfies: ["desired_outcome"] }],
    }),
    callBResponse("Got it — auto insurance. Do you have any coverage right now, or starting from scratch?"),
  ]);

  const parsedBody = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { id: "wamid.duplicate-test", from: "15550001111", type: "text", text: { body: "I need auto insurance" }, timestamp: String(Math.floor(Date.now() / 1000)) },
              ],
            },
          },
        ],
      },
    ],
  };

  const deps = {
    store,
    idempotencyStore,
    domain,
    toneConfig,
    sendMessage: async () => {
      sendCount++;
    },
    chatCompletionFn: provider.fn,
  };

  await processWebhookBody(parsedBody, deps);
  await processWebhookBody(parsedBody, deps); // the "retry" -- identical body, identical message.id

  if (sendCount !== 1) throw new Error(`expected exactly 1 outbound send across both deliveries, got ${sendCount}`);
  provider.assertFullyConsumed(); // proves the SECOND delivery asked the provider for nothing further

  rmSync(dir, { recursive: true, force: true });
});

console.log("\n" + "=".repeat(70));
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
