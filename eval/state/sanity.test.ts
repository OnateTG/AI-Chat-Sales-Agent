/**
 * Evaluation Protocol §1.2 — State boundary tests.
 *
 * These are not invented cases — every one is transcribed directly from
 * State Model Specification's own worked examples (§4.2) or explicit rule
 * statements (§3.4, §5.2), so "expected" here is the spec's own text, not
 * my guess at reasonable behavior. Run with: npm run test:state
 */

import { applyEvidence, emptyVariableState, deriveConfidence, assertValidTransition, InvalidTransitionError } from "../../src/engine/stateModel.js";

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// State Model §4.2 worked example — goal completes across two turns
// ---------------------------------------------------------------------------
console.log("§4.2 — goal variable, two-turn completion");
{
  const required = ["desired_outcome", "business_reason"];

  // Turn 1: "I need a website." -> partial (desired_outcome only)
  const afterTurn1 = applyEvidence({
    current: emptyVariableState(),
    newEvidence: { type: "explicit", statement: "I need a website", satisfies: ["desired_outcome"] },
    turn: 1,
    isContradiction: false,
    requiredSubAttributes: required,
  });
  check("turn 1 status", afterTurn1.status, "partial");
  check("turn 1 confidence", afterTurn1.confidence, "high");

  // Turn 4: "I keep losing customers who can't find me online." -> complete
  const afterTurn4 = applyEvidence({
    current: afterTurn1,
    newEvidence: {
      type: "explicit",
      statement: "I keep losing customers who can't find me online",
      satisfies: ["business_reason"],
    },
    turn: 4,
    isContradiction: false,
    requiredSubAttributes: required,
  });
  check("turn 4 status", afterTurn4.status, "complete");
  check("turn 4 confidence (corroborating explicit entries -> high)", afterTurn4.confidence, "high");
  check("evidence list retains both entries (§3.3, never deleted)", afterTurn4.evidence.length, 2);
}

// ---------------------------------------------------------------------------
// State Model §5.2 — conflict sets status: conflict, confidence: null
// ---------------------------------------------------------------------------
console.log("\n§5.2 — conflict detection");
{
  const complete = applyEvidence({
    current: emptyVariableState(),
    newEvidence: { type: "explicit", statement: "no website yet", satisfies: ["has_existing_site"] },
    turn: 1,
    isContradiction: false,
    requiredSubAttributes: ["has_existing_site"],
  });
  check("pre-conflict status", complete.status, "complete");

  const conflicted = applyEvidence({
    current: complete,
    newEvidence: {
      type: "explicit",
      statement: "my current website isn't getting enquiries",
      satisfies: ["has_existing_site"],
    },
    turn: 3,
    isContradiction: true,
    requiredSubAttributes: ["has_existing_site"],
  });
  check("status after contradiction", conflicted.status, "conflict");
  check("confidence withheld during conflict (§5.2 rule 2)", conflicted.confidence, null);
  check("both entries retained (§5.2 rule 3 / §3.3)", conflicted.evidence.length, 2);
}

// ---------------------------------------------------------------------------
// State Model §3.4 — confidence derivation table
// ---------------------------------------------------------------------------
console.log("\n§3.4 — confidence derivation table");
{
  check(
    "single explicit -> high",
    deriveConfidence([{ type: "explicit", statement: "x", turn: 1, satisfies: [] }], "complete"),
    "high"
  );
  check(
    "single inferred -> medium",
    deriveConfidence([{ type: "inferred", statement: "x", turn: 1, satisfies: [] }], "partial"),
    "medium"
  );
  check(
    "single assumed -> low",
    deriveConfidence([{ type: "assumed", statement: "x", turn: 1, satisfies: [] }], "partial"),
    "low"
  );
  check(
    "conflict status withholds confidence regardless of evidence",
    deriveConfidence(
      [
        { type: "explicit", statement: "x", turn: 1, satisfies: [] },
        { type: "explicit", statement: "y", turn: 2, satisfies: [] },
      ],
      "conflict"
    ),
    null
  );
}

// ---------------------------------------------------------------------------
// State Model §2.2 — invalid transitions must throw
// ---------------------------------------------------------------------------
console.log("\n§2.2 — invalid transitions rejected");
{
  try {
    assertValidTransition("unknown", "conflict");
    check("unknown->conflict should have thrown", "did not throw", "InvalidTransitionError");
  } catch (e) {
    check("unknown->conflict throws InvalidTransitionError", e instanceof InvalidTransitionError, true);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
