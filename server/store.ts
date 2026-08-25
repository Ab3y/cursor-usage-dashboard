import { z } from "zod";

export const eventSources = ["cli", "statusline", "hook", "event"] as const;
export type EventSource = (typeof eventSources)[number];

export const timeRanges = ["24h", "7d", "14d", "28d", "all"] as const;
export type TimeRange = (typeof timeRanges)[number];

export const isEventSource = (value: unknown): value is EventSource =>
  typeof value === "string" && (eventSources as readonly string[]).includes(value);

export const isTimeRange = (value: unknown): value is TimeRange =>
  typeof value === "string" && (timeRanges as readonly string[]).includes(value);

export const eventSchema = z.object({
  id: z.string(),
  at: z.string(),
  source: z.enum(eventSources),
  kind: z.string(),
  sessionId: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  cacheTokens: z.number().nonnegative().optional(),
  contextRemaining: z.number().min(0).max(1).optional(),
  contextUsed: z.number().min(0).max(1).optional(),
});
export type UsageEvent = z.infer<typeof eventSchema>;

export type SessionSummary = {
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

export type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  eventCount: number;
  agentCalls: number;
  toolCalls: number;
};

export type ContextSnapshot = {
  at: string;
  sessionId?: string;
  remaining?: number;
  used?: number;
  source: EventSource;
};

export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  agentCalls: number;
  toolCalls: number;
};

export type TimeseriesPoint = {
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

export type SnapshotQuery = {
  range?: TimeRange;
  source?: EventSource;
  model?: string;
};

export type UsageSnapshot = {
  updatedAt: string;
  query: Required<Pick<SnapshotQuery, "range">> & SnapshotQuery;
  events: UsageEvent[];
  sessions: SessionSummary[];
  models: ModelUsage[];
  totals: TokenTotals;
  timeseries: TimeseriesPoint[];
  activeSession?: SessionSummary;
  contextWindowRemaining?: number;
  contextSnapshots: ContextSnapshot[];
  sources: EventSource[];
  availableModels: string[];
  availableSources: EventSource[];
  freshness: { latestAt?: string; ageMs?: number };
  /** Account/subscription quota — never derived from contextRemaining. */
  accountQuotaRemaining?: number;
  quotaAvailable: false;
};

const emptyTotals = (): TokenTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  totalTokens: 0,
  agentCalls: 0,
  toolCalls: 0,
});

const isAgentCall = (kind: string) => /agent[_-]?call/i.test(kind);
const isToolCall = (kind: string) => /tool[_-]?call/i.test(kind);

const addTokens = (
  target: { inputTokens: number; outputTokens: number; cacheTokens: number; totalTokens: number },
  event: UsageEvent,
) => {
  const input = event.inputTokens ?? 0;
  const output = event.outputTokens ?? 0;
  const cache = event.cacheTokens ?? 0;
  target.inputTokens += input;
  target.outputTokens += output;
  target.cacheTokens += cache;
  target.totalTokens += input + output + cache;
};

export const rangeToMs = (range: TimeRange): number | undefined => {
  switch (range) {
    case "24h":
      return 24 * 3600_000;
    case "7d":
      return 7 * 24 * 3600_000;
    case "14d":
      return 14 * 24 * 3600_000;
    case "28d":
      return 28 * 24 * 3600_000;
    case "all":
      return undefined;
  }
};

