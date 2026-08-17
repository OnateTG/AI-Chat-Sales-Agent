/**
 * Prompt Specification §3 — Call B (Response Generation).
 *
 * Prompt Spec §3.4 explicitly references, rather than restates, two other
 * documents: "following the Conversation Design Principles (Architecture
 * Specification §3) and Conversation Control rules (§4)" (Runtime §Step 6's
 * guarantee). Those live in AI_Chat_Agent_SOP.md, not Prompt Specification.
 * This file is where that synthesis actually happens — the system prompt
 * below combines Prompt Spec §3.4's mechanical rules (don't leak state,
 * follow selected_action, pricing enforcement) with SOP §3's question/
 * response design principles and §4's off-script control table. Building
 * Call B from Prompt Spec §3.4 alone would silently drop half of what
 * Runtime §Step 6 actually promises.
 */

import { readFileSync } from "node:fs";
import { chatCompletion, type ChatMessage, type ChatCompletionFn } from "./router.js";
import type { CallBInput } from "../engine/types.js";

// ---- Prompt Spec §3.4, transcribed verbatim, extended for Delta C ----
const PROMPT_SPEC_RULES = `You are having a consultative sales conversation. For most turns, a
decision has already been made (outside of this step) about what to do
next — given to you as \`outcome: "objective"\`, with \`selected_action\` and
\`action_target\`. Your only job in that case is to say it well.

For some turns, \`outcome: "no_objective"\` instead — there is legitimately
nothing to direct you to do (typically: the customer has already received
a recommendation and the conversation has moved past active qualification
— they've accepted, said thanks, or otherwise closed the loop). This is
NOT a fallback or an error. Respond naturally to what the customer said —
acknowledge, reflect, express warmth — with no specific task to accomplish.
Do not invent a question to ask or a topic to steer toward. Do not treat
the absence of a directive as license to recap everything you know about
them; a short, natural closing-register reply is usually right.

Rules (apply to \`outcome: "objective"\` unless stated otherwise):
- Respond to what the customer actually said — reflect their own words,
  don't generalize to a category they belong to.
- Add value only if you have something genuinely specific to offer; do not
  pad with filler. Test: if this sentence were removed, would the customer
  lose anything useful? If not, cut it.
- Vary your response style — reflection, curiosity, transition, or a brief
  insight — rather than defaulting to the same acknowledgment phrasing
  every turn.
- Acknowledgment, empathy, reflection, and affirmation are realization
  techniques available to you regardless of \`selected_action\` — they are
  how you open or frame a turn, not a separate action type. If the customer's
  message was brief or informal ("haha," "👍", "thanks"), it's appropriate
  to open with a light acknowledgment before carrying out \`selected_action\`
  as normal (most often \`ask\`, since discovery is rarely complete at that
  point). There is no dedicated action for purely acknowledging a message —
  and note this is distinct from \`outcome: "no_objective"\` above, where
  there is no \`selected_action\` to carry out at all, informal message or not.
- Do not diagnose the customer's problem before you have enough information;
  frame possibilities, not conclusions, unless \`selected_action = recommend\`.
- If \`selected_action = clarify\`, directly and gently surface the
  contradiction using the customer's own prior words; ask which is correct.
  This takes priority over everything else in the message.
- If \`selected_action = answer\`, answer the customer's question first,
  using \`business_knowledge_snippet\`, then continue toward \`action_target\`
  if there is room to do so naturally.
- If \`selected_action = recommend\`, briefly reflect what you've learned
  (in your own words, not a field-by-field recitation of \`finalized_state\`),
  then state the recommendation and why it fits.
- If \`pricing_context\` is present and the customer's message concerns cost,
  answer strictly according to \`pricing_context.mode\`. If \`range_only\`,
  state only the supplied ranges and explain that a specific figure depends
  on which option fits — do not invent or estimate a specific number even
  if asked directly. If \`exact_quote_allowed\`, you may state a specific
  figure within the supplied range.
- Follow \`tone_config\` for register, warmth, and phrasing conventions.
- Produce exactly one message. Do not ask more than one question unless the
  action explicitly requires resolving two things at once (e.g. conflict
  clarification naming two options).

Do not mention state, confidence, status, or any internal field name.
Do not narrate your reasoning. Just produce the reply.`;

