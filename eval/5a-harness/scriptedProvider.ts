/**
 * ITEM 5A — VALIDATION HARNESS. NOT ITEM 5. Read that twice before citing
 * this file's results as evidence of anything about real conversation
 * quality — it verifies wiring, not behavior. Per Arch2's explicit
 * instruction: track and report these as separate items.
 *
 * A ScriptedProvider implements ChatCompletionFn (router.ts) by replaying
 * pre-supplied responses in order, one per call, instead of making a real
 * network call. Everything upstream of this — prompt assembly in
 * callA.ts/callB.ts, all of pipeline.ts's orchestration, state application,
 * lifecycle resolution, pricing resolution — runs as the actual production
 * code path. Only the network call itself is replaced.
 *
 * This is deliberately dumb: it doesn't parse or understand the prompt it
 * receives, it just returns the next scripted response in sequence,
 * asserting the CALL COUNT matches expectations (too few/many calls is
 * itself a wiring bug worth catching). Scenario authors are responsible
 * for scripting responses that are internally consistent with what the
 * scenario claims to be testing — the harness won't catch a badly-written
 * scenario, only a badly-WIRED pipeline.
 */

import type { ChatCompletionFn, ChatCompletionParams } from "../../src/llm/router.js";

export interface ScriptedCall {
  // Which call this was expected to be, for a clearer failure message if
  // the sequence goes out of order (e.g. pipeline.ts calling Call B before
  // Call A on some code path would surface here, not just as garbage output).
  expectedTier: "fast" | "quality";
  response: string;
}

export class ScriptedProvider {
  private calls: ScriptedCall[];
  private index = 0;
  public callLog: ChatCompletionParams[] = [];

  constructor(calls: ScriptedCall[]) {
    this.calls = calls;
  }

  fn: ChatCompletionFn = async (params: ChatCompletionParams): Promise<string> => {
    this.callLog.push(params);
    const next = this.calls[this.index];
    if (!next) {
      throw new Error(
        `ScriptedProvider: pipeline made more chatCompletion calls (${this.index + 1}) than the scenario ` +
          `scripted (${this.calls.length}). This is either a real wiring bug (e.g. an unexpected retry) ` +
          `or the scenario under-scripted a needed follow-up call — check the scenario, not just the code.`
      );
    }
    if (next.expectedTier !== params.tier) {
      throw new Error(
        `ScriptedProvider: call ${this.index + 1} expected tier "${next.expectedTier}" (matching the ` +
          `scenario's assumption of which call this is — Call A uses "fast", Call B uses "quality"), got ` +
          `"${params.tier}" instead. This usually means Call A and Call B fired in an unexpected order.`
      );
    }
    this.index++;
    return next.response;
  };

  /** Call at the end of a scenario to confirm every scripted response was actually consumed. */
  assertFullyConsumed(): void {
    if (this.index !== this.calls.length) {
      throw new Error(
        `ScriptedProvider: scenario scripted ${this.calls.length} calls but only ${this.index} were made. ` +
          `The pipeline stopped short of where the scenario expected it to go.`
      );
    }
  }
}

/** Helper: a Call A response, pre-formatted as the JSON string chatCompletion would return. */
export function callAResponse(output: {
  updates?: Array<{ variable: string; evidence_type: "explicit" | "inferred" | "assumed"; statement: string; satisfies: string[] }>;
  possible_conflicts?: Array<{ variable: string; reason: string }>;
  pending_customer_question?: string | null;
  proposed_lifecycle?: "active" | "paused" | "completed" | "abandoned" | "escalated";
}): ScriptedCall {
  return {
    expectedTier: "fast",
    response: JSON.stringify({
      updates: output.updates ?? [],
      possible_conflicts: output.possible_conflicts ?? [],
      pending_customer_question: output.pending_customer_question ?? null,
      proposed_lifecycle: output.proposed_lifecycle ?? "active",
    }),
  };
}

/** Helper: a Call B response — just plain text, matching what Call B actually returns. */
export function callBResponse(text: string): ScriptedCall {
  return { expectedTier: "quality", response: text };
}
