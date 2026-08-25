#!/usr/bin/env node
/**
 * Minimal Cursor hooks forwarder.
 * Reads hook JSON from stdin and POSTs a normalized event to the local service.
 *
 * Pair with integrations/hooks.example.json. See https://cursor.com/docs/hooks
 */
const base = process.env.CURSOR_USAGE_URL || "http://localhost:8787";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8").trim();

let payload = {};
try {
  payload = raw ? JSON.parse(raw) : {};
} catch {
  payload = {};
}

const hookEvent = payload?.hook_event_name || payload?.event || "hook";
const kind =
  /subagent|agent/i.test(hookEvent)
    ? "agent_call"
    : /tool/i.test(hookEvent)
      ? "tool_call"
      : hookEvent;

const event = {
  source: "hook",
  kind,
  sessionId: payload?.conversation_id || payload?.session_id || payload?.sessionId,
  model: payload?.model?.display_name || payload?.model || undefined,
};

try {
  await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
} catch {
  // Hooks should not fail the agent loop if the local collector is offline.
}

process.stdout.write("{}\n");
