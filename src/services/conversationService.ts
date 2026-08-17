/**
 * Conversation Service — operator dashboard scope.
 *
 * Governing rule: the dashboard never talks to ConversationStore directly.
 * This is the only thing (besides handleInboundMessage.ts's actual pipeline
 * work) that imports ConversationStore. Everything the dashboard needs —
 * list, get, search, pause, resume — goes through here.
 *
 * pause()/resume() are the SAME operations bin/kill-switch.ts uses — that
 * CLI was refactored to call this service too, so there's one
 * implementation path, not two copies of kill-switch logic.
 */

import { ConversationStore } from "../store/store.js";
import type { ConversationRecord } from "../engine/types.js";

// Structured search query, not free-form string (addendum B) — simple now,
// ages better as filtering needs grow than a single text field would.
export interface ConversationSearchQuery {
  phone?: string;
  lifecycle?: ConversationRecord["conversation"]["lifecycle"];
  // "customerName" from the original scope doesn't have a home yet — no
  // name field exists anywhere in ConversationRecord (nothing in the
  // kernel or platform layer captures it today). Rather than silently
  // accept and ignore this filter, or invent a name field nobody asked
  // for, it's typed here and explicitly not implemented — see search()'s
  // own comment.
  customerName?: string;
}

export interface PauseResult {
  success: boolean;
  error?: string;
}

export class ConversationService {
  private store: ConversationStore;

  constructor(store: ConversationStore = new ConversationStore()) {
    this.store = store;
  }

  list(filters?: { lifecycle?: ConversationRecord["conversation"]["lifecycle"] }): ConversationRecord[] {
    let all = this.store.list();
    if (filters?.lifecycle) {
      all = all.filter((r) => r.conversation.lifecycle === filters.lifecycle);
    }
    // Most recent first, per the required list-view ordering — using
    // last_agent_activity as the recency signal (falls back to
    // last_customer_activity, then to the record simply having no
    // recorded activity yet, sorted last).
    return all.sort((a, b) => {
      const aTime = a.conversation.last_agent_activity ?? a.conversation.last_customer_activity ?? "";
      const bTime = b.conversation.last_agent_activity ?? b.conversation.last_customer_activity ?? "";
      return bTime.localeCompare(aTime);
    });
  }

  get(phone: string): ConversationRecord | null {
    return this.store.get(phone);
  }

  search(query: ConversationSearchQuery): ConversationRecord[] {
    if (query.customerName) {
      // Flagged rather than silently ignored or fabricated — see the
      // interface comment above. Throwing is more honest than pretending
      // to filter on data that doesn't exist anywhere.
      throw new Error(
        "customerName search was requested in scope but no name field exists anywhere in ConversationRecord " +
          "(kernel or platform layer) — nothing to search against. Flagging rather than silently ignoring the filter."
      );
    }
    let results = this.store.list();
    if (query.phone) {
      results = results.filter((r) => r.phone.includes(query.phone!));
    }
    if (query.lifecycle) {
      results = results.filter((r) => r.conversation.lifecycle === query.lifecycle);
    }
    return results;
  }

  pause(phone: string, reason: string, operator: string): PauseResult {
    const record = this.store.get(phone);
    if (!record) return { success: false, error: `No conversation found for phone "${phone}".` };
    record.automation_paused = true;
    record.paused_reason = reason;
    record.paused_at = new Date().toISOString();
    record.paused_by = operator;
    this.store.save(record);
    return { success: true };
  }

  resume(phone: string): PauseResult {
    const record = this.store.get(phone);
    if (!record) return { success: false, error: `No conversation found for phone "${phone}".` };
    record.automation_paused = false;
    record.paused_reason = null;
    record.paused_at = null;
    record.paused_by = null;
    this.store.save(record);
    return { success: true };
  }
}
