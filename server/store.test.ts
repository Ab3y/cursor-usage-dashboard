import { describe, expect, it } from "vitest";
import {
  buildTimeseries,
  demoEvents,
  eventsToCsv,
  UsageStore,
  type UsageEvent,
} from "./store.js";

const base = (partial: Partial<UsageEvent> & Pick<UsageEvent, "id" | "kind">): UsageEvent => ({
  at: new Date().toISOString(),
  source: "event",
  ...partial,
});

describe("UsageStore", () => {
  it("normalizes events and preserves context/quota distinction", () => {
    const store = new UsageStore();
    store.add(base({ id: "1", source: "statusline", kind: "update", contextRemaining: 0.25 }));
    const result = store.snapshot();
    expect(result.contextWindowRemaining).toBe(0.25);
    expect(result.accountQuotaRemaining).toBeUndefined();
    expect(result.quotaAvailable).toBe(false);
  });

  it("deduplicates by event id", () => {
    const store = new UsageStore();
    const event = base({ id: "dup", kind: "completion", inputTokens: 10 });
    store.add(event);
    store.add({ ...event, inputTokens: 99 });
    expect(store.snapshot().events).toHaveLength(1);
    expect(store.snapshot().totals.inputTokens).toBe(10);
  });

  it("aggregates tokens and groups sessions and models", () => {
    const store = new UsageStore();
    store.add(
      base({
        id: "a1",
        kind: "completion",
        sessionId: "s1",
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 20,
        cacheTokens: 5,
        contextRemaining: 0.8,
      }),
    );
    store.add(base({ id: "a2", kind: "agent_call", sessionId: "s1", model: "gpt-4o" }));
    store.add(
      base({
        id: "b1",
        at: new Date(Date.now() + 1000).toISOString(),
        kind: "completion",
        sessionId: "s2",
        model: "claude-3.5-sonnet",
        inputTokens: 50,
        outputTokens: 10,
        contextRemaining: 0.5,
      }),
    );
    store.add(base({ id: "b2", kind: "tool_call", sessionId: "s2", model: "claude-3.5-sonnet" }));

    const snap = store.snapshot();
    expect(snap.totals).toMatchObject({
      inputTokens: 150,
      outputTokens: 30,
      cacheTokens: 5,
      totalTokens: 185,
      agentCalls: 1,
      toolCalls: 1,
    });
    expect(snap.sessions).toHaveLength(2);
    expect(snap.activeSession?.sessionId).toBe("s2");
    expect(snap.sessions.find((s) => s.sessionId === "s1")).toMatchObject({
      totalTokens: 125,
      contextRemaining: 0.8,
      agentCalls: 1,
    });
    expect(snap.models.map((m) => m.model).sort()).toEqual(["claude-3.5-sonnet", "gpt-4o"]);
    expect(snap.models.find((m) => m.model === "gpt-4o")?.eventCount).toBe(2);
    expect(snap.timeseries.length).toBeGreaterThan(0);
  });

  it("marks missing/optional fields as unavailable rather than inventing them", () => {
    const store = new UsageStore();
    store.add(base({ id: "sparse", kind: "cli_signal" }));
    const snap = store.snapshot();
    expect(snap.contextWindowRemaining).toBeUndefined();
    expect(snap.activeSession?.contextRemaining).toBeUndefined();
    expect(snap.accountQuotaRemaining).toBeUndefined();
    expect(snap.quotaAvailable).toBe(false);
    expect(snap.models).toHaveLength(0);
  });

  it("never conflates context remaining with account quota", () => {
    const store = new UsageStore();
    store.add(base({ id: "ctx", kind: "update", contextRemaining: 0.9, sessionId: "s" }));
    const snap = store.snapshot();
    expect(snap.contextWindowRemaining).toBe(0.9);
    expect(snap.quotaAvailable).toBe(false);
    expect(snap.accountQuotaRemaining).not.toBe(snap.contextWindowRemaining);
  });

  it("loads demo fixtures with multiple sessions, models, and agent_call events", () => {
    const store = new UsageStore();
    demoEvents.forEach((e) => store.add(e));
    const snap = store.snapshot(new Date(), { range: "28d" });
    expect(snap.sessions.length).toBeGreaterThanOrEqual(3);
    expect(snap.models.length).toBeGreaterThanOrEqual(2);
    expect(snap.totals.agentCalls).toBeGreaterThanOrEqual(2);
    expect(snap.totals.toolCalls).toBeGreaterThanOrEqual(1);
    expect(snap.sources.length).toBeGreaterThan(1);
    expect(snap.timeseries.length).toBeGreaterThan(1);
  });

  it("filters by time range, source, and model", () => {
    const store = new UsageStore();
    demoEvents.forEach((e) => store.add(e));
    const recent = store.snapshot(new Date(), { range: "24h" });
    const all = store.snapshot(new Date(), { range: "28d" });
    expect(recent.events.length).toBeLessThan(all.events.length);
    const cliOnly = store.snapshot(new Date(), { range: "28d", source: "cli" });
    expect(cliOnly.events.every((e) => e.source === "cli")).toBe(true);
    const modelOnly = store.snapshot(new Date(), { range: "28d", model: "gpt-4o" });
    expect(modelOnly.events.every((e) => e.model === "gpt-4o")).toBe(true);
    expect(modelOnly.availableModels.length).toBeGreaterThan(0);
  });

  it("builds timeseries buckets and CSV without fabricating values", () => {
    const events: UsageEvent[] = [
      base({ id: "t1", kind: "completion", inputTokens: 10, outputTokens: 2, at: hoursAgoIso(2) }),
      base({ id: "t2", kind: "agent_call", at: hoursAgoIso(1) }),
    ];
    const series = buildTimeseries(events, "24h");
    expect(series.reduce((sum, p) => sum + p.totalTokens, 0)).toBe(12);
    expect(series.reduce((sum, p) => sum + p.agentCalls, 0)).toBe(1);
    const csv = eventsToCsv(events);
    expect(csv.split("\n")[0]).toContain("contextRemaining");
    expect(csv).toContain("t1");
    expect(csv).not.toContain("undefined");
  });
});

const hoursAgoIso = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
