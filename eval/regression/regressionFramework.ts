/**
 * Per-domain regression suite framework (production handoff: "gates any
 * future package edit before it's publishable"). Reusable across domains
 * — built as an extension of the 5A harness pattern (real runTurn() +
 * ScriptedProvider), not copy-pasted per domain. Adding a third domain
 * package later means writing a new scenario file, not a new framework.
 *
 * Same honest scope boundary as 5A: this verifies WIRING and DOMAIN
 * CONTENT correctness (does the right data reach the right place given
 * this domain's actual variables/options), not Call B's live judgment —
 * that still needs real model access this environment doesn't have.
 */

import { runTurn } from "../../src/engine/pipeline.js";
import type { ConversationRecord } from "../../src/engine/types.js";
import type { DomainPackage } from "../../src/domain/types.js";
import { ScriptedProvider, type ScriptedCall } from "../5a-harness/scriptedProvider.js";

export type PathType = "happy" | "objection" | "clarification" | "recommendation";

export interface RegressionTurn {
  customerMessage: string;
  scripted: ScriptedCall[]; // usually [callAResponse(...), callBResponse(...)]
  assert: (result: Awaited<ReturnType<typeof runTurn>>, callBInput: Record<string, unknown> | null) => void;
}

export interface RegressionScenario {
  name: string;
  pathType: PathType;
  initialVariables?: ConversationRecord["variables"];
  turns: RegressionTurn[];
}

function freshRecord(domain: DomainPackage, initialVariables: ConversationRecord["variables"] = {}): ConversationRecord {
  return {
    phone: "regression-test",
    variables: initialVariables,
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

export interface RegressionResult {
  domainName: string;
  results: Array<{ scenario: string; pathType: PathType; passed: boolean; error?: string }>;
}

export async function runRegressionSuite(domain: DomainPackage, toneConfig: string, scenarios: RegressionScenario[]): Promise<RegressionResult> {
  const results: RegressionResult["results"] = [];

  for (const scenario of scenarios) {
    try {
      let record = freshRecord(domain, scenario.initialVariables);
      const provider = new ScriptedProvider(scenario.turns.flatMap((t) => t.scripted));

      for (const turn of scenario.turns) {
        const result = await runTurn({
          record,
          event: { type: "inbound_message", text: turn.customerMessage, timestamp: new Date().toISOString() },
          domain,
          toneConfig,
          chatCompletionFn: provider.fn,
        });

        // Extract Call B's actual input, if a Call B call happened this
        // turn, so scenario assertions can check what Call B really
        // received (business_knowledge_snippet, pricing_context, etc.),
        // not just that the pipeline didn't throw.
        const callBCall = provider.callLog.find((c) => c.tier === "quality");
        const callBInput = callBCall ? JSON.parse(callBCall.messages[1].content) : null;

        turn.assert(result, callBInput);
        record = result.record;
      }

      provider.assertFullyConsumed();
      results.push({ scenario: scenario.name, pathType: scenario.pathType, passed: true });
    } catch (e) {
      results.push({ scenario: scenario.name, pathType: scenario.pathType, passed: false, error: String(e) });
    }
  }

  return { domainName: domain.domain.name, results };
}

export function printRegressionReport(result: RegressionResult): boolean {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`REGRESSION SUITE — ${result.domainName}`);
  console.log("=".repeat(70));

  const pathTypes: PathType[] = ["happy", "objection", "clarification", "recommendation"];
  let anyFailed = false;

  for (const pt of pathTypes) {
    const inPath = result.results.filter((r) => r.pathType === pt);
    if (inPath.length === 0) {
      console.log(`\n${pt.toUpperCase()} PATH: no scenario defined`);
      continue;
    }
    console.log(`\n${pt.toUpperCase()} PATH:`);
    for (const r of inPath) {
      console.log(`  ${r.passed ? "PASS" : "FAIL"}  ${r.scenario}`);
      if (!r.passed) {
        console.log(`        ${r.error}`);
        anyFailed = true;
      }
    }
  }

  return !anyFailed;
}
