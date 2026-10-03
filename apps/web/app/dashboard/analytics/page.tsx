"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type QueryRow = { query: string; searches: number; averageLatencyMs?: string | null };
type TimelineRow = { day: string; searches: number; clicks: number; zeroResultRate: number; averageLatencyMs: number };
type AnalyticsData = {
  days: number;
  analyticsEnabled: boolean;
  privacyThreshold: number;
  summary: { searches: number; clicks: number; clickThroughRate: number; zeroResultRate: number; averageLatencyMs: number };
  timeline: TimelineRow[];
  topQueries: QueryRow[];
  zeroResultQueries: QueryRow[];
};

const emptyData: AnalyticsData = {
  days: 30,
  analyticsEnabled: true,
  privacyThreshold: 3,
  summary: { searches: 0, clicks: 0, clickThroughRate: 0, zeroResultRate: 0, averageLatencyMs: 0 },
  timeline: [],
  topQueries: [],
  zeroResultQueries: []
};

function MetricBars({ rows, metric, formatter }: { rows: TimelineRow[]; metric: keyof Pick<TimelineRow, "searches" | "clicks" | "zeroResultRate" | "averageLatencyMs">; formatter: (value: number) => string }) {
  const max = Math.max(1, ...rows.map(row => Number(row[metric])));
  if (!rows.length) return <div className="empty">No events in this period.</div>;
  return <div className="card-body stack" role="img" aria-label={`${metric} by day`}>
    {rows.map(row => {
      const value = Number(row[metric]);
      return <div key={row.day} style={{ display: "grid", gridTemplateColumns: "82px 1fr 72px", gap: 10, alignItems: "center" }}>
        <span className="muted mono">{row.day.slice(5)}</span>
        <div style={{ height: 10, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
          <div style={{ width: `${Math.max(value > 0 ? 2 : 0, Math.min(100, value / max * 100))}%`, height: "100%", background: "var(--accent)" }} />
        </div>
        <span className="mono" style={{ textAlign: "right" }}>{formatter(value)}</span>
      </div>;
    })}
  </div>;
}

export default function AnalyticsPage() {
  const { projectId } = useProject();
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<AnalyticsData>(emptyData);

  useEffect(() => {
    const controller = new AbortController();
    setData({ ...emptyData, days });
    setError("");
    setLoading(!!projectId);
    if (projectId) {
      api<AnalyticsData>(`/v1/projects/${projectId}/analytics?days=${days}`, { signal: controller.signal })
        .then(value => { if (!controller.signal.aborted) setData(value); })
        .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load analytics"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
  }, [projectId, days, attempt]);

  const maxQueryCount = useMemo(() => Math.max(1, ...data.topQueries.map(row => Number(row.searches))), [data.topQueries]);
  const table = (rows: QueryRow[], empty: string) => <div className="table-wrap">
    <table>
      <thead><tr><th>Query</th><th>Searches</th><th>Avg latency</th></tr></thead>
      <tbody>
        {rows.map(row => <tr key={row.query}>
          <td><div dir="auto">{row.query}</div><div style={{ marginTop: 6, height: 6, maxWidth: 220, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}><div style={{ width: `${Math.max(4, Number(row.searches) / maxQueryCount * 100)}%`, height: "100%", background: "var(--accent)" }} /></div></td>
          <td>{row.searches}</td>
          <td>{row.averageLatencyMs ? `${Number(row.averageLatencyMs).toFixed(1)} ms` : "—"}</td>
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={3} className="empty">{loading ? "Loading analytics…" : empty}</td></tr>}
      </tbody>
    </table>
  </div>;

  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  return <div className="content">
    <div className="eyebrow">Search feedback</div>
    <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "end" }}>
      <div><h1>Analytics</h1><p className="muted">Aggregated search health with privacy thresholds for query text.</p></div>
      <label>Window <select className="input" value={days} onChange={event => setDays(Number(event.target.value))} aria-label="Analytics time window">
        <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
      </select></label>
    </div>

    {!data.analyticsEnabled && <div className="card card-body" style={{ marginTop: 18 }}><strong>Analytics collection is disabled.</strong><p className="muted">Historical aggregate data remains visible, but new searches and clicks are not stored while collection is disabled.</p></div>}
    {error && <div className="card card-body" role="alert" style={{ color: "var(--danger)", marginTop: 18 }}><p>{error}</p><button className="btn" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}

    {!error && <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", marginTop: 18 }}>
        <section className="card card-body"><div className="muted">Searches</div><h2>{data.summary.searches.toLocaleString()}</h2></section>
        <section className="card card-body"><div className="muted">Clicks</div><h2>{data.summary.clicks.toLocaleString()}</h2></section>
        <section className="card card-body"><div className="muted">Click-through</div><h2>{percent(data.summary.clickThroughRate)}</h2></section>
        <section className="card card-body"><div className="muted">Zero-result rate</div><h2>{percent(data.summary.zeroResultRate)}</h2></section>
        <section className="card card-body"><div className="muted">Average latency</div><h2>{data.summary.averageLatencyMs.toFixed(1)} ms</h2></section>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", marginTop: 18 }}>
        <section className="card"><div className="card-head"><h2>Search volume</h2><span className="muted">UTC daily buckets</span></div><MetricBars rows={data.timeline} metric="searches" formatter={value => Math.round(value).toString()} /></section>
        <section className="card"><div className="card-head"><h2>Zero-result rate</h2><span className="muted">Search quality signal</span></div><MetricBars rows={data.timeline} metric="zeroResultRate" formatter={percent} /></section>
        <section className="card"><div className="card-head"><h2>Click volume</h2><span className="muted">Accepted click events</span></div><MetricBars rows={data.timeline} metric="clicks" formatter={value => Math.round(value).toString()} /></section>
        <section className="card"><div className="card-head"><h2>Search latency</h2><span className="muted">Average per day</span></div><MetricBars rows={data.timeline} metric="averageLatencyMs" formatter={value => `${value.toFixed(1)} ms`} /></section>
      </div>

      <div className="card card-body" style={{ marginTop: 18 }}>
        <strong>Query privacy guard</strong>
        <p className="muted">Query text is returned only when the same exact query appears at least {data.privacyThreshold} times inside the selected window. One-off and low-frequency queries remain suppressed from this dashboard.</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", marginTop: 18 }}>
        <section className="card"><div className="card-head"><h2>Top repeated queries</h2></div>{table(data.topQueries, `No query meets the ${data.privacyThreshold}-search privacy threshold.`)}</section>
        <section className="card"><div className="card-head"><h2>Repeated zero-result queries</h2></div>{table(data.zeroResultQueries, `No zero-result query meets the ${data.privacyThreshold}-search privacy threshold.`)}</section>
      </div>
    </>}
  </div>;
}
