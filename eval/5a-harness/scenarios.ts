/**
 * ITEM 5A — VALIDATION HARNESS. NOT ITEM 5 (Real Conversation Validation).
 * Per Arch2's explicit instruction, tracked and reported separately —
 * do not read a pass here as evidence about real conversation quality.
 * This verifies that pipeline.ts's WIRING is correct: does data flow
 * between Call A -> Engine -> Call B correctly, does state persist
 * correctly, does the B1 gate's error path actually propagate all the way
 * out to a RunTurnResult the way server.ts expects.
 *
 * Every scenario below calls the real runTurn() — same code that runs in
 * production — with a ScriptedProvider standing in for the network call
 * only. Run: npx tsx eval/5a-harness/scenarios.ts
 */

import { runTurn } from "../../src/engine/pipeline.js";
import { loadDomainPackage } from "../../src/domain/domainLoader.js";
import { readFileSync } from "node:fs";
import type { ConversationRecord } from "../../src/engine/types.js";
import { ScriptedProvider, callAResponse, callBResponse } from "./scriptedProvider.js";

const domain = loadDomainPackage("domains/website-development.yaml");
const toneConfig = readFileSync("config/tone.md", "utf-8");

let passed = 0;
let failed = 0;

function freshRecord(): ConversationRecord {
  return {
    phone: "test-phone",
    variables: {},
    conversation: {
      lifecycle: "active",
      current_objective: null,
      last_customer_activity: null,
      last_agent_activity: null,
      recommendation_delivered: false,
    },
    turn: 0,
    business_package_version: domain.business_package.version,
    automation_paused: false,
    paused_reason: null,
    paused_at: null,
    paused_by: null,
    last_objective: null,
    last_target: null,
    repeat_count: 0,
  };
}

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

