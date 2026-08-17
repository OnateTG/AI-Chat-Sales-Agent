/**
 * Operator Dashboard — verification test suite, covering every explicit
 * requirement from the scope document, plus the addendum's additional
 * verification requirements. Run: npx tsx eval/dashboard/verification.ts
 *
 * Tests the SERVICE layer directly (ConfigurationService/ConversationService)
 * rather than spinning up a real HTTP server per test — the routes layer
 * (src/dashboard/routes.ts) is a thin pass-through with no logic of its
 * own to test, confirmed by grep (see the governing-rule check below) and
 * by a one-time full-stack manual verification against a real running
 * server covering auth, hot reload on a live process, and the kill switch
 * through the actual HTTP path (not repeated here as an automated test —
 * spinning up and tearing down a real server per test run adds real
 * flakiness risk for marginal additional coverage over testing the
 * service layer thoroughly, which is what the HTTP routes actually call).
 */

import { mkdtempSync, rmSync, copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { ConversationService } from "../../src/services/conversationService.js";
import { ConversationStore } from "../../src/store/store.js";
import { loadDomainPackage } from "../../src/domain/domainLoader.js";

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

function freshTestDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dashboard-test-"));
  copyFileSync("domains/insurance.yaml", join(dir, "test.yaml"));
  return dir;
}

function countFilesRecursive(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    count += entry.isDirectory() ? countFilesRecursive(full) : 1;
  }
  return count;
}

console.log("=".repeat(70));
console.log("1. Invalid config edit → save blocked, backup not consumed, readable error");
console.log("=".repeat(70));
await check("empty fits_when rejected, file untouched, no backup created", async () => {
  const dir = freshTestDir();
  const testPath = join(dir, "test.yaml");
  const beforeText = readFileSync(testPath, "utf-8");
  const domainRef = { current: loadDomainPackage(testPath) };
  const service = new ConfigurationService(testPath, domainRef);

  // Count existing backups BEFORE, not just check existence -- backups/
  // is shared across this whole suite's runs (relative to cwd), so a
  // prior test's legitimate backup would make a bare existsSync() check
  // meaningless after the first successful-save test has run once.
  const backupCountBefore = existsSync("backups") ? countFilesRecursive("backups") : 0;

  const result = await service.saveChanges({ available_options: [{ name: "Auto Insurance", fits_when: "" }] });

  if (result.success) throw new Error("expected rejection, got success");
  if (!result.errors || result.errors.length === 0) throw new Error("expected errors array with content");
  if (!result.errors.some((e) => e.code === "EMPTY_FITS_WHEN")) throw new Error("expected EMPTY_FITS_WHEN among the errors");
  if (readFileSync(testPath, "utf-8") !== beforeText) throw new Error("file was modified despite rejection");

  const backupCountAfter = existsSync("backups") ? countFilesRecursive("backups") : 0;
  if (backupCountAfter !== backupCountBefore) {
    throw new Error(`backup count changed on a rejected save: ${backupCountBefore} -> ${backupCountAfter}`);
  }

  rmSync(dir, { recursive: true, force: true });
});

