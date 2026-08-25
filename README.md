# Cursor Usage Dashboard

Local TypeScript service + React/Vite dashboard for **explicitly available** Cursor usage signals — CLI collectors, status-line commands, hooks, and optional event adapters. Built to sit alongside sibling metrics apps like [CC-Telemetry](https://github.com/Ab3y/CC-Telemetry) and [GHCP_Metrics](https://github.com/Ab3y/GHCP_Metrics): charts, filters, session/model breakdowns, export, and clear unavailable states.

> **Privacy-first:** this project does **not** scrape the Cursor UI and does **not** read private or undocumented databases. Unsupported fields stay **Unavailable** — never fabricated.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [How Data Is Collected](#how-data-is-collected)
- [Cursor Integration Setup](#cursor-integration-setup)
- [API Endpoints](#api-endpoints)
- [Data Model](#data-model)
- [Context Window vs Account Quota](#context-window-vs-account-quota)
- [Privacy & Boundaries](#privacy--boundaries)
- [Official Cursor Docs](#official-cursor-docs)
- [Troubleshooting](#troubleshooting)
- [Scripts](#scripts)

---

## Overview

Cursor exposes several **supported** integration surfaces for observability:

| Surface | What you can collect | Official docs |
|--------|----------------------|---------------|
| CLI status line | Model + context-window payload on stdin | [CLI configuration](https://cursor.com/docs/cli/reference/configuration) |
| Hooks | Agent/tool lifecycle events via `hooks.json` | [Hooks](https://cursor.com/docs/hooks) |
| Headless CLI (`stream-json`) | Programmatic NDJSON events | [Output format](https://cursor.com/docs/cli/reference/output-format) |
| Admin / org usage APIs | Team/org usage events & daily metrics (enterprise) | [Team Admin API](https://cursor.com/docs/account/teams/admin-api), [Org Admin API](https://cursor.com/docs/account/organizations/organization-admin-api) |
| OpenTelemetry export | Server-side metrics/logs to your collector (enterprise) | [OTel export](https://cursor.com/docs/enterprise/opentelemetry-export) |

This dashboard focuses on the **local collector path** (CLI / status-line / hooks / events). Enterprise Admin API and OTel are documented as optional upstream sources you may bridge later — they are **not** scraped or invented here.

---

## Features

- **Summary cards** — active session, context-window remaining, observed tokens, agent/tool call counts
- **Account quota** — always shown as **Unavailable** unless a future supported collector supplies it (never inferred from context %)
- **Time-range filters** — `24h` / `7d` / `14d` / `28d` / `all`
- **Source & model filters** — slice by `cli` | `statusline` | `hook` | `event` and model name
- **Charts** — stacked token trend (Recharts) + model mix donut
- **Sessions table** — searchable list with tokens, context remaining, agent/tool counts
- **Model breakdown** — tokens and call counts per model
- **Recent signals feed** — latest normalized events
- **Export** — CSV and JSON for the current filter
- **Auto-refresh** — 15s polling
- **Responsive UI** — works on desktop and mobile
- **Demo seed data** — fresh installs show sample sessions; replace with real integrations

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Cursor CLI / IDE hooks / status-line / adapters            │
│  (only values Cursor or your wrapper explicitly emits)      │
└────────────────────────────┬────────────────────────────────┘
                             │ POST /api/events
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Local Express service (:8787)                              │
│  collectors → UsageStore (dedupe, aggregate, timeseries)    │
│  GET /api/usage · GET /api/export · GET /api/health         │
└────────────────────────────┬────────────────────────────────┘
                             │ Vite proxy /api → :8787
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  React + Vite dashboard (:5173)                             │
│  filters · charts · sessions · models · export              │
└─────────────────────────────────────────────────────────────┘
```

Optional `DesktopAdapter` boundary exists in `server/collectors.ts` for native bridges. Adapters must not scrape Cursor UI or private DBs.

---

## Quick Start

### Prerequisites

- Node.js 18+ (tested with modern Node LTS)
- npm 9+

### Install & run

```bash
npm install
npm run dev
```

| Surface | URL |
|---------|-----|
| Dashboard | http://localhost:5173 |
| Usage API | http://localhost:8787 |

### Send a test event

```bash
node bin/cursor-usage.mjs "{\"kind\":\"completion\",\"sessionId\":\"s1\",\"model\":\"gpt-4o\",\"inputTokens\":1200,\"outputTokens\":300,\"contextRemaining\":0.58}"
```

Or:

```bash
curl -X POST http://localhost:8787/api/events \
  -H "content-type: application/json" \
  -d "{\"source\":\"cli\",\"kind\":\"completion\",\"sessionId\":\"s1\",\"model\":\"gpt-4o\",\"inputTokens\":1200,\"outputTokens\":300,\"contextRemaining\":0.58}"
```

---

## Project Structure

```
cursor-usage-dashboard/
├── README.md
├── package.json
├── vite.config.ts          # Dev proxy /api → :8787
├── bin/
│   └── cursor-usage.mjs    # CLI event poster
├── integrations/
│   ├── README.md
│   ├── statusline.mjs      # Status-line command → local service
│   ├── forward-hook.mjs    # Hooks stdin → local service
│   └── hooks.example.json  # Example .cursor/hooks.json shape
├── server/
│   ├── index.ts            # Express API
│   ├── collectors.ts       # Source-tagged collectors + DesktopAdapter
│   ├── store.ts            # Schema, aggregation, filters, CSV
│   └── store.test.ts
└── src/
    ├── App.tsx             # Dashboard UI
    ├── main.tsx
    └── styles.css
```

---

## How Data Is Collected

1. An integration emits a JSON event with `source` + `kind` (required).
2. Optional fields (`sessionId`, `model`, tokens, `contextRemaining` / `contextUsed`) are stored only when present.
3. The store deduplicates by `id`, aggregates sessions/models/totals, and builds a timeseries for charts.
4. The dashboard polls `GET /api/usage` with filter query params.

Kinds that match `agent_call` / `tool_call` (flexible hyphen/underscore) increment agent/tool counters.

---

## Cursor Integration Setup

### Status line (CLI)

Point a custom `statusLine` command at `integrations/statusline.mjs` in your CLI config (`~/.cursor/cli-config.json` on Windows/macOS; see [CLI configuration](https://cursor.com/docs/cli/reference/configuration)):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Users/Abe/cursor-usage-dashboard/integrations/statusline.mjs",
    "padding": 2
  }
}
```

The script:

- Reads status-line JSON from stdin
- Forwards a normalized `source: "statusline"` event to `CURSOR_USAGE_URL` (default `http://localhost:8787`)
- Prints a short footer (`model · ctx N%`)

Set `CURSOR_USAGE_FORWARD=0` to render without posting.

### Hooks

Copy `integrations/hooks.example.json` into `.cursor/hooks.json` (project) or `~/.cursor/hooks.json` (user). Update the `command` paths to absolute paths if needed. See [Hooks](https://cursor.com/docs/hooks).

`forward-hook.mjs` maps hook names containing `tool` / `agent` / `subagent` to `tool_call` / `agent_call` kinds and always returns `{}` so the agent loop is not blocked.

### Headless / stream-json

For scripted runs, use Cursor CLI print mode with `--output-format stream-json` ([output format docs](https://cursor.com/docs/cli/reference/output-format)) and pipe parsed events into `POST /api/events` with `source: "cli"`.

### Enterprise Admin / Analytics / OTel (optional)

If you have org/team API access, you can periodically ingest official usage endpoints and map them into the same event schema — without changing the dashboard’s “never fabricate” rule:

- Team Admin API usage events / daily usage — [Admin API](https://cursor.com/docs/account/teams/admin-api)
- Organization pooled usage & reporting — [Organization Admin API](https://cursor.com/docs/account/organizations/organization-admin-api)
- Server-side OpenTelemetry export — [OTel export](https://cursor.com/docs/enterprise/opentelemetry-export), [wire surface](https://cursor.com/docs/enterprise/opentelemetry-export/wire)

Those paths are **out of band** for the default local demo; wire them only when credentials and policy allow.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | `{ ok: true }` |
| `GET` | `/api/usage` | Aggregated snapshot. Query: `range`, `source`, `model` |
| `GET` | `/api/export` | Same filters; `format=json` (default) or `format=csv` |
| `POST` | `/api/events` | Ingest event. Body must include `source` + `kind` |

### Query parameters

| Param | Values | Default |
|-------|--------|---------|
| `range` | `24h`, `7d`, `14d`, `28d`, `all` | `7d` |
| `source` | `cli`, `statusline`, `hook`, `event` | (all) |
| `model` | exact model string | (all) |

### Example event body

```json
{
  "source": "hook",
  "kind": "agent_call",
  "sessionId": "sess-alpha",
  "model": "claude-3.5-sonnet",
  "inputTokens": 1200,
  "outputTokens": 300,
  "cacheTokens": 100,
  "contextRemaining": 0.58
}
```

---

## Data Model

### Event

| Field | Required | Notes |
|-------|----------|-------|
| `id` | no | Auto-generated UUID if omitted |
| `at` | no | ISO timestamp; defaults to now |
| `source` | yes | `cli` \| `statusline` \| `hook` \| `event` |
| `kind` | yes | e.g. `completion`, `update`, `agent_call`, `tool_call` |
| `sessionId` | no | Grouping key |
| `model` | no | Displayed as unavailable when missing |
| `inputTokens` / `outputTokens` / `cacheTokens` | no | Non-negative |
| `contextRemaining` / `contextUsed` | no | Ratio in `[0, 1]` |

### Snapshot highlights

- `totals` — token + agent/tool rollups for the filter
- `sessions` / `models` — ranked aggregates
- `timeseries` — bucketed points for charts
- `contextWindowRemaining` — latest explicit context signal
- `accountQuotaRemaining` + `quotaAvailable: false` — quota never derived from context

---

## Context Window vs Account Quota

| Signal | Meaning | This app |
|--------|---------|----------|
| **Context window remaining** | How much of the *model context* is left in the current session | Shown when `contextRemaining` / `contextUsed` is provided |
| **Account / subscription quota** | Plan limits, included usage, on-demand spend | **Unavailable** unless a supported collector supplies it |

Never treat context % as “how much Cursor plan usage you have left.” Cursor’s own `/usage` and Admin APIs cover account meters separately ([CLI changelog notes on `/usage`](https://cursor.com/docs/cli/changelog)).

---

## Privacy & Boundaries

- Local-only by default (`localhost` service + Vite proxy)
- No UI scraping, no private DB reads
- Optional fields stay empty / unavailable — no invented tokens, models, or quota
- Demo events are clearly seeded for empty installs; replace with real integrations
- Hooks/status-line scripts fail soft if the service is down (do not break the agent loop)

---

## Official Cursor Docs

| Topic | Link |
|-------|------|
| Hooks | https://cursor.com/docs/hooks |
| CLI configuration / status line | https://cursor.com/docs/cli/reference/configuration |
| CLI output formats (`json`, `stream-json`) | https://cursor.com/docs/cli/reference/output-format |
| Team Admin API (usage events) | https://cursor.com/docs/account/teams/admin-api |
| Organization Admin API | https://cursor.com/docs/account/organizations/organization-admin-api |
| Enterprise OpenTelemetry export | https://cursor.com/docs/enterprise/opentelemetry-export |
| OTel wire / attribute reference | https://cursor.com/docs/enterprise/opentelemetry-export/wire |
| Cloud Agent usage endpoint | https://cursor.com/docs/cloud-agent/api/endpoints |
| Docs sitemap | https://cursor.com/llms.txt |

---

## Troubleshooting

### Dashboard shows “Failed to load” / HTTP errors

1. Confirm the API is up: `curl http://localhost:8787/api/health`
2. Run `npm run dev` (starts API + Vite together)
3. Check the Vite proxy in `vite.config.ts` targets `http://localhost:8787`

### No charts / empty sessions after filtering

Widen the range to `28d` or `all`, clear source/model filters, then refresh. Demo data spans roughly a week.

### Status line not updating the dashboard

- Use an absolute path to `integrations/statusline.mjs`
- Ensure the usage service is running
- Confirm stdin JSON is valid (restart CLI after editing `cli-config.json`)

### Hooks not posting

- Validate `.cursor/hooks.json` against [Hooks](https://cursor.com/docs/hooks)
- Prefer absolute `node` + script paths on Windows
- Check that the hook process can reach `CURSOR_USAGE_URL`

### Context shows “—” but tokens appear

Expected: tokens can arrive without a context ratio. The UI never invents `contextRemaining`.

---

## Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| Dev | `npm run dev` | API watch + Vite |
| Build | `npm run build` | Typecheck + production bundle |
| Typecheck | `npm run typecheck` | `tsc --noEmit` |
| Test | `npm test` | Vitest (store aggregation/filters) |
| Lint | `npm run lint` | ESLint |

---

## Related projects

- [CC-Telemetry](https://github.com/Ab3y/CC-Telemetry) — Claude Code OTel metrics dashboard
- [GHCP_Metrics](https://github.com/Ab3y/GHCP_Metrics) — GitHub Copilot metrics dashboard

## License

Give a shoutout and use freely for local observability. Align contributions with the privacy boundaries above.