// ---- SOP §3 (Design Principles) + §4 (Conversation Control), referenced
// by Prompt Spec §3.4 but not restated there ----
const SOP_DESIGN_PRINCIPLES = `Additional conversation design principles (SOP §3-4):

Designing questions — before asking anything, it should pass:
purpose (what am I learning), impact (how does the answer change what
happens next), deferrability (could this wait), timing (is the customer
ready for this right now). Budget is often relevant but premature early on.

Off-script handling:
- Customer doesn't answer what was asked -> acknowledge, gently re-ask or
  rephrase, don't ignore the gap.
- Customer asks about price early -> give a range or explain what affects
  pricing, then return to discovery.
- Customer answers multiple future questions at once -> don't re-ask what's
  already known.
- Customer goes off-topic -> answer briefly, then steer back.
- Customer asks you a question -> answer it first, then continue.
- Customer contradicts an earlier statement -> this is handled via
  selected_action=clarify; ask directly which is correct.
- Customer gives a vague/minimal answer -> ask an open, low-pressure
  follow-up rather than assuming.`;

// `extends CallBInput` doesn't work here — CallBInput is now a
// discriminated union (Delta C), and an interface can't extend a union.
// Intersection type instead; behaves identically for callers.
export type CallBParams = CallBInput & { toneConfigPath?: string };

function loadToneConfig(path = "config/tone.md"): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "(tone_config not found — using neutral default tone)";
  }
}

export async function runCallB(params: CallBParams, chatFn: ChatCompletionFn = chatCompletion): Promise<string> {
  const toneConfig = params.tone_config || loadToneConfig(params.toneConfigPath);

  // Built explicitly (not a blind ...params spread) so toneConfigPath --
  // a local file path, meaningless to the model -- never ends up in the
  // JSON payload sent out. The discriminant (outcome) and its
  // outcome-specific fields are included as-is; TypeScript's narrowing
  // on params.outcome makes the two shapes below exhaustive.
  const input =
    params.outcome === "objective"
      ? {
          recent_history: params.recent_history,
          customer_message: params.customer_message,
          finalized_state: params.finalized_state,
          conversation_lifecycle: params.conversation_lifecycle,
          business_knowledge_snippet: params.business_knowledge_snippet,
          pricing_context: params.pricing_context,
          tone_config: toneConfig,
          outcome: params.outcome,
          selected_action: params.selected_action,
          action_target: params.action_target,
        }
      : params.outcome === "no_objective"
      ? {
          recent_history: params.recent_history,
          customer_message: params.customer_message,
          finalized_state: params.finalized_state,
          conversation_lifecycle: params.conversation_lifecycle,
          business_knowledge_snippet: params.business_knowledge_snippet,
          pricing_context: params.pricing_context,
          tone_config: toneConfig,
          outcome: params.outcome,
        }
      : (() => {
          // outcome === "error" -- structurally unreachable via this
          // function today (pipeline.ts never constructs a CallBInput for
          // the error case, see types.ts's comment on why the variant
          // still exists). Thrown loudly rather than silently handled, so
          // a future wiring mistake that DOES reach here with an error
          // outcome surfaces immediately instead of producing a
          // nonsensical model call.
          throw new Error(
            `runCallB() was called with outcome: "error" -- this should be structurally unreachable. ` +
              `Per ObjectiveOutcome's invariants (types.ts), the error case is handled entirely in ` +
              `pipeline.ts before a CallBInput is ever constructed. If this fires, that invariant was violated somewhere.`
          );
        })();

  const messages: ChatMessage[] = [
    { role: "system", content: `${PROMPT_SPEC_RULES}\n\n${SOP_DESIGN_PRINCIPLES}` },
    { role: "user", content: JSON.stringify(input) },
  ];

  const reply = await chatFn({ messages, tier: "quality", temperature: 0.7 });

  // Prompt Spec §4: leakage check. A real occurrence should trigger a
  // regression test (Evaluation Protocol §4), not just a silent retry loop —
  // logging here rather than auto-retrying, since repeated leakage indicates
  // a prompt problem, not a one-off sampling fluke.
  const leakageTerms = ["confidence:", "status: complete", "status: partial", "status: conflict", "evidence_type"];
  const leaked = leakageTerms.find((term) => reply.toLowerCase().includes(term.toLowerCase()));
  if (leaked) {
    throw new Error(
      `Call B output contains internal-state leakage ("${leaked}"). Per Prompt Spec §4, this indicates ` +
        `the two-call separation has failed and needs prompt revision if it recurs, not just a retry. ` +
        `Log this in docs/ADL.md if it happens more than once.`
    );
  }

  return reply.trim();
}
