/**
 * Prompt Specification §2 — Call A (State Extraction). Direct
 * implementation of §2.2 input, §2.3 output schema, §2.4 instructions.
 */

import { z } from "zod";
import { chatCompletion, type ChatMessage, type ChatCompletionFn } from "./router.js";
import type { CallAOutput, StateMap, Lifecycle } from "../engine/types.js";

// ---- §2.3 strict output schema, enforced via zod (Prompt Spec §4: "Reject
// and retry on schema violation — do not pass malformed output to the Engine") ----
const CallAOutputSchema = z.object({
  updates: z.array(
    z.object({
      variable: z.string(),
      evidence_type: z.enum(["explicit", "inferred", "assumed"]),
      statement: z.string(),
      // Extension beyond the reviewed Prompt Spec §2.3 — see docs/ADL.md 008.
      satisfies: z.array(z.string()).default([]),
    })
  ),
  possible_conflicts: z.array(
    z.object({
      variable: z.string(),
      reason: z.string(),
    })
  ),
  pending_customer_question: z.string().nullable(),
  proposed_lifecycle: z.enum(["active", "paused", "completed", "abandoned", "escalated"]),
});

// ---- §2.4, transcribed verbatim as the system prompt ----
const CALL_A_INSTRUCTIONS = `You are the extraction component of a consultative sales conversation system.
Your only job is to read the customer's latest message and identify what it
tells you about the variables listed in \`domain_variables\`.

For each variable the message provides information about:
- Classify the evidence as:
  - explicit: the customer directly stated this
  - inferred: strongly implied but not stated outright
  - assumed: weakly implied; a tentative guess only
- Paraphrase the relevant statement — do not fabricate detail beyond what
  was said.
- Each variable in \`domain_variables\` lists its \`completion.required\`
  sub-attributes. Set \`satisfies\` to the sub-attribute name(s) this specific
  statement addresses (e.g. for \`goal\` with required [desired_outcome,
  business_reason], "I need a website" satisfies ["desired_outcome"] only).
  Leave \`satisfies\` empty if the statement doesn't clearly address a named
  sub-attribute yet.

Consider ALL variables in \`domain_variables\`, not only the one most recently
asked about. Customers often answer multiple things in one message.

If the customer's message appears to contradict the current \`value\` of a
variable in \`current_state\`, flag it in \`possible_conflicts\` — do not decide
whether it's a real conflict yourself; that is confirmed elsewhere.

Capture in \`pending_customer_question\` any message that substantively
calls for a response back from you — not only messages phrased as literal
questions. This includes objections, concerns, or check-ins stated as
plain sentences: "that's more than I budgeted for" and "is the offer still
available?" both call for a response, even though only one ends in a
question mark. Judge by whether the customer is waiting on something back
from you, not by punctuation. If in doubt, err toward capturing it — an
unanswered concern is worse than an over-eager one.

Assess the conversation's execution state from this message and set
\`proposed_lifecycle\`: active (ongoing engagement), paused (customer signaled
an intentional, expected return — e.g. "I'll think about it," "let me ask my
partner"), completed (a satisfied final reply after a recommendation),
escalated (customer explicitly asks for a human), or abandoned (you will
rarely propose this yourself — it is usually platform-triggered by silence,
not inferred from message content). Default to active if nothing signals
otherwise. This is a proposal; you do not decide whether the transition is
valid.

Do not generate a reply. Do not decide what happens next. Output only the
structured JSON specified below, with no surrounding prose or markdown fences.`;

export interface CallAParams {
  customerMessage: string;
  recentHistory: string[];
  currentState: StateMap;
  // `completion` included alongside `description` — an extension beyond the
  // reviewed §2.2 input shape, required for `satisfies` above to be
  // possible at all. See docs/ADL.md 008.
  domainVariables: Record<string, { description: string; completion: { required: string[] } }>;
}

/** Prompt Spec §2.2 input, minus instructions (those are the system message). */
function buildInput(params: CallAParams) {
  return {
    customer_message: params.customerMessage,
    recent_history: params.recentHistory,
    current_state: Object.fromEntries(
      Object.entries(params.currentState).map(([k, v]) => [
        k,
        { value: v.value, status: v.status, evidence: v.evidence, confidence: v.confidence },
      ])
    ),
    domain_variables: params.domainVariables,
  };
}

const MAX_RETRIES = 1; // Prompt Spec §4: "Reject and retry" — one retry, not an infinite loop

export async function runCallA(params: CallAParams, chatFn: ChatCompletionFn = chatCompletion): Promise<CallAOutput> {
  const messages: ChatMessage[] = [
    { role: "system", content: CALL_A_INSTRUCTIONS },
    { role: "user", content: JSON.stringify(buildInput(params)) },
  ];

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const raw = await chatFn({ messages, tier: "fast", temperature: 0.1, jsonMode: true });

    try {
      const parsed = JSON.parse(raw);
      const validated = CallAOutputSchema.parse(parsed);

      // Extra validation beyond zod's shape check, per §4: "Every `variable`
      // referenced must exist in `domain_variables`."
      for (const u of validated.updates) {
        if (!(u.variable in params.domainVariables)) {
          throw new Error(`Call A referenced unknown variable "${u.variable}"`);
        }
      }

      return validated as CallAOutput;
    } catch (err) {
      lastError = err;
      messages.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `That output didn't match the required schema (${String(
            err
          )}). Return ONLY valid JSON matching the schema, no other text.`,
        }
      );
    }
  }

  throw new Error(`Call A failed schema validation after ${MAX_RETRIES + 1} attempts: ${String(lastError)}`);
}
