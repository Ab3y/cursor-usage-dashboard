import express from "express";
import { createCollectors } from "./collectors.js";
import {
  demoEvents,
  eventsToCsv,
  isEventSource,
  isTimeRange,
  UsageStore,
  type SnapshotQuery,
  type TimeRange,
} from "./store.js";

const store = new UsageStore();
demoEvents.forEach((event) => store.add(event));
const collectors = createCollectors(store);
const app = express();
app.use(express.json({ limit: "64kb" }));

const parseQuery = (req: express.Request): SnapshotQuery => {
  const rangeRaw = typeof req.query.range === "string" ? req.query.range : "7d";
  const range: TimeRange = isTimeRange(rangeRaw) ? rangeRaw : "7d";
  const sourceRaw = typeof req.query.source === "string" ? req.query.source : undefined;
  const model = typeof req.query.model === "string" && req.query.model ? req.query.model : undefined;
  return {
    range,
    source: sourceRaw && isEventSource(sourceRaw) ? sourceRaw : undefined,
    model,
  };
};

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/usage", (req, res) => {
  res.json(store.snapshot(new Date(), parseQuery(req)));
});

app.get("/api/export", (req, res) => {
  const format = typeof req.query.format === "string" ? req.query.format : "json";
  const snap = store.snapshot(new Date(), parseQuery(req));
  if (format === "csv") {
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", 'attachment; filename="cursor-usage.csv"');
    return res.send(eventsToCsv(snap.events));
  }
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-disposition", 'attachment; filename="cursor-usage.json"');
  res.json(snap);
});

app.post("/api/events", (req, res) => {
  const source = req.body?.source;
  if (!isEventSource(source) || typeof req.body?.kind !== "string") {
    return res.status(400).json({ error: "source and kind are required" });
  }
  const collector = collectors[source];
  res.status(201).json(collector(req.body));
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`Usage service listening on http://localhost:${port}`));
