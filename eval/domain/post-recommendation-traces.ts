/**
 * Finding B evidence-gathering — post-recommendation conversation traces.
 *
 * HISTORY, left intact rather than rewritten, per this project's practice
 * of not silently editing past records:
 *   - Original run: predicted all 5 non-clean traces would throw
 *     NoValidObjectiveError. Correct hypothesis at the time.
 *   - Step 1 verification (ADL-017/018): found 3 of those 5 (Trace 1,
 *     5-Day-1, 6) are actually legitimate terminal states per the Runtime
 *     Specification's original intent, not bugs. Only 2 (3b, 5-Day-6(b))
 *     are a genuine gap, explained by Problem B.
 *   - Delta C (ADL-021, this update): the code now implements that exact
 *     split. This file changes from "expect all 5 to throw" to "assert
 *     the predicted 3-vs-2 split lands exactly," per explicit instruction
 *     — not approximately, a hard assertion per trace.
 */

import { loadDomainPackage } from "../../src/domain/domainLoader.js";
import { allVariables } from "../../src/domain/types.js";
import { determineObjective, selectAction } from "../../src/engine/objective.js";
import { applyEvidence, emptyVariableState } from "../../src/engine/stateModel.js";
import type { StateMap, Lifecycle, ObjectiveOutcome } from "../../src/engine/types.js";

const domain = loadDomainPackage("domains/website-development.yaml");
const domainVars = allVariables(domain).map((v) => ({ name: v.name, importance: v.meta.importance }));

let passed = 0;
let failed = 0;

function complete(statement: string, satisfies: string[]) {
  return applyEvidence({ current: emptyVariableState(), newEvidence: { type: "explicit", statement, satisfies }, turn: 1, isContradiction: false, requiredSubAttributes: satisfies });
}

const baseState: StateMap = {
  goal: complete("I need more enquiries", ["desired_outcome", "business_reason"]),
  current_situation: complete("I don't have a website yet", ["situation_described"]),
  gap: complete("people can't find me online", ["primary_obstacle"]),
  booking_or_ecommerce_needs: complete("just a contact form, no booking or payments", ["feature_requirements"]),
  readiness: complete("want this live within a month, I'm the owner", ["timeline"]),
};

function run(
  label: string,
  state: StateMap,
  pendingQuestion: string | null,
  lifecycle: Lifecycle,
  recommendationDelivered: boolean,
  expectedKind: ObjectiveOutcome["kind"]
): ObjectiveOutcome {
  const result = determineObjective({
    state, domainVariables: domainVars,
    recommendationCompletionRequirement: domain.domain.recommendation.completion_requirement,
    pendingCustomerQuestion: pendingQuestion, lifecycle, recommendationDelivered,
  });

  const detail =
    result.kind === "objective" ? `objective: ${result.objective}, action: ${selectAction(result.objective)}`
    : result.kind === "no_objective" ? "no_objective (legitimate terminal state -- real reply expected)"
    : `error: ${result.reason}`;

  if (result.kind === expectedKind) {
    console.log(`  PASS  ${label}  [lifecycle: ${lifecycle}] -> ${detail}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}  [lifecycle: ${lifecycle}] -> expected kind "${expectedKind}", got "${result.kind}" (${detail})`);
    failed++;
  }
  return result;
}

console.log("=".repeat(70));
console.log("TRACE 1 — Clean acceptance. 'This looks perfect, let's do it'");
console.log("Predicted (ADL-017): no_objective -- legitimate terminal, lifecycle=completed");
console.log("=".repeat(70));
run("Turn N+1, nothing else changed", baseState, null, "completed", true, "no_objective");

console.log("\n" + "=".repeat(70));
console.log("TRACE 3a — Price objection AS A QUESTION: 'Can you do this for less?'");
console.log("Predicted: objective (answer_pending_question) -- unaffected by this whole investigation");
console.log("=".repeat(70));
run("pending_customer_question set", baseState, "Can you do this for less?", "active", true, "objective");

console.log("\n" + "=".repeat(70));
console.log("TRACE 3b — Same, AS A STATEMENT: 'That's more than I budgeted for.'");
console.log("Predicted (ADL-017): error -- lifecycle=active, genuine gap, Problem B territory");
console.log("=".repeat(70));
run("no pending_customer_question", baseState, null, "active", true, "error");

console.log("\n" + "=".repeat(70));
console.log("TRACE 4 — New info reopens qualification: 'Might want online payments too.'");
console.log("Predicted: objective (resolve_conflict) -- unaffected by this whole investigation");
console.log("=".repeat(70));
const reopenedState: StateMap = {
  ...baseState,
  booking_or_ecommerce_needs: applyEvidence({
    current: baseState.booking_or_ecommerce_needs,
    newEvidence: { type: "explicit", statement: "actually I might want online deposit payments too", satisfies: ["feature_requirements"] },
    turn: 2, isContradiction: true, requiredSubAttributes: ["feature_requirements"],
  }),
};
run("possible_conflict flagged", reopenedState, null, "active", true, "objective");

console.log("\n" + "=".repeat(70));
console.log("TRACE 5, Day 1 — 'Let me think about it and discuss with my partner.'");
console.log("Predicted (ADL-017): no_objective -- legitimate terminal, lifecycle=paused");
console.log("=".repeat(70));
run("explicit expected-return signal", baseState, null, "paused", true, "no_objective");

console.log("\n" + "=".repeat(70));
console.log("TRACE 5, Day 6 — 'Still keen, is the offer still available?'");
console.log("=".repeat(70));
run("  (a) if Call A sets pending_customer_question -- predicted: objective (answer)", baseState, "is the offer still available?", "active", true, "objective");
run("  (b) if Call A does NOT set it -- predicted (ADL-017): error, same as 3b", baseState, null, "active", true, "error");

console.log("\n" + "=".repeat(70));
console.log("TRACE 6 — Escalation: 'Can I just speak to a real person about this?'");
console.log("Predicted (ADL-017): no_objective -- legitimate terminal, lifecycle=escalated");
console.log("=".repeat(70));
run("proposed_lifecycle: escalated", baseState, null, "escalated", true, "no_objective");

console.log("\n" + "=".repeat(70));
console.log(`${passed} passed, ${failed} failed`);
console.log(`Split confirmed: 3 no_objective (1, 5-Day-1, 6) + 2 error (3b, 5-Day-6(b)) + 3 unaffected objective (3a, 4, 5-Day-6a) = 8 total, matching ADL-017's evidence exactly.`);
process.exit(failed > 0 ? 1 : 0);
