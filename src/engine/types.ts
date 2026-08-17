/**
 * Core kernel types.
 *
 * Every enum here is a direct, literal transcription from the spec —
 * not a paraphrase. If a spec changes an enum, this file changes with it,
 * and every downstream usage becomes a compile error until fixed. That's
 * the point of using TypeScript for this layer.
 */

// ---- State Model Specification §2.1 ----
export type Status = "unknown" | "partial" | "complete" | "conflict";

// ---- State Model Specification §3.1 ----
export type EvidenceType = "explicit" | "inferred" | "assumed";

// ---- State Model Specification §3.4 ----
export type Confidence = "high" | "medium" | "low" | null;

// ---- State Model Specification §1 ----
export interface EvidenceEntry {
  type: EvidenceType;
  statement: string;
  turn: number;
  // Which completion.required sub-attributes this entry satisfies. Part of
  // the ADL-008 extension — needs to persist ON the evidence entry (not just
  // pass through as a transient update field) so completion can accumulate
  // correctly across multiple turns, per State Model §4.2's worked example.
  satisfies: string[];
}

export interface VariableState {
  value: string | null;
  status: Status;
  evidence: EvidenceEntry[]; // ordered, oldest first. APPEND ONLY — never mutate/delete (§3.2, §3.3)
  confidence: Confidence;
}

/** All tracked variables for one conversation, keyed by variable name. */
export type StateMap = Record<string, VariableState>;

// ---- Runtime Specification §Step 4 / §Step 5 ----
// Exactly four objectives, confirmed exhaustive (ADL-001). No "acknowledge",
// no "close" — see docs/ADL.md entries 001 and 007 before changing this.
export type Objective =
  | "resolve_conflict"
  | "answer_pending_question"
  | "progress_variable"
  | "produce_recommendation";

export type Action = "clarify" | "answer" | "ask" | "recommend";

// ---- Delta C (production hardening, ADL-021) — ObjectiveOutcome ----
//
// Replaces the old throw-based ObjectiveResult/NoValidObjectiveError
// design. Three outcomes, not a binary success/throw:
//   - "objective": a valid objective exists and should drive the turn
//   - "no_objective": legitimately nothing to do — post-recommendation
//     terminal states (lifecycle moving toward completed/paused/escalated)
//     are the known examples. NOT an error. Routes to Call B with no
//     directive, per Prompt Spec §3.4's realization guidance.
//   - "error": the conversation is still in a state where an objective
//     SHOULD exist (lifecycle active, recommendation not yet delivered)
//     but none can be determined. A genuine, real failure — this is
//     Problem B's territory (statement-phrased messages not recognized).
//
// INVARIANT 1 — Single ownership. Only determineObjective() (objective.ts)
// may produce this outcome. No downstream component (pipeline.ts,
// callB.ts, handleInboundMessage.ts) reinterprets, upgrades, or downgrades
// it. If a downstream stage finds something inconsistent with the outcome
// it was handed, that is a NEW error at that stage — never a silent
// rewrite of the outcome determineObjective() already produced.
//
// INVARIANT 2 — Immutable once produced. Nothing later in the pipeline
// converts "objective" into "no_objective", or "error" into either of the
// others, or vice versa in any direction. Treat every ObjectiveOutcome as
// read-only from the moment determineObjective() returns it.
//
// "no_objective" is NOT a disguised fifth Objective — Objective above
// stays exactly four values. This is a property of the RETURN TYPE, the
// same category-error correction already made once for `acknowledge`
// (ADL-001): realization/no-directive-needed is a Call B concern, not an
// objective-selection concern.
export type ObjectiveOutcome =
  | { kind: "objective"; objective: Objective; target: string | null }
  | { kind: "no_objective" }
  | { kind: "error"; reason: string };

// ---- Runtime Specification §7 ----
export type Lifecycle = "active" | "paused" | "completed" | "abandoned" | "escalated";

export interface ConversationState {
  lifecycle: Lifecycle;
  current_objective: Objective | null;
  last_customer_activity: string | null; // ISO timestamp
  last_agent_activity: string | null; // ISO timestamp
  // Added for the B1 gating fix (production handoff item 1, Arch1/Arch2
  // agreed design direction). Deliberately a bare boolean, NOT the full
  // dormant `decision` property from Runtime §7.1 (recommendation +
  // rationale) — that's still an unauthorized, unbuilt extension point per
  // its own explicit "don't build speculatively" instruction. This flag is
  // authorized because it's the literal, explicit fix for an observed,
  // reproduced bug (repeated produce_recommendation firing), not a
  // speculative addition. Don't expand it toward `decision`'s shape without
  // that being its own reviewed step.
  recommendation_delivered: boolean;
}