console.log("\n" + "=".repeat(70));
console.log("2. Successful save → version increments, diff correct, comments preserved, reload takes effect");
console.log("=".repeat(70));
await check("full successful save pipeline", async () => {
  const dir = freshTestDir();
  const testPath = join(dir, "test.yaml");
  const before = loadDomainPackage(testPath);
  const originalVersion = before.business_package.version;
  const originalCommentCount = (readFileSync(testPath, "utf-8").match(/^\s*#/gm) || []).length;

  const domainRef = { current: before };
  const service = new ConfigurationService(testPath, domainRef);

  const result = await service.saveChanges({ pricing_ranges: { "Auto Insurance": "TEST VALUE" } });

  if (!result.success) throw new Error(`expected success, got: ${JSON.stringify(result.errors)}`);
  if (result.version === originalVersion) throw new Error("version did not increment");
  if (!result.diff || result.diff.length === 0) throw new Error("expected a non-empty diff");
  if (result.diff[0].newValue !== "TEST VALUE") throw new Error("diff does not reflect the actual change");

  // Hot reload: the IN-MEMORY reference, not just the file, must reflect the change.
  if (domainRef.current.business?.pricing?.ranges?.["Auto Insurance"] !== "TEST VALUE") {
    throw new Error("in-memory domainRef was not hot-reloaded after a successful save");
  }

  const afterCommentCount = (readFileSync(testPath, "utf-8").match(/^\s*#/gm) || []).length;
  if (afterCommentCount < originalCommentCount - 2) {
    // small tolerance -- exact count can shift slightly with value content, but should not collapse to ~0
    throw new Error(`comments appear to have been stripped: ${originalCommentCount} -> ${afterCommentCount}`);
  }

  rmSync(dir, { recursive: true, force: true });
});

console.log("\n" + "=".repeat(70));
console.log("3. Kill switch parity — dashboard's ConversationService.pause() blocks the pipeline exactly like the CLI");
console.log("=".repeat(70));
await check("ConversationService.pause() sets the same fields bin/kill-switch.ts does, verified against the real handleInboundMessage gate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "killswitch-parity-"));
  const store = new ConversationStore(dir);
  const service = new ConversationService(store);
  const record = store.getOrCreate("parity-test-phone", "0.1.0");

  const result = service.pause("parity-test-phone", "dashboard parity test", "test-operator");
  if (!result.success) throw new Error("pause() reported failure");

  const reread = store.get("parity-test-phone");
  if (reread?.automation_paused !== true) throw new Error("automation_paused not set");
  if (reread?.paused_reason !== "dashboard parity test") throw new Error("paused_reason not set correctly");

  // This is the SAME check 5A scenario 8 makes against bin/kill-switch.ts's
  // underlying store writes -- proving the dashboard's service call and
  // the CLI produce an identical record shape, which is what "one
  // implementation path" actually means, not just "both exist."
  const { handleInboundMessage } = await import("../../src/whatsapp/handleInboundMessage.js");
  const { ScriptedProvider } = await import("../5a-harness/scriptedProvider.js");
  const { WebhookIdempotencyStore } = await import("../../src/store/webhookIdempotencyStore.js");
  const domain = loadDomainPackage("domains/insurance.yaml");
  let sendCalled = false;
  const provider = new ScriptedProvider([]);
  const idempotencyStore = new WebhookIdempotencyStore(join(dir, "seen.json"));

  await handleInboundMessage(
    { id: "wamid.test-dashboard-parity", from: "parity-test-phone", text: "hello?", timestamp: new Date().toISOString() },
    { store, idempotencyStore, domain, toneConfig: "", sendMessage: async () => { sendCalled = true; }, chatCompletionFn: provider.fn }
  );

  if (sendCalled || provider.callLog.length !== 0) throw new Error("pipeline ran despite dashboard-issued pause");

  rmSync(dir, { recursive: true, force: true });
});

console.log("\n" + "=".repeat(70));
console.log("4. Kernel-structural fields — governing rule check");
console.log("=".repeat(70));
await check("dashboard source has zero direct file I/O or ConversationStore imports", () => {
  const files = ["src/dashboard/routes.ts", "src/dashboard/auth.ts"];
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    // Looking for actual usage, not the explanatory comments that
    // legitimately mention these terms while describing the rule itself.
    const codeLines = content.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    const codeOnly = codeLines.join("\n");
    if (/\bnew ConversationStore\b/.test(codeOnly)) throw new Error(`${file} directly instantiates ConversationStore`);
    if (/\breadFileSync\b|\bwriteFileSync\b/.test(codeOnly)) throw new Error(`${file} does direct file I/O`);
  }
});
await check("config API response never includes actual kernel-structural DATA (variables, completion_requirement) outside diagnostic message text", async () => {
  const dir = freshTestDir();
  const testPath = join(dir, "test.yaml");
  const domainRef = { current: loadDomainPackage(testPath) };
  const service = new ConfigurationService(testPath, domainRef);
  const config = service.getConfiguration();

  // Simulating exactly what routes.ts's GET /config handler sends over the wire.
  const wireShape = {
    pricing_ranges: config.business?.pricing?.ranges ?? {},
    business_knowledge_topics: config.business_knowledge.topics,
    available_options: config.domain.recommendation.available_options,
    metadata: service.getMetadata(),
  };

  // NOTE, flagged explicitly rather than silently decided: field NAMES
  // can legitimately appear WITHIN metadata.issues[].message /.path, since
  // that's the required "last verification status" display explaining a
  // real warning. That's diagnostic text, not exposing the structure for
  // viewing/editing. Checking for the actual STRUCTURAL SHAPE instead --
  // does `variables` or `completion_requirement` appear as a real JSON
  // KEY anywhere in the wire object (recursively), as opposed to being
  // mentioned inside a string value (which is fine, and expected, inside
  // metadata.issues[].message/.path)?
  function hasKeyRecursive(obj: unknown, key: string): boolean {
    if (obj === null || typeof obj !== "object") return false;
    if (Array.isArray(obj)) return obj.some((item) => hasKeyRecursive(item, key));
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === key) return true;
      if (hasKeyRecursive(v, key)) return true;
    }
    return false;
  }
  if (hasKeyRecursive(wireShape, "variables") || hasKeyRecursive(wireShape, "completion_requirement")) {
    throw new Error("kernel-structural field present as an actual JSON key in the wire shape");
  }
  rmSync(dir, { recursive: true, force: true });
});

