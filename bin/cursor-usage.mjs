#!/usr/bin/env node
const base = process.env.CURSOR_USAGE_URL || "http://localhost:8787";
const input = process.argv[2] ? JSON.parse(process.argv[2]) : { kind: "cli_signal" };
const response = await fetch(`${base}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, source: "cli" }) });
if (!response.ok) process.exitCode = 1;
console.log(await response.text());