async function main() {
  console.log("=".repeat(70));
  console.log("SCENARIO 1 — Fresh conversation, partial info -> ask");
  console.log("=".repeat(70));
  await check("wiring: empty state -> Call A extracts -> ask fires -> state persists", async () => {
    const provider = new ScriptedProvider([
      callAResponse({
        updates: [{ variable: "goal", evidence_type: "explicit", statement: "need more customers", satisfies: ["desired_outcome"] }],
      }),
      callBResponse("Got it — what's making it hard for people to find you right now?"),
    ]);
    const result = await runTurn({
      record: freshRecord(),
      event: { type: "inbound_message", text: "I need more customers", timestamp: new Date().toISOString() },
      domain,
      toneConfig,
      chatCompletionFn: provider.fn,
    });
    provider.assertFullyConsumed();
    if (result.record.variables.goal?.status !== "partial") throw new Error(`expected goal:partial, got ${result.record.variables.goal?.status}`);
    if (result.reply === null) throw new Error("expected a real reply, got null");
    if (result.record.conversation.current_objective !== "progress_variable") throw new Error("expected progress_variable objective recorded");
  });

  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 2 — Multi-turn to full qualification -> recommend, flag gets set");
  console.log("=".repeat(70));
  await check("wiring: recommendation_delivered flips false->true on the exact turn recommend fires", async () => {
    let record = freshRecord();
    record.variables = {
      goal: { value: "more leads", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["desired_outcome", "business_reason"] }], confidence: "high" },
      current_situation: { value: "no site", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["situation_described"] }], confidence: "high" },
      gap: { value: "can't be found", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["primary_obstacle"] }], confidence: "high" },
      readiness: { value: "asap", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["timeline"] }], confidence: "high" },
    };
    if (record.conversation.recommendation_delivered !== false) throw new Error("precondition failed");

    const provider = new ScriptedProvider([
      callAResponse({ updates: [{ variable: "booking_or_ecommerce_needs", evidence_type: "explicit", statement: "just a contact form", satisfies: ["feature_requirements"] }] }),
      callBResponse("Based on everything you've shared, a Lead-Generation Website is the right fit..."),
    ]);
    const result = await runTurn({
      record,
      event: { type: "inbound_message", text: "just a contact form is fine", timestamp: new Date().toISOString() },
      domain,
      toneConfig,
      chatCompletionFn: provider.fn,
    });
    provider.assertFullyConsumed();
    if (result.record.conversation.current_objective !== "produce_recommendation") throw new Error("expected produce_recommendation");
    if (result.record.conversation.recommendation_delivered !== true) throw new Error("recommendation_delivered flag did not flip to true");
  });

  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 3 — Conflicting information -> clarify");
  console.log("=".repeat(70));
  await check("wiring: Call A conflict flag -> Engine confirms -> clarify action selected", async () => {
    let record = freshRecord();
    record.variables = {
      booking_or_ecommerce_needs: { value: "no payments needed", status: "complete", evidence: [{ type: "explicit", statement: "no payments needed", turn: 1, satisfies: ["feature_requirements"] }], confidence: "high" },
    };
    const provider = new ScriptedProvider([
      callAResponse({
        updates: [{ variable: "booking_or_ecommerce_needs", evidence_type: "explicit", statement: "actually I want online payments", satisfies: ["feature_requirements"] }],
        possible_conflicts: [{ variable: "booking_or_ecommerce_needs", reason: "contradicts earlier 'no payments needed'" }],
      }),
      callBResponse("Just to make sure I've got this right — earlier you said no payments needed, now online payments. Which is it?"),
    ]);
    const result = await runTurn({
      record,
      event: { type: "inbound_message", text: "actually I want online payments too", timestamp: new Date().toISOString() },
      domain,
      toneConfig,
      chatCompletionFn: provider.fn,
    });
    provider.assertFullyConsumed();
    if (result.record.variables.booking_or_ecommerce_needs?.status !== "conflict") throw new Error("expected conflict status");
    if (result.record.conversation.current_objective !== "resolve_conflict") throw new Error("expected resolve_conflict objective");
  });

  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 4 — Direct question mid-conversation -> answer");
  console.log("=".repeat(70));
  await check("wiring: pending_customer_question -> answer_pending_question -> business_knowledge reaches Call B", async () => {
    const provider = new ScriptedProvider([
      callAResponse({ pending_customer_question: "how long does this take?" }),
      callBResponse("The first version is built within 24 hours of us agreeing on a recommendation."),
    ]);
    const result = await runTurn({
      record: freshRecord(),
      event: { type: "inbound_message", text: "how long does this take?", timestamp: new Date().toISOString() },
      domain,
      toneConfig,
      chatCompletionFn: provider.fn,
    });
    provider.assertFullyConsumed();
    if (result.record.conversation.current_objective !== "answer_pending_question") throw new Error("expected answer_pending_question");
    // Confirms business_knowledge_snippet actually reached Call B's input, not just that SOME reply came back
    const callBInput = JSON.parse(provider.callLog[1].messages[1].content);
    if (!callBInput.business_knowledge_snippet) throw new Error("business_knowledge_snippet was null/missing in Call B's actual input -- retrieval wiring broken");
  });

  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 5 — Pricing question, before completion -> range_only reaches Call B");
  console.log("=".repeat(70));
  await check("wiring: pricing_context.mode correctly resolves to range_only when incomplete", async () => {
    const provider = new ScriptedProvider([
      callAResponse({ pending_customer_question: "how much does this cost?" }),
      callBResponse("It depends on which type fits you best -- ranges vary by package."),
    ]);
    const result = await runTurn({
      record: freshRecord(), // nothing complete yet
      event: { type: "inbound_message", text: "how much does this cost?", timestamp: new Date().toISOString() },
      domain,
      toneConfig,
      chatCompletionFn: provider.fn,
    });
    provider.assertFullyConsumed();
    const callBInput = JSON.parse(provider.callLog[1].messages[1].content);
    if (callBInput.pricing_context?.mode !== "range_only") {
      throw new Error(`expected pricing_context.mode: range_only on an incomplete state, got ${JSON.stringify(callBInput.pricing_context)}`);
    }
  });

  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 6 — Post-recommendation, no_objective -> Call B invoked with no directive, real reply");
  console.log("  (Delta C, ADL-021: this profile is Trace 1 from post-recommendation-traces.ts --");
  console.log("   flipped from the old NoValidObjectiveError/reply:null expectation per ADL-017's verified split.)");
  console.log("=".repeat(70));
  await check("wiring: no_objective outcome reaches Call B with outcome:'no_objective', produces a real reply", async () => {
    let record = freshRecord();
    record.variables = {
      goal: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["desired_outcome", "business_reason"] }], confidence: "high" },
      current_situation: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["situation_described"] }], confidence: "high" },
      gap: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["primary_obstacle"] }], confidence: "high" },
      readiness: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["timeline"] }], confidence: "high" },
      booking_or_ecommerce_needs: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["feature_requirements"] }], confidence: "high" },
    };
    record.conversation.recommendation_delivered = true; // recommendation already given last turn
    record.conversation.lifecycle = "active"; // will be resolved to "completed" by Call A's proposal below

    const provider = new ScriptedProvider([
      callAResponse({ proposed_lifecycle: "completed" }), // "thanks!" -- no updates, no question, nothing new
      callBResponse("So glad it's a fit — I'll have everything ready for you soon!"),
      // TWO scripted calls now, not one: Call B genuinely IS reached for
      // no_objective, per Prompt Spec §3.4's realization guidance. If
      // pipeline.ts regresses to short-circuiting this case, either
      // ScriptedProvider's "fewer calls than scripted" won't fire cleanly
      // (assertFullyConsumed catches that) or the reply-shape assertions
      // below will.
    ]);
    const result = await runTurn({
      record,
      event: { type: "inbound_message", text: "thanks so much!", timestamp: new Date().toISOString() },
      domain,
      toneConfig,
      chatCompletionFn: provider.fn,
    });
    provider.assertFullyConsumed();
    if (result.reply === null) throw new Error("expected a real reply for no_objective, got null -- outcome split regressed");
    if (result.requiresHumanHandoff) throw new Error("expected requiresHumanHandoff to be unset for no_objective");

    // Confirms Call B's ACTUAL received input has outcome:"no_objective"
    // and no selected_action -- not just that some reply came back.
    const callBInput = JSON.parse(provider.callLog[1].messages[1].content);
    if (callBInput.outcome !== "no_objective") throw new Error(`expected Call B input outcome:"no_objective", got "${callBInput.outcome}"`);
    if ("selected_action" in callBInput) throw new Error("no_objective input should not carry a selected_action");
  });

  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 6b — Post-recommendation, error -> Call B NEVER invoked, reply:null, handoff");
  console.log("  (The other half of the split -- lifecycle still active, genuine gap, Problem B territory.)");
  console.log("=".repeat(70));
  await check("wiring: error outcome short-circuits before Call B, exactly like the old undifferentiated check did", async () => {
    let record = freshRecord();
    record.variables = {
      goal: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["desired_outcome", "business_reason"] }], confidence: "high" },
      current_situation: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["situation_described"] }], confidence: "high" },
      gap: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["primary_obstacle"] }], confidence: "high" },
      readiness: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["timeline"] }], confidence: "high" },
      booking_or_ecommerce_needs: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["feature_requirements"] }], confidence: "high" },
    };
    record.conversation.recommendation_delivered = true;
    record.conversation.lifecycle = "active";

    const provider = new ScriptedProvider([
      callAResponse({ proposed_lifecycle: "active" }), // statement-form objection, lifecycle stays active -- Problem B's exact shape
      // Only ONE scripted call -- Call B must NEVER be reached for "error".
    ]);
    const result = await runTurn({
      record,
      event: { type: "inbound_message", text: "that's more than I budgeted for", timestamp: new Date().toISOString() },
      domain,
      toneConfig,
      chatCompletionFn: provider.fn,
    });
    provider.assertFullyConsumed();
    if (result.reply !== null) throw new Error("expected reply: null for error outcome, got a real reply");
    if (result.requiresHumanHandoff !== true) throw new Error("expected requiresHumanHandoff: true");
  });

  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 7 — Lifecycle persists correctly across two REAL sequential turns");
  console.log("=".repeat(70));
  await check("wiring: paused set on turn N actually persists into turn N+1's stored record", async () => {
    const providerTurn1 = new ScriptedProvider([
      callAResponse({ proposed_lifecycle: "paused" }),
      callBResponse("Take your time -- I'll be here whenever you're ready."),
    ]);
    const turn1 = await runTurn({
      record: freshRecord(),
      event: { type: "inbound_message", text: "let me think it over and get back to you", timestamp: new Date().toISOString() },
      domain,
      toneConfig,
      chatCompletionFn: providerTurn1.fn,
    });
    providerTurn1.assertFullyConsumed();
    if (turn1.record.conversation.lifecycle !== "paused") throw new Error(`turn 1: expected lifecycle paused, got ${turn1.record.conversation.lifecycle}`);

    // This is the actual wiring check: feed turn 1's OUTPUT record back in as
    // turn 2's INPUT, exactly as server.ts does via store.save() / store.get()
    // -- not a fresh record. If pipeline.ts silently dropped or reset
    // conversation state between calls, this is where it would show up.
    const providerTurn2 = new ScriptedProvider([
      callAResponse({ proposed_lifecycle: "active" }),
      callBResponse("Good to hear from you again -- still keen to move forward?"),
    ]);
    const turn2 = await runTurn({
      record: turn1.record,
      event: { type: "inbound_message", text: "ok I'm ready to continue", timestamp: new Date().toISOString() },
      domain,
      toneConfig,
      chatCompletionFn: providerTurn2.fn,
    });
    providerTurn2.assertFullyConsumed();
    if (turn2.record.conversation.lifecycle !== "active") throw new Error(`turn 2: expected lifecycle active, got ${turn2.record.conversation.lifecycle}`);
    if (turn2.record.turn !== 2) throw new Error(`expected turn counter at 2, got ${turn2.record.turn}`);
  });

  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 8 — Kill switch actually blocks processing at the integration point");
  console.log("=".repeat(70));
  await check("wiring: automation_paused=true skips runTurn entirely, sendMessage never called", async () => {
    const { handleInboundMessage } = await import("../../src/whatsapp/handleInboundMessage.js");
    const { ConversationStore } = await import("../../src/store/store.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tmpDir = mkdtempSync(join(tmpdir(), "killswitch-test-"));
    const store = new ConversationStore(tmpDir);
    const { WebhookIdempotencyStore } = await import("../../src/store/webhookIdempotencyStore.js");
    const idempotencyStore = new WebhookIdempotencyStore(join(tmpDir, "seen.json"));
    const record = store.getOrCreate("test-paused-phone", domain.business_package.version);
    record.automation_paused = true;
    record.paused_reason = "test";
    store.save(record);

    let sendCalled = false;
    const provider = new ScriptedProvider([]); // zero calls scripted -- if runTurn fires at all, this throws

    await handleInboundMessage(
      { id: "wamid.test-scenario-8", from: "test-paused-phone", text: "hello?", timestamp: new Date().toISOString() },
      {
        store,
        idempotencyStore,
        domain,
        toneConfig,
        sendMessage: async () => {
          sendCalled = true;
        },
        chatCompletionFn: provider.fn,
      }
    );

    rmSync(tmpDir, { recursive: true, force: true });

    if (sendCalled) throw new Error("sendMessage was called despite automation_paused=true -- kill switch did not engage");
    // provider.callLog.length === 0 confirms runTurn (and therefore Call A/B) never even ran
    if (provider.callLog.length !== 0) throw new Error(`expected zero model calls, got ${provider.callLog.length} -- pipeline ran despite the kill switch`);
  });

  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 9 — Kill switch persists across a SIMULATED PROCESS RESTART");
  console.log("=".repeat(70));
  await check("wiring: a fresh ConversationStore instance, pointed at the same directory, still sees automation_paused=true", async () => {
    const { handleInboundMessage } = await import("../../src/whatsapp/handleInboundMessage.js");
    const { ConversationStore } = await import("../../src/store/store.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tmpDir = mkdtempSync(join(tmpdir(), "restart-test-"));

    // "Before restart" -- process instance 1. Pause a conversation, exactly
    // as bin/kill-switch.ts would, then drop the instance entirely (no
    // reference kept, nothing else touches it again).
    {
      const storeBeforeRestart = new ConversationStore(tmpDir);
      const record = storeBeforeRestart.getOrCreate("restart-test-phone", domain.business_package.version);
      record.automation_paused = true;
      record.paused_reason = "verifying restart persistence";
      record.paused_by = "test";
      storeBeforeRestart.save(record);
      // storeBeforeRestart goes out of scope here -- nothing carries forward in memory.
    }

    // "After restart" -- process instance 2. A BRAND NEW ConversationStore,
    // constructed independently, pointed at the same directory. This is
    // what actually happens on a real process restart: a fresh `new
    // ConversationStore()` call in server.ts, no shared memory with
    // whatever ran before. If persistence relied on anything in-process,
    // this is exactly where it would break.
    const storeAfterRestart = new ConversationStore(tmpDir);
    const { WebhookIdempotencyStore } = await import("../../src/store/webhookIdempotencyStore.js");
    const idempotencyStore = new WebhookIdempotencyStore(join(tmpDir, "seen.json"));

    let sendCalled = false;
    const provider = new ScriptedProvider([]); // zero calls scripted -- same "did the pipeline even run" check as scenario 8

    await handleInboundMessage(
      { id: "wamid.test-scenario-9", from: "restart-test-phone", text: "hello, still there?", timestamp: new Date().toISOString() },
      {
        store: storeAfterRestart,
        idempotencyStore,
        domain,
        toneConfig,
        sendMessage: async () => {
          sendCalled = true;
        },
        chatCompletionFn: provider.fn,
      }
    );

    // Confirm the record itself, independently of behavior, actually shows
    // the paused state -- not just that behavior happened to look right.
    const rereadRecord = storeAfterRestart.get("restart-test-phone");

    rmSync(tmpDir, { recursive: true, force: true });

    if (rereadRecord?.automation_paused !== true) throw new Error("record re-read after 'restart' does not show automation_paused=true -- persistence broken");
    if (rereadRecord?.paused_reason !== "verifying restart persistence") throw new Error("paused_reason did not survive the simulated restart");
    if (sendCalled) throw new Error("sendMessage was called after 'restart' despite automation_paused=true -- kill switch did NOT survive restart");
    if (provider.callLog.length !== 0) throw new Error(`expected zero model calls after restart, got ${provider.callLog.length}`);
  });

  console.log("\n" + "=".repeat(70));
  console.log(`${passed} passed, ${failed} failed`);
  console.log("Reminder: this is Item 5A (wiring verification). Item 5 (real conversation");
  console.log("validation) remains open regardless of this result.");
  process.exit(failed > 0 ? 1 : 0);
}

main();
