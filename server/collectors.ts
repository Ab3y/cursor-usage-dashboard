import { randomUUID } from "node:crypto";
import { UsageStore, type EventSource, type UsageEvent } from "./store.js";

export type Collector = (payload: Partial<UsageEvent> & { kind: string }) => UsageEvent;
const collect = (source: EventSource, store: UsageStore): Collector => (payload) => {
  const event: UsageEvent = { ...payload, id: payload.id ?? randomUUID(), at: payload.at ?? new Date().toISOString(), source };
  store.add(event);
  return event;
};

export type Collectors = Record<EventSource, Collector>;

export const createCollectors = (store: UsageStore): Collectors => ({
  cli: collect("cli", store),
  statusline: collect("statusline", store),
  hook: collect("hook", store),
  event: collect("event", store),
});

// Optional desktop adapter boundary: implementations can bridge native APIs without
// coupling the normalized store or dashboard to Electron/Tauri. Do not scrape Cursor UI
// or private/undocumented databases from adapters.
export interface DesktopAdapter {
  start(onEvent: (event: UsageEvent) => void): Promise<void>;
  stop(): Promise<void>;
}