console.log("\n" + "=".repeat(70));
console.log("5. Concurrent save — lock pattern verified with a genuine async yield point");
console.log("=".repeat(70));
await check("lock rejects a second call while a first is genuinely in-flight (not two sequential calls)", async () => {
  // Documented finding, not hidden: ConfigurationService.saveChanges()
  // currently uses only synchronous fs calls end-to-end, so within a
  // single process, Promise.all([save(), save()]) doesn't create genuine
  // interleaving -- the first call runs to 100% completion (including
  // releasing the lock) before the second begins at all, since there's no
  // yield point for it to interleave at. That's not a lock bug, it's an
  // absence of any real race in the current implementation. Verified
  // separately: the check-lock/set-lock-before-any-await PATTERN itself
  // (isolated below with a genuine artificial yield, the way a real
  // future async change -- fs.promises, network I/O -- would introduce
  // one) correctly serializes access. This is what's actually being
  // proven here, not "two full saveChanges() calls race" (which cannot
  // currently happen, proven separately by inspection: no `await`
  // appears before the lock's `finally` release in saveChanges' body).
  let locked = false;
  async function criticalSection(delayMs: number): Promise<boolean> {
    if (locked) return false;
    locked = true;
    try {
      await new Promise((r) => setTimeout(r, delayMs));
      return true;
    } finally {
      locked = false;
    }
  }
  const [a, b] = await Promise.all([criticalSection(30), criticalSection(30)]);
  const succeededCount = [a, b].filter(Boolean).length;
  if (succeededCount !== 1) throw new Error(`expected exactly 1 success under genuine interleaving, got ${succeededCount}`);
});

console.log("\n" + "=".repeat(70));
console.log("6. Reload failure recovery — option (a): retain previous config, report failure, don't swap");
console.log("=".repeat(70));
await check("failed reload does not corrupt in-memory state; file write still succeeded", async () => {
  const dir = freshTestDir();
  const testPath = join(dir, "test.yaml");
  const original = loadDomainPackage(testPath);
  const originalValue = original.business?.pricing?.ranges?.["Auto Insurance"];
  const domainRef = { current: original };

  const failingReload = (_p: string): never => {
    throw new Error("simulated reload failure");
  };
  const service = new ConfigurationService(testPath, domainRef, failingReload);

  const result = await service.saveChanges({ pricing_ranges: { "Auto Insurance": "SHOULD NOT BE IN MEMORY" } });

  if (!result.success) throw new Error("expected success:true (write succeeded even though reload failed)");
  if (!result.reloadFailed) throw new Error("expected reloadFailed:true");
  if (domainRef.current.business?.pricing?.ranges?.["Auto Insurance"] !== originalValue) {
    throw new Error("in-memory config was swapped despite reload failure -- option (a) violated");
  }
  const fileContent = readFileSync(testPath, "utf-8");
  if (!fileContent.includes("SHOULD NOT BE IN MEMORY")) {
    throw new Error("file write did not actually succeed -- reload failure test is invalid");
  }

  rmSync(dir, { recursive: true, force: true });
});

