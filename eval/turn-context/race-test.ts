/**
 * Delta A (TurnContext, ADL-020/021) — permanent regression test.
 *
 * Committed per explicit instruction: "the regression test you built
 * becomes permanent, checked into the suite, not a throwaway script...
 * it's now protecting an architectural invariant, not just proving a
 * one-time point."
 *
 * Proves the exact race Delta A describes cannot corrupt a turn: triggers
 * a REAL ConfigurationService hot-reload in the actual async gap between
 * Call A and Call B (not a simulated delay), against the real runTurn()
 * pipeline, and confirms Call B still receives the OLD snapshot even
 * though the module-level config genuinely changed mid-turn.
 *
 * Run: npx tsx eval/turn-context/race-test.ts
 */

import { runTurn } from "../../src/engine/pipeline.js";
import { loadDomainPackage } from "../../src/domain/domainLoader.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import type { ConversationRecord } from "../../src/engine/types.js";
import type { ChatCompletionParams } from "../../src/llm/router.js";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;

async function check(label: string, fn: () => Promise<void>) {
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

await check("a config hot-reload triggered mid-turn does not affect the in-flight turn's Call B input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turncontext-race-"));
  const testPath = join(dir, "test.yaml");
  copyFileSync("domains/website-development.yaml", testPath);

  const domainRef = { current: loadDomainPackage(testPath) };
  const configService = new ConfigurationService(testPath, domainRef);
  const originalRange = domainRef.current.business?.pricing?.ranges?.["Brochure Website"];

  const record: ConversationRecord = {
    phone: "race-test", variables: {},
    conversation: { lifecycle: "active", current_objective: null, last_customer_activity: null, last_agent_activity: null, recommendation_delivered: false },
    turn: 0, business_package_version: domainRef.current.business_package.version,
    automation_paused: false, paused_reason: null, paused_at: null, paused_by: null,
    last_objective: null, last_target: null, repeat_count: 0,
  };

  let callBSawRange: string | undefined;
  const racingChatFn = async (params: ChatCompletionParams): Promise<string> => {
    if (params.tier === "fast") {
      // Real hot-reload, in the real async gap, exactly where an operator
      // save could land between Call A resolving and Call B starting.
      await configService.saveChanges({ pricing_ranges: { "Brochure Website": "RACED VALUE -- SHOULD NOT REACH CALL B THIS TURN" } });
      return JSON.stringify({ updates: [], possible_conflicts: [], pending_customer_question: "how much for a brochure site?", proposed_lifecycle: "active" });
    }
    const input = JSON.parse(params.messages[1].content);
    callBSawRange = input.pricing_context?.ranges?.["Brochure Website"];
    return "It depends on the package.";
  };

  // Snapshot taken here, exactly like server.ts does at the top of the
  // webhook handler -- before calling into the turn at all.
  const domainSnapshot = domainRef.current;

  await runTurn({
    record,
    event: { type: "inbound_message", text: "how much for a brochure site?", timestamp: new Date().toISOString() },
    domain: domainSnapshot,
    toneConfig: "test",
    chatCompletionFn: racingChatFn,
  });

  // Two separate assertions: (1) the reload genuinely happened (proves
  // this isn't a vacuous test -- config really did change), (2) Call B
  // still saw the pre-reload value despite that.
  const reloadGenuinelyHappened = domainRef.current.business?.pricing?.ranges?.["Brochure Website"] !== originalRange;
  if (!reloadGenuinelyHappened) throw new Error("the hot-reload didn't actually happen -- test is vacuous, not proving anything");

  if (callBSawRange !== originalRange) {
    throw new Error(
      `Call B received "${callBSawRange}" but should have received the pre-reload snapshot "${originalRange}" -- ` +
        `TurnContext's isolation guarantee is broken.`
    );
  }

  rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
