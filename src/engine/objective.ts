/**
 * Runtime Specification §Step 4 (Determine Objective) and §Step 5 (Select
 * Action) — direct implementation.
 *
 * UPDATED (Delta C, ADL-021): returns a tri-state ObjectiveOutcome instead
 * of throwing. The old NoValidObjectiveError design correctly caught the
 * real gap B1's enumeration found, but it was undifferentiated — it fired
 * identically for two mechanically different situations: legitimate
 * post-recommendation terminal states (lifecycle moving toward
 * completed/paused/escalated — not an error) and genuine unresolved gaps
 * (lifecycle still active, nothing matches — Problem B's territory, a
 * real failure). Step 1's verification (ADL-017/018) proved this split
 * precisely: 3 of the original 5 throwing cases were the former, 2 were
 * the latter. This is where `lifecycle` stops being an unconsumed
 * parameter (threaded since B1 Part 1, `void`'d ever since) and becomes
 * load-bearing for the first time.
 *
 * Still true, unchanged: do not add a fifth objective to the four below.
 * The fix here is a GATE + a differentiated non-match outcome, not a new
 * objective — see ObjectiveOutcome's own invariant comments in types.ts.
 */

import type { StateMap, Objective, Action, Lifecycle, ObjectiveOutcome } from "./types.js";

export interface DomainVariableMeta {
  name: string;
  importance: "critical" | "high" | "medium" | "low";
}

export interface DetermineObjectiveParams {
  state: StateMap;
  domainVariables: DomainVariableMeta[];
  recommendationCompletionRequirement: string[];
  pendingCustomerQuestion: string | null;
  lifecycle: Lifecycle;
  recommendationDelivered: boolean;
}

const IMPORTANCE_RANK: Record<DomainVariableMeta["importance"], number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

/**
 * Runtime §Step 4 priority order:
 *   1. Resolve any variable in `conflict` — always first, any importance tier
 *   2. Answer a pending direct customer question
 *   3. Progress the highest-importance incomplete variable
 *   4. Produce a recommendation, if all required variables are complete
 *      AND no recommendation has already been delivered this conversation
 *   5. (Delta C) If none of the above match: `lifecycle !== "active"` means
 *      the conversation has legitimately moved past objective-driven work
 *      (`no_objective`); `lifecycle === "active"` means something is
 *      genuinely wrong — an objective should exist but doesn't (`error`).
 *      This exact split is Step 1's already-verified evidence (ADL-017),
 *      applied here, not new investigation.
 *
 * Per ObjectiveOutcome's own invariants (types.ts): this is the ONLY
 * function permitted to produce an ObjectiveOutcome. Everything downstream
 * consumes it read-only.
 */
export function determineObjective(params: DetermineObjectiveParams): ObjectiveOutcome {
  const {
    state,
    domainVariables,
    recommendationCompletionRequirement,
    pendingCustomerQuestion,
    lifecycle,
    recommendationDelivered,
  } = params;

  // Priority 1 — conflict, regardless of importance tier (State Model §5.2 rule 4)
  const conflicted = Object.entries(state).find(([, v]) => v.status === "conflict");
  if (conflicted) {
    return { kind: "objective", objective: "resolve_conflict", target: conflicted[0] };
  }

  // Priority 2 — pending question (Runtime §6.3)
  if (pendingCustomerQuestion) {
    return { kind: "objective", objective: "answer_pending_question", target: null };
  }

  // Priority 3 — highest-importance incomplete variable
  const incomplete = domainVariables
    .filter((dv) => state[dv.name]?.status !== "complete")
    .sort((a, b) => IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance]);

  if (incomplete.length > 0) {
    return { kind: "objective", objective: "progress_variable", target: incomplete[0].name };
  }

  // Priority 4 — all required variables complete AND not already recommended
  const allRequiredComplete = recommendationCompletionRequirement.every(
    (name) => state[name]?.status === "complete"
  );

  if (allRequiredComplete && !recommendationDelivered) {
    return { kind: "objective", objective: "produce_recommendation", target: null };
  }

  // Reached only when: no conflict, no pending question, no incomplete
  // variable, AND (completion isn't satisfied OR a recommendation was
  // already delivered). Step 1's verified split (ADL-017) applies exactly
  // here: does `lifecycle` show the conversation has legitimately moved
  // on, or is it still `active` with nothing to show for it?
  if (lifecycle !== "active") {
    // Legitimate terminal case — recommend already given (or nothing to
    // recommend yet, but the customer/conversation has moved to paused/
    // completed/escalated regardless). Not an error. Call B responds
    // naturally, no directive — see callB.ts's "no_objective" branch.
    return { kind: "no_objective" };
  }

  // lifecycle === "active": the conversation is, by its own signal, still
  // in ordinary ongoing engagement, yet nothing matched. This is the
  // genuine gap — Problem B's territory (statement-phrased messages the
  // recognition path can miss). A real failure, not routed to a generic
  // reply just to avoid surfacing it.
  return {
    kind: "error",
    reason: `lifecycle=active, recommendationDelivered=${recommendationDelivered}, allRequiredComplete=${allRequiredComplete}, no objective matched`,
  };
}

/** Runtime §Step 5: objective -> action, a pure lookup table. Unchanged — only ever consulted for the "objective" outcome kind. */
const OBJECTIVE_TO_ACTION: Record<Objective, Action> = {
  resolve_conflict: "clarify",
  answer_pending_question: "answer",
  progress_variable: "ask",
  produce_recommendation: "recommend",
};

export function selectAction(objective: Objective): Action {
  return OBJECTIVE_TO_ACTION[objective];
}