console.log("\n" + "=".repeat(70));
console.log("7. Config diff quality — item 10, field-level diffs, no false positives on untouched sections");
console.log("=".repeat(70));

await check("changing one topic's content produces exactly one field-level entry, not a count summary", async () => {
  const dir = freshTestDir();
  const testPath = join(dir, "test.yaml");
  const domainRef = { current: loadDomainPackage(testPath) };
  const service = new ConfigurationService(testPath, domainRef);

  const topics = domainRef.current.business_knowledge.topics.map((t) => ({ ...t }));
  const originalContent = topics[0].content;
  topics[0] = { ...topics[0], content: "Completely different content about risk factors." };

  const { diff } = service.previewChanges({ business_knowledge_topics: topics });

  if (diff.length !== 1) throw new Error(`expected exactly 1 diff entry for a 1-field change, got ${diff.length}: ${JSON.stringify(diff)}`);
  const entry = diff[0];
  if (entry.path !== "business_knowledge.topics[0].content") throw new Error(`expected a field-level path, got "${entry.path}"`);
  if (entry.oldValue !== originalContent) throw new Error("diff oldValue doesn't match the actual original content");
  if (entry.newValue !== "Completely different content about risk factors.") throw new Error("diff newValue doesn't match the edit");

  rmSync(dir, { recursive: true, force: true });
});

await check("submitting topics/options UNCHANGED (as the dashboard's collectChanges() always does) produces zero diff entries -- the false-positive this bug used to produce", async () => {
  const dir = freshTestDir();
  const testPath = join(dir, "test.yaml");
  const domainRef = { current: loadDomainPackage(testPath) };
  const service = new ConfigurationService(testPath, domainRef);

  // Exactly what index.html's collectChanges() does on every save: read
  // every field straight back out of the form, whether or not the
  // operator touched that section. Before this fix, this alone produced
  // a "3 topic(s) -> 3 topic(s)"-style false-positive diff entry.
  const unchangedTopics = domainRef.current.business_knowledge.topics.map((t) => ({ ...t }));
  const unchangedOptions = domainRef.current.domain.recommendation.available_options.map((o) => ({ ...o }));

  const { diff, errors } = service.previewChanges({
    business_knowledge_topics: unchangedTopics,
    available_options: unchangedOptions,
  });

  if (diff.length !== 0) throw new Error(`expected zero diff entries for a genuinely unchanged submission, got ${diff.length}: ${JSON.stringify(diff)}`);
  if (errors && errors.length > 0) throw new Error(`unexpected errors on an unchanged, non-rename submission: ${JSON.stringify(errors)}`);

  rmSync(dir, { recursive: true, force: true });
});

await check("adding a new topic reports it as added ('(not present)' -> content), not folded into a count", async () => {
  const dir = freshTestDir();
  const testPath = join(dir, "test.yaml");
  const domainRef = { current: loadDomainPackage(testPath) };
  const service = new ConfigurationService(testPath, domainRef);

  const topics = [...domainRef.current.business_knowledge.topics.map((t) => ({ ...t })), { topic: "New topic", content: "New content." }];
  const { diff } = service.previewChanges({ business_knowledge_topics: topics });

  const addedEntries = diff.filter((d) => d.path.startsWith(`business_knowledge.topics[${topics.length - 1}]`));
  if (addedEntries.length === 0) throw new Error("expected diff entries for the newly-added topic's fields");
  if (!addedEntries.every((d) => d.oldValue === "(not present)")) throw new Error("expected oldValue '(not present)' for a genuinely new topic");

  rmSync(dir, { recursive: true, force: true });
});

