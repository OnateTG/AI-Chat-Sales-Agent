#!/usr/bin/env -S npx tsx
/**
 * Operations kill switch (production handoff Operations checklist item).
 * A real, runnable operator tool -- not a stub. Calls ConversationService,
 * NOT ConversationStore directly -- refactored so the dashboard's pause/
 * resume buttons and this CLI share one implementation path, not two
 * copies of the same logic that could quietly drift apart.
 *
 * Usage:
 *   npx tsx bin/kill-switch.ts pause  <phone> "<reason>" [operator-name]
 *   npx tsx bin/kill-switch.ts resume <phone>
 *   npx tsx bin/kill-switch.ts status <phone>
 */

import { ConversationService } from "../src/services/conversationService.js";

function usage(): never {
  console.error(`Usage:
  npx tsx bin/kill-switch.ts pause  <phone> "<reason>" [operator-name]
  npx tsx bin/kill-switch.ts resume <phone>
  npx tsx bin/kill-switch.ts status <phone>`);
  process.exit(2);
}

async function main() {
  const [cmd, phone, ...rest] = process.argv.slice(2);
  if (!cmd || !phone) usage();

  const service = new ConversationService();

  if (cmd === "status") {
    const record = service.get(phone);
    if (!record) {
      console.error(`No conversation found for phone "${phone}".`);
      process.exit(1);
    }
    console.log(JSON.stringify({
      phone: record.phone,
      automation_paused: record.automation_paused,
      paused_reason: record.paused_reason,
      paused_at: record.paused_at,
      paused_by: record.paused_by,
      lifecycle: record.conversation.lifecycle,
      repeat_count: record.repeat_count,
    }, null, 2));
    return;
  }

  if (cmd === "pause") {
    const reason = rest[0];
    const operator = rest[1] ?? "unspecified";
    if (!reason) {
      console.error('A reason is required: npx tsx bin/kill-switch.ts pause <phone> "<reason>" [operator]');
      process.exit(2);
    }
    const result = service.pause(phone, reason, operator);
    if (!result.success) {
      console.error(result.error);
      process.exit(1);
    }
    console.log(`Paused automation for ${phone}. Reason: "${reason}" (by ${operator})`);
    return;
  }

  if (cmd === "resume") {
    const result = service.resume(phone);
    if (!result.success) {
      console.error(result.error);
      process.exit(1);
    }
    console.log(`Resumed automation for ${phone}.`);
    return;
  }

  usage();
}

main();
