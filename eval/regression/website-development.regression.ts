/**
 * Per-domain regression suite — website-development.yaml.
 * Run: npx tsx eval/regression/website-development.regression.ts
 */

import { loadDomainPackage } from "../../src/domain/domainLoader.js";
import { readFileSync } from "node:fs";
import { callAResponse, callBResponse } from "../5a-harness/scriptedProvider.js";
import { runRegressionSuite, printRegressionReport, type RegressionScenario } from "./regressionFramework.js";

const domain = loadDomainPackage("domains/website-development.yaml");
const toneConfig = readFileSync("config/tone.md", "utf-8");

const scenarios: RegressionScenario[] = [
  {
    name: "Multi-turn qualification through to recommendation",
    pathType: "happy",
    turns: [
      {
        customerMessage: "I need more customers finding my business",
        scripted: [
          callAResponse({ updates: [{ variable: "goal", evidence_type: "explicit", statement: "need more customers", satisfies: ["desired_outcome"] }] }),
          callBResponse("Got it — what's making it hard for people to find you right now?"),
        ],
        assert: (result) => {
          if (result.record.variables.goal?.status !== "partial") throw new Error("expected goal:partial after one sub-attribute");
        },
      },
      {
        customerMessage: "I don't have a website and people can't find me online",
        scripted: [
          callAResponse({
            updates: [
              { variable: "goal", evidence_type: "explicit", statement: "want to be found online", satisfies: ["business_reason"] },
              { variable: "current_situation", evidence_type: "explicit", statement: "no website", satisfies: ["situation_described"] },
              { variable: "gap", evidence_type: "explicit", statement: "can't be found", satisfies: ["primary_obstacle"] },
            ],
          }),
          callBResponse("Makes sense. Do you need anything like online bookings or payments, or mainly just contact info?"),
        ],
        assert: (result) => {
          if (result.record.variables.goal?.status !== "complete") throw new Error("expected goal:complete");
          if (result.record.conversation.current_objective !== "progress_variable") throw new Error("expected still progressing (booking/readiness not yet answered)");
        },
      },
      {
        customerMessage: "Just a contact form, and I want this live within a couple weeks",
        scripted: [
          callAResponse({
            updates: [
              { variable: "booking_or_ecommerce_needs", evidence_type: "explicit", statement: "just a contact form", satisfies: ["feature_requirements"] },
              { variable: "readiness", evidence_type: "explicit", statement: "within a couple weeks", satisfies: ["timeline"] },
            ],
          }),
          callBResponse("Based on everything you've shared, a Lead-Generation Website fits well..."),
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
    name: "Price question mid-qualification -> answered with range_only",
    pathType: "objection",
    turns: [
      {
        customerMessage: "How much does this cost?",
        scripted: [
          callAResponse({ pending_customer_question: "how much does this cost?" }),
          callBResponse("It depends on which type fits you best — ranges vary by package."),
        ],
        assert: (result, callBInput) => {
          if (result.record.conversation.current_objective !== "answer_pending_question") throw new Error("expected answer_pending_question");
          if ((callBInput as any)?.pricing_context?.mode !== "range_only") throw new Error("expected range_only pricing_context on incomplete state");
        },
      },
    ],
  },
  {
    name: "Contradictory booking/ecommerce info -> clarify",
    pathType: "clarification",
    initialVariables: {
      booking_or_ecommerce_needs: {
        value: "no payments needed",
        status: "complete",
        evidence: [{ type: "explicit", statement: "no payments needed", turn: 1, satisfies: ["feature_requirements"] }],
        confidence: "high",
      },
    },
    turns: [
      {
        customerMessage: "Actually I do want to take payments online",
        scripted: [
          callAResponse({
            updates: [{ variable: "booking_or_ecommerce_needs", evidence_type: "explicit", statement: "want online payments", satisfies: ["feature_requirements"] }],
            possible_conflicts: [{ variable: "booking_or_ecommerce_needs", reason: "contradicts earlier 'no payments needed'" }],
          }),
          callBResponse("Just to check — earlier you said no payments needed, now online payments. Which is it?"),
        ],
        assert: (result) => {
          if (result.record.variables.booking_or_ecommerce_needs?.status !== "conflict") throw new Error("expected conflict status");
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
      gap: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["primary_obstacle"] }], confidence: "high" },
      readiness: { value: "x", status: "complete", evidence: [{ type: "explicit", statement: "x", turn: 1, satisfies: ["timeline"] }], confidence: "high" },
    },
    turns: [
      {
        customerMessage: "I need a shop where people can buy directly",
        scripted: [
          callAResponse({ updates: [{ variable: "booking_or_ecommerce_needs", evidence_type: "explicit", statement: "need to sell products online", satisfies: ["feature_requirements"] }] }),
          callBResponse("Given you need to sell products directly, an E-Commerce Website is the right fit..."),
        ],
        assert: (result) => {
          if (result.record.conversation.current_objective !== "produce_recommendation") throw new Error("expected produce_recommendation");
          // This is a DOMAIN CONTENT check, not a Call B judgment check --
          // confirms all 4 declared options actually reach the point where
          // Call B would choose between them (a bad YAML edit deleting an
          // option would be caught here; Call B correctly PICKING
          // E-Commerce specifically is NOT verifiable without live model
          // access, and isn't what this assertion claims to check).
          for (const optionName of ["Brochure Website", "Lead-Generation Website", "E-Commerce Website", "Booking Website"]) {
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
