/**
 * ADL-009 — empirical demonstration, not just architectural reasoning.
 * Same kernel code (src/engine/*) against two different domain packages.
 * Zero engine changes between the two runs below.
 */

import { loadDomainPackage } from "../../src/domain/domainLoader.js";
import { allVariables } from "../../src/domain/types.js";
import { determineObjective, selectAction } from "../../src/engine/objective.js";
import { applyEvidence, emptyVariableState } from "../../src/engine/stateModel.js";
import type { StateMap } from "../../src/engine/types.js";

function complete(statement: string, satisfies: string[]): ReturnType<typeof applyEvidence> {
  return applyEvidence({
    current: emptyVariableState(),
    newEvidence: { type: "explicit", statement, satisfies },
    turn: 1,
    isContradiction: false,
    requiredSubAttributes: satisfies,
  });
}

console.log("=".repeat(70));
console.log("ATTEMPT 1 — naive domain package (3 type-specific variables)");
console.log("Customer profile: wants life insurance ONLY. Explicitly stated.");
console.log("=".repeat(70));
{
  const domain = loadDomainPackage("eval/domain/insurance-attempt-1-naive.yaml");
  const domainVars = allVariables(domain).map((v) => ({ name: v.name, importance: v.meta.importance }));

  const state: StateMap = {
    goal: complete("I want to make sure my family is financially protected if I die", [
      "desired_outcome",
      "business_reason",
    ]),
    current_situation: complete("I have no life insurance right now", ["has_existing_coverage", "coverage_adequacy"]),
    gap: complete("if something happens to me my family has no income replacement", ["primary_exposure"]),
    life_details: complete("I want term life, around $250k, my spouse as beneficiary", [
      "beneficiary_info",
      "coverage_amount",
    ]),
    // auto_details and health_details: no evidence at all — customer never
    // mentioned a car or health coverage, because they don't want those.
  };

  const result = determineObjective({
    state,
    domainVariables: domainVars,
    recommendationCompletionRequirement: domain.domain.recommendation.completion_requirement,
    pendingCustomerQuestion: null,
    lifecycle: "active", // interface-only param per B1, neutral value -- this demo isn't testing lifecycle
    recommendationDelivered: false, // this demo tests FIRST recommendations only
  });

  console.log(`\nCustomer has fully answered goal, current_situation, gap, AND life_details.`);
  if (result.kind !== "objective") {
    throw new Error(`Expected an "objective" outcome, got "${result.kind}" -- this demo's scenario shouldn't reach a terminal/error state.`);
  }
  console.log(`Engine's next objective: ${result.objective} -> target: "${result.target}"`);
  console.log(`Action: ${selectAction(result.objective)}`);
  console.log(
    `\nFRICTION: the agent's next move is to ask about "${result.target}" — irrelevant to a` +
      ` customer who explicitly said they only want life insurance. And produce_recommendation` +
      ` can never fire while auto_details/health_details remain unknown, because nothing in the` +
      ` current state model can mark a variable "not applicable" — it can only be unknown,` +
      ` partial, complete, or conflict. This customer would be asked about their car next.`
  );
}

console.log("\n" + "=".repeat(70));
console.log("RESOLVED — insurance.yaml (coarse-grained, mirrors website-development's shape)");
console.log("Same customer profile: wants life insurance only.");
console.log("=".repeat(70));
{
  const domain = loadDomainPackage("domains/insurance.yaml");
  const domainVars = allVariables(domain).map((v) => ({ name: v.name, importance: v.meta.importance }));

  const state: StateMap = {
    goal: complete("I want to make sure my family is financially protected if I die", [
      "desired_outcome",
      "business_reason",
    ]),
    current_situation: complete("I have no life insurance right now", ["situation_described"]),
    gap: complete("if something happens to me my family has no income replacement", ["primary_exposure"]),
    coverage_needs: complete("I want term life, around $250k, my spouse as beneficiary", ["coverage_scope"]),
    readiness: complete("I'd like to have this in place within the next month, I handle our finances", ["timeline"]),
  };

  const result = determineObjective({
    state,
    domainVariables: domainVars,
    recommendationCompletionRequirement: domain.domain.recommendation.completion_requirement,
    pendingCustomerQuestion: null,
    lifecycle: "active", // interface-only param per B1, neutral value -- this demo isn't testing lifecycle
    recommendationDelivered: false, // this demo tests FIRST recommendations only
  });

  if (result.kind !== "objective") {
    throw new Error(`Expected an "objective" outcome, got "${result.kind}".`);
  }
  console.log(`\nEngine's next objective: ${result.objective} -> target: "${result.target}"`);
  console.log(`Action: ${selectAction(result.objective)}`);
  console.log(
    `\nNo irrelevant variable exists to ask about. produce_recommendation fires as soon as the` +
      ` customer has genuinely said enough — same behavior website-development already has for a` +
      ` clean customer profile. Zero engine changes between this run and the one above.`
  );

  if (result.objective !== "produce_recommendation") {
    throw new Error("Expected produce_recommendation — resolved domain package did not behave as claimed.");
  }
  console.log("\nASSERTION PASSED: produce_recommendation reached cleanly.");
}
