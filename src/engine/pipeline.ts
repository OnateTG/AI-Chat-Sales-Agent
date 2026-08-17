/**
 * Runtime Specification §2 — the six-step pipeline, orchestrated.
 *
 *   Customer message
 *     -> [1] Extract & Update State     (Call A + Engine append)
 *     -> [2] Detect Conflicts            (Call A flags, Engine confirms)
 *     -> [3] Evaluate Completion         (Engine, mechanical)
 *     -> [4] Determine Objective         (Engine, priority order, tri-state)
 *     -> [5] Select Action               (Engine, lookup)
 *     -> [6] Generate Response           (Call B)
 *     -> Response + Updated State
 *
 * This file is the only place that calls both llm/ and engine/ — everything
 * downstream of Call A is deterministic engine logic (Runtime §4's
 * responsibility summary), no LLM call, until Call B.
 */

import { runCallA } from "../llm/callA.js";
import { runCallB } from "../llm/callB.js";
import type { ChatCompletionFn } from "../llm/router.js";
import { applyEvidence, emptyVariableState, isComplete } from "./stateModel.js";
import { determineObjective, selectAction, type DomainVariableMeta } from "./objective.js";
import { resolveLifecycle } from "./lifecycle.js";
import { resolvePricingContext } from "./pricing.js";
import { allVariables, type DomainPackage } from "../domain/types.js";
import type { ConversationRecord, TurnEvent, StateMap, CallBInput } from "./types.js";
import pino from "pino";

const logger = pino({ name: "pipeline" });

// Delta C (ADL-021): renamed from RunTurnParams. Names are architecture —
// this IS, and was, a per-turn execution snapshot (verified empirically,
// ADL-020: `domain` is threaded by value from the top of the webhook
// handler, never re-fetched from the mutable domainRef mid-turn, so a
// hot-reload during processing cannot affect an in-flight turn). The
// rename makes the vocabulary match the concept; behavior is unchanged.
export interface TurnContext {
  record: ConversationRecord;
  event: TurnEvent;
  domain: DomainPackage;
  toneConfig: string;
  // Item 5A (Validation Harness) injection seam — undefined in production,
  // where runCallA/runCallB fall back to the real chatCompletion. NOT part
  // of the six-document spec; purely a testing seam.
  chatCompletionFn?: ChatCompletionFn;
}

export interface RunTurnResult {
  record: ConversationRecord; // updated
  // null specifically means: determineObjective() produced an "error"
  // outcome (Delta C) — a genuine kernel gap, Problem B's territory. The
  // caller MUST treat null as "needs human handoff," not as "nothing to
  // do." A "no_objective" outcome (legitimate terminal state) is NOT
  // this case anymore — it produces a real reply, see below.
  reply: string | null;
  requiresHumanHandoff?: boolean;
}

