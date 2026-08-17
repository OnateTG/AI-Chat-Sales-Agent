/**
 * Per-domain regression suite — insurance.yaml.
 * Same framework as website-development's, zero framework changes needed
 * — proving the "reusable across domains" requirement for real, not just
 * asserting it.
 * Run: npx tsx eval/regression/insurance.regression.ts
 */

import { loadDomainPackage } from "../../src/domain/domainLoader.js";
import { readFileSync } from "node:fs";
import { callAResponse, callBResponse } from "../5a-harness/scriptedProvider.js";
import { runRegressionSuite, printRegressionReport, type RegressionScenario } from "./regressionFramework.js";

const domain = loadDomainPackage("domains/insurance.yaml");
const toneConfig = readFileSync("config/tone.md", "utf-8");

const scenarios: RegressionScenario[] = [
  {
    name: "Multi-turn qualification through to recommendation (life insurance)",
    pathType: "happy",
    turns: [
      {
        customerMessage: "I want to protect my family financially if something happens to me",
        scripted: [
          callAResponse({ updates: [{ variable: "goal", evidence_type: "explicit", statement: "protect family financially", satisfies: ["desired_outcome"] }] }),
          callBResponse("Understood — what's prompting you to look into this now?"),
        ],
        assert: (result) => {
          if (result.record.variables.goal?.status !== "partial") throw new Error("expected goal:partial");
        },
      },
      {
        customerMessage: "I have no coverage right now and my income is our only safety net",
        scripted: [
          callAResponse({
            updates: [
              { variable: "goal", evidence_type: "explicit", statement: "income is the only safety net", satisfies: ["business_reason"] },
              { variable: "current_situation", evidence_type: "explicit", statement: "no coverage", satisfies: ["situation_described"] },
              { variable: "gap", evidence_type: "explicit", statement: "no income replacement if I die", satisfies: ["primary_exposure"] },
            ],
          }),
          callBResponse("That's a real gap. What kind of coverage amount were you thinking, and how soon do you want this in place?"),
        ],
        assert: (result) => {
          if (result.record.variables.current_situation?.status !== "complete") throw new Error("expected current_situation:complete");
        },
      },
      {
        customerMessage: "Around $250k, and I'd like this sorted within a month",
        scripted: [
          callAResponse({
            updates: [
              { variable: "coverage_needs", evidence_type: "explicit", statement: "around $250k term life", satisfies: ["coverage_scope"] },
              { variable: "readiness", evidence_type: "explicit", statement: "within a month", satisfies: ["timeline"] },
            ],
          }),
          callBResponse("Based on what you've shared, Life Insurance fits — here's why..."),
        ],
        assert: (result, callBInput) => {
          if (result.record.conversation.current_objective !== "produce_recommendation") throw new Error("expected produce_recommendation");
          if (result.record.conversation.recommendation_delivered !== true) throw new Error("recommendation_delivered did not flip");
          if (!callBInput) throw new Error("Call B was never actually called");
        },
      },
    ],
  },
  {
    name: "Coverage cost question mid-qualification -> answered with range_only",
    pathType: "objection",
    turns: [
      {
        customerMessage: "What does this typically cost?",
        scripted: [
          callAResponse({ pending_customer_question: "what does this typically cost?" }),
          callBResponse("It varies quite a bit by age, health, and coverage amount — here's a general range..."),
        ],
        assert: (result, callBInput) => {
          if (result.record.conversation.current_objective !== "answer_pending_question") throw new Error("expected answer_pending_question");
          if ((callBInput as any)?.pricing_context?.mode !== "range_only") throw new Error("expected range_only pricing_context on incomplete state");
        },
      },
    ],
  },
  {
    name: "Contradictory coverage info -> clarify",
    pathType: "clarification",
    initialVariables: {
      coverage_needs: {
        value: "just auto coverage, no life insurance needed",
        status: "complete",
        evidence: [{ type: "explicit", statement: "just auto coverage, no life insurance needed", turn: 1, satisfies: ["coverage_scope"] }],
        confidence: "high",
      },
    },
    turns: [
      {
        customerMessage: "Actually I also want to look at life insurance now",
        scripted: [
          callAResponse({
            updates: [{ variable: "coverage_needs", evidence_type: "explicit", statement: "also wants life insurance", satisfies: ["coverage_scope"] }],
            possible_conflicts: [{ variable: "coverage_needs", reason: "contradicts earlier 'no life insurance needed'" }],
          }),
          callBResponse("Just to check — earlier it was just auto, now life insurance too. Want both, or has your need changed?"),
        ],
        assert: (result) => {
          if (result.record.variables.coverage_needs?.status !== "conflict") throw new Error("expected conflict status");
          if (result.record.conversation.current_objective !== "resolve_conflict") throw new Error("expected resolve_conflict");
        },
      },
    ],
  },
  {
    name: "Recommendation content wiring — all 4 available_options reach Call B",
    pathType: "recommendation",
    initialVariables: {
      goal: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["desired_outcome", "business_reason"] }], confidence: "high" },
      current_situation: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["situation_described"] }], confidence: "high" },
      gap: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["primary_exposure"] }], confidence: "high" },
      readiness: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["timeline"] }], confidence: "high" },
    },
    turns: [
      {
        customerMessage: "I need to cover my rental property",
        scripted: [
          callAResponse({ updates: [{ variable: "coverage_needs", evidence_type: "explicit", statement: "cover a rental property", satisfies: ["coverage_scope"] }] }),
          callBResponse("Given you need to protect a rental property, Property Insurance fits well..."),
        ],
        assert: (result) => {
          if (result.record.conversation.current_objective !== "produce_recommendation") throw new Error("expected produce_recommendation");
          for (const optionName of ["Auto Insurance", "Life Insurance", "Health Insurance", "Property Insurance"]) {
            const found = domain.domain.recommendation.available_options.some((o) => o.name === optionName);
            if (!found) throw new Error(`expected available_options to include "${optionName}" -- domain content regression`);
          }
        },
      },
    ],
  },
];

runRegressionSuite(domain, toneConfig, scenarios).then((result) => {
  const allPassed = printRegressionReport(result);
  process.exit(allPassed ? 0 : 1);
});
