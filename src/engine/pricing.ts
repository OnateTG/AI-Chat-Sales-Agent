/**
 * Domain Package Specification §5 — Pricing (structured, engine-evaluated).
 *
 * The deterministic half of pricing: is an exact quote allowed right now,
 * given conversation state? Call B never decides this — it only receives
 * the resolved `pricing_context` and communicates it (Prompt Spec §3.2).
 *
 * Per the spec's explicit constraint: `condition` values must reference
 * existing, already-defined state (variable status, recommendation
 * .completion_requirement, conversation.lifecycle) — not free text. This
 * file implements evaluation for the two condition shapes defined in the
 * worked example. If a future domain package needs a genuinely new
 * condition shape, that's a spec conversation (Domain Package §5's
 * constraint exists precisely to stop ad hoc condition strings from
 * creeping in), not a silent addition here.
 */

import type { StateMap, PricingContext, PricingMode } from "./types.js";

export interface QuotingRule {
  condition: "recommendation.completion_requirement not yet satisfied" | "recommendation.completion_requirement satisfied";
  mode: PricingMode;
}

export interface PricingDefinition {
  ranges: Record<string, string>;
  quoting_rules: QuotingRule[];
}

export function resolvePricingContext(
  pricing: PricingDefinition | null,
  state: StateMap,
  recommendationCompletionRequirement: string[]
): PricingContext | null {
  if (!pricing) return null; // domain declares no pricing section — Prompt Spec §3.2: field omitted entirely

  const satisfied = recommendationCompletionRequirement.every((name) => state[name]?.status === "complete");

  const rule = pricing.quoting_rules.find((r) =>
    satisfied
      ? r.condition === "recommendation.completion_requirement satisfied"
      : r.condition === "recommendation.completion_requirement not yet satisfied"
  );

  if (!rule) {
    // A domain package declared pricing but didn't cover both states —
    // fail safe to the more conservative mode rather than guessing.
    return { mode: "range_only", ranges: pricing.ranges };
  }

  return { mode: rule.mode, ranges: pricing.ranges };
}
