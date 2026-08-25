#!/usr/bin/env node
/**
 * Cursor CLI status-line command.
 * Reads status-line JSON from stdin, optionally forwards a normalized event to
 * the local usage service, and prints a short footer line.
 *
 * Configure in ~/.cursor/cli-config.json:
 * {
 *   "statusLine": {
 *     "type": "command",
 *     "command": "node /absolute/path/to/integrations/statusline.mjs",
 *     "padding": 2
 *   }
 * }
 *
 * Docs: https://cursor.com/docs/cli/reference/configuration
 * Hooks companion: https://cursor.com/docs/hooks
 */
import { stdin } from "node:process";

const base = process.env.CURSOR_USAGE_URL || "http://localhost:8787";
const chunks = [];
for await (const chunk of stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8").trim();

let payload = {};
try {
  payload = raw ? JSON.parse(raw) : {};
} catch {
  payload = {};
}

const model =
  payload?.model?.display_name ||
  payload?.model?.id ||
  payload?.model ||
  undefined;
const sessionId = payload?.session_id || payload?.sessionId || undefined;
const contextWindow = payload?.context_window || payload?.contextWindow || {};
const usedPct =
  typeof contextWindow.used_percentage === "number"
    ? contextWindow.used_percentage / 100
    : typeof contextWindow.usedPercentage === "number"
      ? contextWindow.usedPercentage / 100
      : undefined;
const contextRemaining =
  typeof usedPct === "number"
    ? Math.max(0, Math.min(1, 1 - usedPct))
    : typeof contextWindow.remaining_percentage === "number"
      ? Math.max(0, Math.min(1, contextWindow.remaining_percentage / 100))
      : undefined;

const inputTokens =
  contextWindow.total_input_tokens ??
  contextWindow.current_usage?.input_tokens ??
  undefined;
const outputTokens =
  contextWindow.total_output_tokens ??
  contextWindow.current_usage?.output_tokens ??
  undefined;

const event = {
  source: "statusline",
  kind: "update",
  sessionId,
  model: typeof model === "string" ? model : undefined,
  inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
  outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
  contextRemaining,
};

if (process.env.CURSOR_USAGE_FORWARD !== "0") {
  try {
    await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // Keep the status line usable even if the local service is down.
  }
}

const ctx =
  contextRemaining === undefined ? "ctx —" : `ctx ${Math.round(contextRemaining * 100)}%`;
const modelLabel = typeof model === "string" ? model : "model —";
process.stdout.write(`${modelLabel} · ${ctx}`);
