import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Bot,
  Clock3,
  Download,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type EventSource = "cli" | "statusline" | "hook" | "event";
type TimeRange = "24h" | "7d" | "14d" | "28d" | "all";

type Event = {
  id: string;
  at: string;
  source: EventSource | string;
  kind: string;
  sessionId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  contextRemaining?: number;
};

type SessionSummary = {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  contextRemaining?: number;
  contextUsed?: number;
  model?: string;
  eventCount: number;
  agentCalls: number;
  toolCalls: number;
  lastAt: string;
  sources: EventSource[];
};

type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  eventCount: number;
  agentCalls: number;
  toolCalls: number;
};

type TimeseriesPoint = {
  at: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  agentCalls: number;
  toolCalls: number;
  eventCount: number;
};

type Snapshot = {
  updatedAt: string;
  query: { range: TimeRange; source?: EventSource; model?: string };
  events: Event[];
  sessions: SessionSummary[];
  models: ModelUsage[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    totalTokens: number;
    agentCalls: number;
    toolCalls: number;
  };
  timeseries: TimeseriesPoint[];
  activeSession?: SessionSummary;
  contextWindowRemaining?: number;
  sources: EventSource[];
  availableModels: string[];
  availableSources: EventSource[];
  freshness: { latestAt?: string; ageMs?: number };
  accountQuotaRemaining?: number;
  quotaAvailable: false;
};

const empty: Snapshot = {
  updatedAt: new Date().toISOString(),
  query: { range: "7d" },
  events: [],
  sessions: [],
  models: [],
  totals: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, agentCalls: 0, toolCalls: 0 },
  timeseries: [],
  sources: [],
  availableModels: [],
  availableSources: [],
  freshness: {},
  quotaAvailable: false,
};

const RANGES: TimeRange[] = ["24h", "7d", "14d", "28d", "all"];
const CHART_COLORS = ["#d5f36b", "#9ec5ff", "#f0b56c", "#8fd6b5", "#c9a0ff", "#ff8fa3"];

const pct = (value?: number) => (value === undefined ? "—" : `${Math.round(value * 100)}%`);
const num = (value: number) => value.toLocaleString();
const freshnessLabel = (ageMs?: number) => {
  if (ageMs === undefined) return "No signals";
  if (ageMs < 60_000) return "Fresh";
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  return `${Math.round(ageMs / 3_600_000)}h ago`;
};

