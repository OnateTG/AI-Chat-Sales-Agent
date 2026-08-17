/**
 * State Model Specification — direct implementation.
 *
 * Everything here is a pure function. No LLM calls. No side effects beyond
 * returning new state. Per State Model §4.3: "two independent implementations
 * given the same domain definition and the same conversation must arrive at
 * the same status for every variable." Determinism is the whole point —
 * these functions must be referentially transparent.
 */

import type {
  VariableState,
  EvidenceEntry,
  EvidenceType,
  Status,
  Confidence,
} from "./types.js";

// ---------------------------------------------------------------------------
// §3.4 — Confidence derivation
// ---------------------------------------------------------------------------

/**
 * Confidence is a computed VIEW over the evidence list — never stored
 * independently, never frozen. Recalculate on every evidence change.
 *
 * Table (§3.4):
 *   single explicit, no contradiction        -> high
 *   single inferred, no contradiction         -> medium
 *   single assumed, no contradiction          -> low
 *   multiple consistent entries (any types)   -> high (corroboration)
 *   any unresolved contradiction              -> null (withheld)
 *   contradiction resolved by explicit clarif.-> recalculated from resolving entry
 */
export function deriveConfidence(evidence: EvidenceEntry[], status: Status): Confidence {
  if (status === "conflict") return null; // §5.2 rule 2: withhold confidence while conflict unresolved

  if (evidence.length === 0) return null;

  if (evidence.length === 1) {
    const t = evidence[0].type;
    if (t === "explicit") return "high";
    if (t === "inferred") return "medium";
    return "low"; // assumed
  }

  // Multiple entries. If we reached here, status is not "conflict", meaning
  // the caller has already determined these entries are consistent with
  // each other (a contradiction would have set status: conflict instead).
  // Multiple consistent entries reinforcing the same value -> high,
  // regardless of individual entry types (corroboration strengthens confidence).
  return "high";
}

// ---------------------------------------------------------------------------
// §2.2 — Status transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<Status, Status[]> = {
  unknown: ["partial", "complete"], // unknown -> conflict is invalid (needs 2+ evidence entries)
  partial: ["complete", "conflict", "partial"], // partial->partial: still incomplete after new consistent evidence
  complete: ["conflict", "complete"], // complete->complete: corroborating evidence, stays complete
  conflict: ["partial", "complete", "conflict"], // conflict->conflict: still unresolved after another turn
};

export class InvalidTransitionError extends Error {
  constructor(from: Status, to: Status) {
    super(
      `Invalid status transition: ${from} -> ${to}. ` +
        `Per State Model §2.2, no status may transition directly to "unknown" once evidence exists, ` +
        `and "unknown" cannot go directly to "conflict".`
    );
    this.name = "InvalidTransitionError";
  }
}

/** Throws if the transition isn't in State Model §2.2's valid transition table. */
export function assertValidTransition(from: Status, to: Status): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

// ---------------------------------------------------------------------------
// §4 — Completion criteria
// ---------------------------------------------------------------------------

/**
 * A variable is complete only when every required sub-attribute has been
 * satisfied by at least one piece of evidence, of ANY type (§4.1 — type
 * affects confidence, not completion). This is a checklist comparison, not
 * a judgment call (Runtime §Step 3).
 *
 * NOTE: sub-attribute satisfaction itself (e.g. "does this evidence list
 * satisfy `business_reason`?") is a semantic judgment Call A makes when it
 * classifies which sub-attribute a statement speaks to — this function only
 * does the mechanical part: given a set of already-classified evidence,
 * checks it covers every required sub-attribute. See callA.ts for where
 * sub-attribute tagging happens.
 */
export function isComplete(coveredSubAttributes: Set<string>, required: string[]): boolean {
  return required.every((attr) => coveredSubAttributes.has(attr));
}

// ---------------------------------------------------------------------------
// §5 — Conflict detection & the append-evidence state transition
// ---------------------------------------------------------------------------

export interface ApplyEvidenceParams {
  current: VariableState;
  newEvidence: Omit<EvidenceEntry, "turn">;
  turn: number;
  isContradiction: boolean; // Engine-confirmed, per Runtime §Step 2 (Call A only flags candidates)
  requiredSubAttributes: string[];
}

/**
 * The single mutation point for variable state. Implements §3.2 (append,
 * never overwrite), §5.2 (conflict behavior), and §2.2 (transition
 * validation) together, because in practice they always fire as one atomic
 * step: new evidence arrives -> append -> status transitions accordingly.
 *
 * Coverage is computed HERE, from the full persisted evidence list (old +
 * new), not passed in — this is what makes completion accumulate correctly
 * across turns (State Model §4.2's worked example: "I need a website" in
 * turn 1, "I keep losing customers..." in turn 4, jointly completing goal).
 */
export function applyEvidence(params: ApplyEvidenceParams): VariableState {
  const { current, newEvidence, turn, isContradiction, requiredSubAttributes } = params;

  // §3.3 — evidence is NEVER deleted. Always append to a new array (no mutation).
  const evidence: EvidenceEntry[] = [...current.evidence, { ...newEvidence, turn }];
  const coveredSubAttributesAfter = new Set(evidence.flatMap((e) => e.satisfies));

  let nextStatus: Status;

  if (isContradiction) {
    // §5.2 rule 1: set conflict immediately, regardless of prior status.
    nextStatus = "conflict";
  } else if (current.status === "conflict") {
    // Resolving a conflict (§5.3): only an explicit, unambiguous clarifying
    // statement should reach this branch with isContradiction=false. The
    // caller (pipeline.ts / Engine logic) is responsible for that check —
    // this function just applies the resulting status per completion.
    nextStatus = isComplete(coveredSubAttributesAfter, requiredSubAttributes) ? "complete" : "partial";
  } else {
    nextStatus = isComplete(coveredSubAttributesAfter, requiredSubAttributes) ? "complete" : "partial";
  }

  assertValidTransition(current.status, nextStatus);

  const confidence = deriveConfidence(evidence, nextStatus);

  return {
    value: deriveDisplayValue(evidence, nextStatus),
    status: nextStatus,
    evidence,
    confidence,
  };
}

/**
 * `value` is a plain-language summary for humans/Call B — not itself a
 * source of truth (the evidence list is). This is intentionally simple: the
 * most recent non-conflicting statement, or a joined view during conflict so
 * a clarifying question can reference both. Domains/Call B do the actual
 * natural-language phrasing; this just keeps something reasonable in state.
 */
function deriveDisplayValue(evidence: EvidenceEntry[], status: Status): string {
  if (status === "conflict") {
    const last = evidence[evidence.length - 1];
    const prior = evidence[evidence.length - 2];
    return `Conflicting: "${prior?.statement ?? ""}" vs "${last.statement}"`;
  }
  return evidence[evidence.length - 1]?.statement ?? "";
}

/** A fresh, empty variable state — the starting point before any evidence exists. */
export function emptyVariableState(): VariableState {
  return { value: null, status: "unknown", evidence: [], confidence: null };
}