export async function runTurn(params: TurnContext): Promise<RunTurnResult> {
  const { domain, toneConfig } = params;
  let { record } = params;
  const event = params.event;

  if (event.type !== "inbound_message") {
    // Only entry point implemented right now — see ADL-005 and
    // ARCHITECTURE.md's note on TurnEvent typing.
    throw new Error(`Unsupported turn event type: ${event.type}`);
  }

  const turn = record.turn + 1;
  const domainVars = allVariables(domain);
  const domainVariablesForCallA = Object.fromEntries(
    domainVars.map((dv) => [dv.name, { description: dv.meta.description, completion: dv.meta.completion }])
  );

  // ---- Step 1 + 2: Call A (extraction, evidence classification, conflict flags) ----
  const callAOutput = await runCallA(
    {
      customerMessage: event.text,
      recentHistory: [], // TODO: wire real recent-history windowing from store
      currentState: record.variables,
      domainVariables: domainVariablesForCallA,
    },
    params.chatCompletionFn
  );

  let variables: StateMap = { ...record.variables };

  for (const update of callAOutput.updates) {
    const current = variables[update.variable] ?? emptyVariableState();

    // §5.1: conflict detection is per-variable, comparing new evidence
    // against the value CURRENTLY derived from existing evidence. Call A's
    // possible_conflicts is the candidate flag; here we confirm it (Runtime
    // §Step 2: "Engine confirms and finalizes conflict status").
    const flaggedByCallA = callAOutput.possible_conflicts.some((c) => c.variable === update.variable);
    const isContradiction = flaggedByCallA && current.status !== "unknown";

    const requiredSubAttrs = domainVariablesForCallA[update.variable]?.completion.required ?? [];

    variables[update.variable] = applyEvidence({
      current,
      newEvidence: { type: update.evidence_type, statement: update.statement, satisfies: update.satisfies },
      turn,
      isContradiction,
      requiredSubAttributes: requiredSubAttrs,
    });
  }

  // ---- Step 3: Evaluate Completion ----
  // Already applied inline above via applyEvidence's isComplete() call —
  // Step 3 is folded into Step 1's state application here since both are
  // mechanical and operate on the same evidence-append event. Kept as a
  // separate exported function (stateModel.isComplete) so it's independently
  // testable per Evaluation Protocol §1.2, even though it's not a separate
  // pass over the data in this implementation.

  // ---- Step 4 + 5: Determine Objective (tri-state), Select Action ----
  const domainVariableMeta: DomainVariableMeta[] = domainVars.map((dv) => ({
    name: dv.name,
    importance: dv.meta.importance,
  }));

  const lifecycleResult = resolveLifecycle({
    current: record.conversation.lifecycle,
    proposed: callAOutput.proposed_lifecycle,
  });

  // Per ObjectiveOutcome's invariants (types.ts): determineObjective() is
  // the ONLY producer of this outcome. Everything below consumes it
  // read-only — no branch here reinterprets or rewrites `outcome.kind`.
  const outcome = determineObjective({
    state: variables,
    domainVariables: domainVariableMeta,
    recommendationCompletionRequirement: domain.domain.recommendation.completion_requirement,
    pendingCustomerQuestion: callAOutput.pending_customer_question,
    lifecycle: lifecycleResult.lifecycle,
    recommendationDelivered: record.conversation.recommendation_delivered ?? false,
  });

  if (outcome.kind === "error") {
    // Genuine kernel gap — Problem B's territory. Do NOT guess a reply.
    // No automated message goes out; flagged for human handoff. Logged as
    // a monitored signal at the caller (handleInboundMessage.ts), not here.
    logger.error({ reason: outcome.reason }, "ObjectiveOutcome: error -- no valid objective, routing to human handoff");
    const updatedRecord: ConversationRecord = {
      ...record,
      turn,
      variables,
      conversation: {
        ...record.conversation,
        lifecycle: lifecycleResult.lifecycle,
        last_customer_activity: event.timestamp,
        last_agent_activity: new Date().toISOString(),
      },
    };
    return { record: updatedRecord, reply: null, requiresHumanHandoff: true };
  }

  // ---- Pricing (Domain Package §4 — business section, Engine-evaluated rule) ----
  const pricingContext = resolvePricingContext(
    domain.business?.pricing ?? null,
    variables,
    domain.domain.recommendation.completion_requirement
  );

  const commonCallBInput = {
    recent_history: [],
    customer_message: event.text,
    finalized_state: Object.fromEntries(
      Object.entries(variables).map(([k, v]) => [k, { value: v.value, status: v.status, confidence: v.confidence }])
    ),
    conversation_lifecycle: lifecycleResult.lifecycle,
    pricing_context: pricingContext,
    tone_config: toneConfig,
  };

  // ---- Step 6: Generate Response ----
  let callBInput: CallBInput;
  let trackedObjective: string | null;
  let trackedTarget: string | null;

  if (outcome.kind === "no_objective") {
    // Legitimate terminal state — no directive. Call B responds naturally
    // per Prompt Spec §3.4's realization guidance. No business_knowledge
    // lookup here: that's tied to specific actions (answer/recommend),
    // neither of which applies when there's no directive at all.
    callBInput = { ...commonCallBInput, outcome: "no_objective", business_knowledge_snippet: null };
    trackedObjective = null;
    trackedTarget = null;
  } else {
    // outcome.kind === "objective" — TypeScript narrows this from the two
    // branches above already having returned/handled.
    const { objective, target } = outcome;
    const action = selectAction(objective);
    const actionTarget = target ?? (objective === "produce_recommendation" ? pickRecommendation(domain) : "");
    const businessKnowledgeSnippet =
      action === "answer" || action === "recommend" ? snippetFor(domain, callAOutput.pending_customer_question) : null;

    callBInput = {
      ...commonCallBInput,
      outcome: "objective",
      selected_action: action,
      action_target: actionTarget,
      business_knowledge_snippet: businessKnowledgeSnippet,
    };
    trackedObjective = objective;
    trackedTarget = target;
  }

  const reply = await runCallB(callBInput, params.chatCompletionFn);

  // Misbehavior tracking (Operations checklist) — scoped exactly as before
  // to the "objective" outcome only, deliberately not extended to
  // "no_objective" (repeatedly landing there is much more likely to be
  // normal post-recommendation small talk than a stuck conversation) or
  // "error" (already individually logged as a monitored signal at every
  // occurrence in handleInboundMessage.ts, not just after N repeats).
  // Scoping choice stated explicitly, not silently narrowed.
  const sameAsLastTime = record.last_objective === trackedObjective && record.last_target === trackedTarget;
  const repeatCount = trackedObjective !== null && sameAsLastTime ? record.repeat_count + 1 : record.repeat_count;

  const updatedRecord: ConversationRecord = {
    ...record,
    turn,
    variables,
    conversation: {
      lifecycle: lifecycleResult.lifecycle,
      current_objective: outcome.kind === "objective" ? outcome.objective : null,
      last_customer_activity: event.timestamp,
      last_agent_activity: new Date().toISOString(),
      // Set once produce_recommendation actually fires and Call B succeeds
      // -- this is the flag the B1 gate checks on the NEXT turn. Sticky:
      // once true, stays true for the rest of the conversation.
      recommendation_delivered:
        record.conversation.recommendation_delivered || (outcome.kind === "objective" && outcome.objective === "produce_recommendation"),
    },
    last_objective: trackedObjective ?? record.last_objective,
    last_target: trackedTarget,
    repeat_count: repeatCount,
  };

  return { record: updatedRecord, reply };
}

function pickRecommendation(domain: DomainPackage): string {
  // Domain Package §4.1: matching is left to Call B's language
  // understanding of `fits_when`, not a rule engine (Evaluation Protocol §5
  // — don't pre-engineer this). We still need SOME action_target string to
  // pass through; pass all options and let Call B reason over fits_when
  // itself, consistent with that deferral.
  return domain.domain.recommendation.available_options.map((o) => `${o.name}: ${o.fits_when}`).join(" | ");
}

function snippetFor(domain: DomainPackage, question: string | null): string | null {
  if (!question) return null;
  // Naive keyword match for now — a real retrieval step over
  // business_knowledge.topics is a natural hardening pass, not attempted here.
  const lower = question.toLowerCase();
  const hit = domain.business_knowledge.topics.find((t) => lower.includes(t.topic.toLowerCase().split(" ")[0]));
  return hit?.content ?? domain.business_knowledge.topics.map((t) => `${t.topic}: ${t.content}`).join("\n");
}
