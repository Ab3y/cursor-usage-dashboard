# Cursor integrations

Normalized events land at `POST /api/events`. Supported `source` values: `cli`,
`statusline`, `hook`, `event`. Every event needs a `kind`. Optional fields:
`sessionId`, `model`, `inputTokens`, `outputTokens`, `cacheTokens`,
`contextRemaining` / `contextUsed` (ratios in `[0, 1]`).

Use kinds like `completion`, `update`, `agent_call`, and `tool_call` so the store
can aggregate call counts. Integrations only forward values Cursor (or your
wrapper) explicitly emits — no UI scraping, no private databases.

## Included helpers

| File | Role |
|------|------|
| `statusline.mjs` | CLI status-line command: stdin JSON → footer text + optional POST |
| `forward-hook.mjs` | Hooks stdin → POST; always prints `{}` |
| `hooks.example.json` | Example hook registration |

### CLI poster

```bash
node bin/cursor-usage.mjs '{"kind":"completion","sessionId":"s1","model":"gpt-4o","inputTokens":100}'
```

### Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `CURSOR_USAGE_URL` | `http://localhost:8787` | Local usage service base URL |
| `CURSOR_USAGE_FORWARD` | (on) | Set to `0` to skip POSTing from the status-line script |

## Context vs quota

`contextRemaining` is a **context-window** signal, not account/subscription quota.
Account quota stays unavailable unless a supported collector provides it.

## Official docs

- [Hooks](https://cursor.com/docs/hooks)
- [CLI configuration](https://cursor.com/docs/cli/reference/configuration)
- [CLI output format / stream-json](https://cursor.com/docs/cli/reference/output-format)
- [Team Admin API](https://cursor.com/docs/account/teams/admin-api)
- [Organization Admin API](https://cursor.com/docs/account/organizations/organization-admin-api)
- [OpenTelemetry export](https://cursor.com/docs/enterprise/opentelemetry-export)