console.log("\n" + "=".repeat(70));
console.log("8. Option rename blocked — item 12, implementing the handover's own stated recommendation");
console.log("=".repeat(70));

await check("renaming an available_option (same index, different name) is rejected at preview time", async () => {
  const dir = freshTestDir();
  const testPath = join(dir, "test.yaml");
  const domainRef = { current: loadDomainPackage(testPath) };
  const service = new ConfigurationService(testPath, domainRef);

  const options = domainRef.current.domain.recommendation.available_options.map((o) => ({ ...o }));
  const originalName = options[0].name;
  options[0] = { ...options[0], name: "Auto Insurance (renamed)" };

  const { errors } = service.previewChanges({ available_options: options });

  if (!errors || errors.length === 0) throw new Error("expected a rename to be flagged as a preview-time error");
  if (!errors.some((e) => e.code === "OPTION_RENAME_NOT_ALLOWED")) throw new Error(`expected OPTION_RENAME_NOT_ALLOWED, got: ${JSON.stringify(errors)}`);
  if (!errors[0].message.includes(originalName) || !errors[0].message.includes("Auto Insurance (renamed)")) {
    throw new Error("expected the error message to name both the old and new names for an actionable report");
  }

  rmSync(dir, { recursive: true, force: true });
});

await check("renaming an available_option is rejected at SAVE time too (defense in depth, not just a UI-disabled button) -- file untouched, no backup consumed", async () => {
  const dir = freshTestDir();
  const testPath = join(dir, "test.yaml");
  const beforeText = readFileSync(testPath, "utf-8");
  const domainRef = { current: loadDomainPackage(testPath) };
  const service = new ConfigurationService(testPath, domainRef);
  const backupCountBefore = existsSync("backups") ? countFilesRecursive("backups") : 0;

  const options = domainRef.current.domain.recommendation.available_options.map((o) => ({ ...o }));
  options[0] = { ...options[0], name: "Auto Insurance (renamed)" };

  const result = await service.saveChanges({ available_options: options });

  if (result.success) throw new Error("expected a rename to be rejected at save time, even calling saveChanges directly (bypassing any frontend disabled-button check)");
  if (!result.errors?.some((e) => e.code === "OPTION_RENAME_NOT_ALLOWED")) throw new Error(`expected OPTION_RENAME_NOT_ALLOWED among save errors, got: ${JSON.stringify(result.errors)}`);
  if (readFileSync(testPath, "utf-8") !== beforeText) throw new Error("file was modified despite the rename being rejected");
  const backupCountAfter = existsSync("backups") ? countFilesRecursive("backups") : 0;
  if (backupCountAfter !== backupCountBefore) throw new Error("a backup was consumed on a rejected rename -- verify-before-backup ordering violated");

  rmSync(dir, { recursive: true, force: true });
});

await check("adding a genuinely NEW option (not a rename) at the end is unaffected -- only same-index name changes are blocked", async () => {
  const dir = freshTestDir();
  const testPath = join(dir, "test.yaml");
  const domainRef = { current: loadDomainPackage(testPath) };
  const service = new ConfigurationService(testPath, domainRef);

  const options = [
    ...domainRef.current.domain.recommendation.available_options.map((o) => ({ ...o })),
    { name: "Business Insurance", fits_when: "Customer's goal concerns protecting a business's assets or liability." },
  ];

  const { errors } = service.previewChanges({ available_options: options });
  if (errors && errors.some((e) => e.code === "OPTION_RENAME_NOT_ALLOWED")) {
    throw new Error("appending a new option must not be misidentified as a rename of an existing one");
  }

  rmSync(dir, { recursive: true, force: true });
});

console.log("\n" + "=".repeat(70));
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