/** Full persisted state for one lead/conversation. */
export interface ConversationRecord {
  phone: string;
  variables: StateMap;
  conversation: ConversationState;
  turn: number;
  // Per production handoff's versioning requirement. Deliberately a
  // sibling of `conversation`, not nested inside it — this is deployment/
  // platform metadata (which config generated this conversation), not
  // kernel-modeled conversation state per Runtime §7's definition of that
  // object. Set once at record creation; if config can change mid-
  // conversation, whether this should update is an open question, not
  // addressed here.
  business_package_version: string | null;
  // Operations kill switch. Deliberately NOT the same thing as
  // `conversation.lifecycle === "escalated"` — checked against the
  // Governance Principle before adding this, not assumed: `escalated` is
  // customer-initiated (Call A proposes it from what the customer said);
  // this is operator-initiated and must work regardless of what lifecycle
  // currently is or what the customer has said. Genuinely a different
  // concept, not a duplicate. Lives outside `conversation` for the same
  // reason `business_package_version` does — operations metadata, not
  // kernel-modeled state.
  automation_paused: boolean;
  paused_reason: string | null;
  paused_at: string | null;
  paused_by: string | null;
  // Conversational-misbehavior tracking (Operations checklist item).
  // Tracks (objective, target) pairs specifically, not objective alone —
  // progress_variable firing repeatedly is normal/healthy as long as the
  // TARGET changes each time (that's just qualifying variables in
  // sequence); the actual stuck-signal is the same target repeating.
  last_objective: string | null;
  last_target: string | null;
  repeat_count: number;
}

// ---- Runtime §1: pipeline entry point ----
// Typed as an event, not hardcoded to "customer message", per ADL-005.
// Only `inbound_message` is implemented. This costs nothing now and avoids
// a signature change if/when nurture introduces an agent-initiated type.
export type TurnEvent = { type: "inbound_message"; text: string; timestamp: string };

// ---- Prompt Specification §2.3: Call A output ----
// NOTE: `satisfies` is NOT in the reviewed Prompt Specification. It's a
// minimal extension added here to make Runtime §Step 3 (completion
// checking) actually mechanical, per State Model §4.1's per-sub-attribute
// requirement. See docs/ADL.md entry 008 before assuming this is settled.
export interface CallAUpdate {
  variable: string;
  evidence_type: EvidenceType;
  statement: string;
  satisfies: string[]; // which of the variable's completion.required sub-attributes this addresses
}

export interface CallAPossibleConflict {
  variable: string;
  reason: string;
}

export interface CallAOutput {
  updates: CallAUpdate[];
  possible_conflicts: CallAPossibleConflict[];
  pending_customer_question: string | null;
  proposed_lifecycle: Lifecycle;
}

// ---- Domain Package §5: pricing ----
export type PricingMode = "range_only" | "exact_quote_allowed";

export interface PricingContext {
  mode: PricingMode;
  ranges: Record<string, string>;
}

// ---- Prompt Specification §3.2: Call B input ----
//
// Restructured (Delta C, ADL-021) from a flat interface with
// `selected_action: Action` to a discriminated union mirroring
// ObjectiveOutcome's shape, per explicit design decision: a bare
// `Action | null` would leave "null" ambiguous between "no objective" and
// "not yet computed" — the discriminant makes that distinction structural
// instead of a convention someone has to remember.
//
// The "error" variant is included for the SAME reason ObjectiveOutcome
// has three members, even though in the current pipeline.ts flow it is
// never actually constructed or passed to runCallB() — the "error" case
// short-circuits to a null reply before a CallBInput would ever be built.
// Keeping the type a faithful mirror means if a future ObjectiveOutcome
// member is ever added, every CallBInput construction site fails to
// compile until updated too — the coupling is enforced by the type
// checker, not by someone remembering to keep two switch statements in
// sync by hand.
interface CallBCommonInput {
  recent_history: string[];
  customer_message: string;
  finalized_state: Record<string, Pick<VariableState, "value" | "status" | "confidence">>;
  conversation_lifecycle: Lifecycle;
  business_knowledge_snippet: string | null;
  pricing_context: PricingContext | null;
  tone_config: string;
}

type CallBDirective =
  | { outcome: "objective"; selected_action: Action; action_target: string }
  | { outcome: "no_objective" }
  | { outcome: "error"; error: string }; // see note above — structurally unreachable via runCallB() today, kept for exhaustiveness coupling

export type CallBInput = CallBCommonInput & CallBDirective;