const bucketKey = (at: Date, range: TimeRange): { key: string; label: string } => {
  if (range === "24h") {
    const start = new Date(at);
    start.setMinutes(0, 0, 0);
    return {
      key: start.toISOString(),
      label: start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
  }
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  return {
    key: start.toISOString(),
    label: start.toLocaleDateString([], { month: "short", day: "numeric" }),
  };
};

export const buildTimeseries = (events: UsageEvent[], range: TimeRange): TimeseriesPoint[] => {
  const map = new Map<string, TimeseriesPoint>();
  for (const event of events) {
    const { key, label } = bucketKey(new Date(event.at), range);
    let point = map.get(key);
    if (!point) {
      point = {
        at: key,
        label,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        agentCalls: 0,
        toolCalls: 0,
        eventCount: 0,
      };
      map.set(key, point);
    }
    addTokens(point, event);
    point.eventCount += 1;
    if (isAgentCall(event.kind)) point.agentCalls += 1;
    if (isToolCall(event.kind)) point.toolCalls += 1;
  }
  return [...map.values()].sort((a, b) => a.at.localeCompare(b.at));
};

export const eventsToCsv = (events: UsageEvent[]): string => {
  const header = [
    "id",
    "at",
    "source",
    "kind",
    "sessionId",
    "model",
    "inputTokens",
    "outputTokens",
    "cacheTokens",
    "contextRemaining",
    "contextUsed",
  ];
  const escape = (value: unknown) => {
    if (value === undefined || value === null) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = events.map((e) =>
    [
      e.id,
      e.at,
      e.source,
      e.kind,
      e.sessionId,
      e.model,
      e.inputTokens,
      e.outputTokens,
      e.cacheTokens,
      e.contextRemaining,
      e.contextUsed,
    ]
      .map(escape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
};

export class UsageStore {
  private events: UsageEvent[] = [];
  private seen = new Set<string>();

  add(event: UsageEvent) {
    const parsed = eventSchema.parse(event);
    if (this.seen.has(parsed.id)) return;
    this.seen.add(parsed.id);
    this.events.push(parsed);
  }

  snapshot(now = new Date(), query: SnapshotQuery = {}): UsageSnapshot {
    const range = query.range ?? "7d";
    const windowMs = rangeToMs(range);
    const since = windowMs === undefined ? undefined : new Date(now.getTime() - windowMs);

    const recent = this.events.slice(-5000);
    const inWindow = since ? recent.filter((e) => new Date(e.at) >= since) : recent;
    const availableSources = [...new Set(inWindow.map((e) => e.source))];
    const availableModels = [
      ...new Set(inWindow.map((e) => e.model).filter((m): m is string => Boolean(m))),
    ].sort();

    let events = inWindow;
    if (query.source) events = events.filter((e) => e.source === query.source);
    if (query.model) events = events.filter((e) => e.model === query.model);
    events = events.slice(-1000);

    const sessionMap = new Map<string, SessionSummary>();
    const modelMap = new Map<string, ModelUsage>();
    const totals = emptyTotals();
    const contextSnapshots: ContextSnapshot[] = [];
    const sources = new Set<EventSource>();

    for (const event of events) {
      sources.add(event.source);
      addTokens(totals, event);
      if (isAgentCall(event.kind)) totals.agentCalls += 1;
      if (isToolCall(event.kind)) totals.toolCalls += 1;

      const sessionId = event.sessionId ?? "unknown";
      let session = sessionMap.get(sessionId);
      if (!session) {
        session = {
          sessionId,
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          totalTokens: 0,
          eventCount: 0,
          agentCalls: 0,
          toolCalls: 0,
          lastAt: event.at,
          sources: [],
        };
        sessionMap.set(sessionId, session);
      }
      addTokens(session, event);
      session.eventCount += 1;
      if (isAgentCall(event.kind)) session.agentCalls += 1;
      if (isToolCall(event.kind)) session.toolCalls += 1;
      if (event.model) session.model = event.model;
      if (event.contextRemaining !== undefined) session.contextRemaining = event.contextRemaining;
      if (event.contextUsed !== undefined) {
        session.contextUsed = event.contextUsed;
      } else if (event.contextRemaining !== undefined) {
        session.contextUsed = 1 - event.contextRemaining;
      }
      if (event.at >= session.lastAt) session.lastAt = event.at;
      if (!session.sources.includes(event.source)) session.sources.push(event.source);

      if (event.model) {
        let model = modelMap.get(event.model);
        if (!model) {
          model = {
            model: event.model,
            inputTokens: 0,
            outputTokens: 0,
            cacheTokens: 0,
            totalTokens: 0,
            eventCount: 0,
            agentCalls: 0,
            toolCalls: 0,
          };
          modelMap.set(event.model, model);
        }
        addTokens(model, event);
        model.eventCount += 1;
        if (isAgentCall(event.kind)) model.agentCalls += 1;
        if (isToolCall(event.kind)) model.toolCalls += 1;
      }

      if (event.contextRemaining !== undefined || event.contextUsed !== undefined) {
        contextSnapshots.push({
          at: event.at,
          sessionId: event.sessionId,
          remaining: event.contextRemaining,
          used:
            event.contextUsed ??
            (event.contextRemaining !== undefined ? 1 - event.contextRemaining : undefined),
          source: event.source,
        });
      }
    }

    const sessions = [...sessionMap.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    const models = [...modelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens);
    const latestContext = [...events].reverse().find((e) => e.contextRemaining !== undefined);
    const latestAt = events.length
      ? [...events].sort((a, b) => b.at.localeCompare(a.at))[0]?.at
      : undefined;

    return {
      updatedAt: now.toISOString(),
      query: { range, source: query.source, model: query.model },
      events,
      sessions,
      models,
      totals,
      timeseries: buildTimeseries(events, range),
      activeSession: sessions[0],
      contextWindowRemaining: latestContext?.contextRemaining,
      contextSnapshots: contextSnapshots.slice(-50),
      sources: [...sources],
      availableModels,
      availableSources,
      freshness: {
        latestAt,
        ageMs: latestAt ? Math.max(0, now.getTime() - new Date(latestAt).getTime()) : undefined,
      },
      accountQuotaRemaining: undefined,
      quotaAvailable: false,
    };
  }
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString();

export const demoEvents: UsageEvent[] = [
  {
    id: "demo-d6-1",
    at: hoursAgo(140),
    source: "cli",
    kind: "completion",
    sessionId: "sess-delta",
    model: "claude-3.5-sonnet",
    inputTokens: 6200,
    outputTokens: 1100,
    contextRemaining: 0.81,
  },
  {
    id: "demo-d5-1",
    at: hoursAgo(110),
    source: "hook",
    kind: "agent_call",
    sessionId: "sess-delta",
    model: "claude-3.5-sonnet",
  },
  {
    id: "demo-d5-2",
    at: hoursAgo(108),
    source: "hook",
    kind: "tool_call",
    sessionId: "sess-delta",
    model: "claude-3.5-sonnet",
  },
  {
    id: "demo-d4-1",
    at: hoursAgo(86),
    source: "event",
    kind: "completion",
    sessionId: "sess-epsilon",
    model: "gpt-4o",
    inputTokens: 9400,
    outputTokens: 1800,
    cacheTokens: 500,
    contextRemaining: 0.66,
  },
  {
    id: "demo-d3-1",
    at: hoursAgo(58),
    source: "statusline",
    kind: "update",
    sessionId: "sess-epsilon",
    model: "gpt-4o",
    contextRemaining: 0.52,
  },
  {
    id: "demo-d2-1",
    at: hoursAgo(30),
    source: "cli",
    kind: "completion",
    sessionId: "sess-zeta",
    model: "gpt-4o-mini",
    inputTokens: 3100,
    outputTokens: 700,
    contextRemaining: 0.77,
  },
  {
    id: "demo-s1-1",
    at: hoursAgo(3),
    source: "event",
    kind: "completion",
    sessionId: "sess-alpha",
    model: "claude-3.5-sonnet",
    inputTokens: 18400,
    outputTokens: 3200,
    cacheTokens: 900,
    contextRemaining: 0.62,
  },
  {
    id: "demo-s1-2",
    at: hoursAgo(2.5),
    source: "hook",
    kind: "agent_call",
    sessionId: "sess-alpha",
    model: "claude-3.5-sonnet",
  },
  {
    id: "demo-s1-3",
    at: hoursAgo(2.4),
    source: "hook",
    kind: "tool_call",
    sessionId: "sess-alpha",
    model: "claude-3.5-sonnet",
  },
  {
    id: "demo-s1-4",
    at: hoursAgo(2),
    source: "statusline",
    kind: "update",
    sessionId: "sess-alpha",
    model: "claude-3.5-sonnet",
    contextRemaining: 0.48,
  },
  {
    id: "demo-s2-1",
    at: hoursAgo(1.5),
    source: "cli",
    kind: "completion",
    sessionId: "sess-beta",
    model: "gpt-4o",
    inputTokens: 7200,
    outputTokens: 1400,
    contextRemaining: 0.41,
  },
  {
    id: "demo-s2-2",
    at: hoursAgo(1.2),
    source: "cli",
    kind: "agent_call",
    sessionId: "sess-beta",
    model: "gpt-4o",
  },
  {
    id: "demo-s2-3",
    at: hoursAgo(1),
    source: "event",
    kind: "completion",
    sessionId: "sess-beta",
    model: "gpt-4o-mini",
    inputTokens: 2100,
    outputTokens: 600,
    contextRemaining: 0.55,
  },
  {
    id: "demo-s3-1",
    at: hoursAgo(0.4),
    source: "statusline",
    kind: "completion",
    sessionId: "sess-gamma",
    model: "claude-3.5-sonnet",
    inputTokens: 9800,
    outputTokens: 2100,
    cacheTokens: 400,
    contextRemaining: 0.73,
  },
  {
    id: "demo-s3-2",
    at: hoursAgo(0.2),
    source: "hook",
    kind: "agent_call",
    sessionId: "sess-gamma",
    model: "claude-3.5-sonnet",
  },
  {
    id: "demo-s3-3",
    at: hoursAgo(0.1),
    source: "hook",
    kind: "tool_call",
    sessionId: "sess-gamma",
    model: "claude-3.5-sonnet",
  },
];