const downloadBlob = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export default function App() {
  const [data, setData] = useState<Snapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [range, setRange] = useState<TimeRange>("7d");
  const [source, setSource] = useState<EventSource | "">("");
  const [model, setModel] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");

  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const params = new URLSearchParams({ range });
      if (source) params.set("source", source);
      if (model) params.set("model", model);
      const response = await fetch(`/api/usage?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [range, source, model]);

  const active = data.activeSession;
  const context = data.contextWindowRemaining ?? active?.contextRemaining;
  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    if (!q) return data.sessions;
    return data.sessions.filter(
      (s) =>
        s.sessionId.toLowerCase().includes(q) ||
        (s.model ?? "").toLowerCase().includes(q) ||
        s.sources.some((src) => src.includes(q)),
    );
  }, [data.sessions, sessionQuery]);

  const modelChart = data.models.map((m) => ({ name: m.model, value: m.totalTokens }));

  const exportJson = () =>
    downloadBlob(`cursor-usage-${range}.json`, JSON.stringify(data, null, 2), "application/json");

  const exportCsv = async () => {
    try {
      const params = new URLSearchParams({ range, format: "csv" });
      if (source) params.set("source", source);
      if (model) params.set("model", model);
      const response = await fetch(`/api/export?${params}`);
      if (!response.ok) throw new Error(`Export failed: HTTP ${response.status}`);
      downloadBlob(`cursor-usage-${range}.csv`, await response.text(), "text/csv");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">LOCAL OBSERVABILITY</p>
          <h1>Cursor usage</h1>
          <p className="muted">
            Privacy-first signals from CLI, status-line, hooks, and events — not UI scraping.
          </p>
          <div className="badges">
            <span className="pill">{freshnessLabel(data.freshness.ageMs)}</span>
            {data.sources.map((src) => (
              <span className="pill source" key={src}>
                {src}
              </span>
            ))}
            {error ? <span className="pill warn">{error}</span> : null}
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="ghost" onClick={() => void exportCsv()} aria-label="Export CSV">
            <Download size={16} /> CSV
          </button>
          <button type="button" className="ghost" onClick={exportJson} aria-label="Export JSON">
            <Download size={16} /> JSON
          </button>
          <button type="button" onClick={() => void load()} aria-label="Refresh">
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      <section className="filters" aria-label="Filters">
        <div className="filter-group">
          <span className="filter-label">Range</span>
          <div className="segmented">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={range === r ? "active" : ""}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <label className="filter-group">
          <span className="filter-label">Source</span>
          <select value={source} onChange={(e) => setSource(e.target.value as EventSource | "")}>
            <option value="">All sources</option>
            {data.availableSources.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-group">
          <span className="filter-label">Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">All models</option>
            {data.availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="grid summary">
        <article className="card hero">
          <div className="card-title">
            <Activity size={18} /> Active session
          </div>
          <strong>{active?.sessionId ?? "None"}</strong>
          <p className="muted">
            {active?.model ?? "model unavailable"} · {num(active?.totalTokens ?? 0)} tokens ·{" "}
            {pct(active?.contextRemaining)} context left
          </p>
          <div className="metric-row">
            <div>
              <small>In</small>
              <b>{num(active?.inputTokens ?? 0)}</b>
            </div>
            <div>
              <small>Out</small>
              <b>{num(active?.outputTokens ?? 0)}</b>
            </div>
            <div>
              <small>Cache</small>
              <b>{active?.cacheTokens ? num(active.cacheTokens) : "—"}</b>
            </div>
            <div>
              <small>Agents</small>
              <b>{active?.agentCalls ?? 0}</b>
            </div>
          </div>
        </article>

        <article className="card">
          <div className="card-title">
            <Layers size={18} /> Context window
          </div>
          <strong>{pct(context)}</strong>
          <div className="bar">
            <span style={{ width: `${context !== undefined ? context * 100 : 0}%` }} />
          </div>
          <p className="muted">Session context remaining — not account quota.</p>
        </article>

        <article className="card">
          <div className="card-title">
            <Terminal size={18} /> Tokens observed
          </div>
          <strong>{num(data.totals.totalTokens)}</strong>
          <p className="muted">
            {num(data.totals.inputTokens)} in · {num(data.totals.outputTokens)} out
            {data.totals.cacheTokens ? ` · ${num(data.totals.cacheTokens)} cache` : ""}
          </p>
        </article>

        <article className="card">
          <div className="card-title">
            <Bot size={18} /> Agent / tool calls
          </div>
          <strong>
            {data.totals.agentCalls}
            <span className="slash">/</span>
            {data.totals.toolCalls}
          </strong>
          <p className="muted">Observed agent_call and tool_call events.</p>
        </article>

        <article className="card warning">
          <div className="card-title">
            <AlertCircle size={18} /> Account quota
          </div>
          <strong>Unavailable</strong>
          <p className="muted">Not configured. Never inferred from context remaining.</p>
        </article>
      </section>

      <section className="panels charts">
        <article className="card panel">
          <div className="section-heading">
            <div>
              <h2>Token trend</h2>
              <p className="muted">Input, output, and cache tokens over the selected range.</p>
            </div>
          </div>
          {data.timeseries.length === 0 ? (
            <div className="empty">No token timeline yet for this filter.</div>
          ) : (
            <div className="chart">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.timeseries}>
                  <defs>
                    <linearGradient id="tokIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#d5f36b" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#d5f36b" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="tokOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#9ec5ff" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#9ec5ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#23303c" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#82909f" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#82909f" tick={{ fontSize: 11 }} width={48} />
                  <Tooltip
                    contentStyle={{ background: "#131b24", border: "1px solid #23303c", borderRadius: 8 }}
                    labelStyle={{ color: "#e8edf3" }}
                  />
                  <Area type="monotone" dataKey="inputTokens" name="Input" stroke="#d5f36b" fill="url(#tokIn)" stackId="1" />
                  <Area type="monotone" dataKey="outputTokens" name="Output" stroke="#9ec5ff" fill="url(#tokOut)" stackId="1" />
                  <Area type="monotone" dataKey="cacheTokens" name="Cache" stroke="#f0b56c" fill="#f0b56c33" stackId="1" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="card panel">
          <div className="section-heading">
            <div>
              <h2>Model mix</h2>
              <p className="muted">Share of observed tokens by model.</p>
            </div>
          </div>
          {modelChart.length === 0 ? (
            <div className="empty">No model usage yet.</div>
          ) : (
            <div className="chart model-chart">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={modelChart} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2}>
                    {modelChart.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#131b24", border: "1px solid #23303c", borderRadius: 8 }}
                    formatter={(value) => num(Number(value ?? 0))}
                  />
                </PieChart>
              </ResponsiveContainer>
              <ul className="legend">
                {data.models.map((m, i) => (
                  <li key={m.model}>
                    <span className="swatch" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span>
                      {m.model}
                      <small>
                        {num(m.totalTokens)} tok · {m.agentCalls} agents · {m.toolCalls} tools
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      </section>

      <section className="panels">
        <article className="card panel">
          <div className="section-heading">
            <div>
              <h2>Sessions</h2>
              <p className="muted">Tokens used and remaining context per session.</p>
            </div>
            <span className="pill">{filteredSessions.length}</span>
          </div>
          <label className="search">
            <Search size={14} />
            <input
              value={sessionQuery}
              onChange={(e) => setSessionQuery(e.target.value)}
              placeholder="Filter sessions…"
              aria-label="Filter sessions"
            />
          </label>
          {filteredSessions.length === 0 ? (
            <div className="empty">No sessions match this filter.</div>
          ) : (
            <div className="table">
              {filteredSessions.map((session) => (
                <div className="row" key={session.sessionId}>
                  <div>
                    <b>{session.sessionId}</b>
                    <small>
                      {session.model ?? "model unavailable"} · {session.sources.join(", ")}
                    </small>
                  </div>
                  <div className="stats">
                    <span>{num(session.totalTokens)} tok</span>
                    <span>{pct(session.contextRemaining)} ctx</span>
                    <span>
                      <Bot size={12} /> {session.agentCalls}
                    </span>
                    <span>
                      <Wrench size={12} /> {session.toolCalls}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card panel">
          <div className="section-heading">
            <div>
              <h2>Models</h2>
              <p className="muted">Token and call counts per model.</p>
            </div>
            <span className="pill">{data.models.length}</span>
          </div>
          {data.models.length === 0 ? (
            <div className="empty">No model usage yet.</div>
          ) : (
            <div className="table">
              {data.models.map((m) => (
                <div className="row" key={m.model}>
                  <div>
                    <b>{m.model}</b>
                    <small>
                      {m.eventCount} events · {m.agentCalls} agents · {m.toolCalls} tools
                    </small>
                  </div>
                  <div className="stats">
                    <span>{num(m.totalTokens)} tok</span>
                    <span>
                      {num(m.inputTokens)}/{num(m.outputTokens)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="card activity">
        <div className="section-heading">
          <div>
            <h2>Recent signals</h2>
            <p className="muted">Collected through CLI, status-line, hook, or event integrations.</p>
          </div>
          <span className="pill">{data.events.length} events</span>
        </div>
        {data.events.length === 0 ? (
          <div className="empty">
            No signals yet. Post an event to <code>POST /api/events</code>.
          </div>
        ) : (
          <div className="events">
            {[...data.events]
              .reverse()
              .slice(0, 40)
              .map((e) => (
                <div className="event" key={e.id}>
                  <span className="dot" />
                  <div>
                    <b>
                      {e.kind.includes("agent") ? <Sparkles size={12} /> : null}
                      {e.kind.includes("tool") ? <Wrench size={12} /> : null}
                      {e.kind}
                    </b>
                    <small>
                      {e.source} · {e.sessionId ?? "no session"} · {e.model ?? "model unavailable"}
                      {e.inputTokens !== undefined || e.outputTokens !== undefined
                        ? ` · ${num((e.inputTokens ?? 0) + (e.outputTokens ?? 0))} tok`
                        : ""}
                      {e.contextRemaining !== undefined ? ` · ${pct(e.contextRemaining)} ctx` : ""}
                    </small>
                  </div>
                  <time>
                    <Clock3 size={13} />
                    {new Date(e.at).toLocaleString()}
                  </time>
                </div>
              ))}
          </div>
        )}
      </section>

      <footer>
        Updated {new Date(data.updatedAt).toLocaleTimeString()} · Range {data.query.range} · Local
        service only · Auto-refresh 15s
      </footer>
    </main>
  );
}
