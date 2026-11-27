"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";
import { useLocale } from "../../../components/locale-context";

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

function MetricBars({ rows, metric, formatter }: { rows: TimelineRow[]; metric: keyof Pick<TimelineRow, "searches" | "clicks" | "zeroResultRate" | "averageLatencyMs">; formatter: (value: number) => string }) {
  const { t, locale } = useLocale();
  const date = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const max = Math.max(1, ...rows.map(row => Number(row[metric])));
  if (!rows.length) return <div className="empty">{t("No events in this period.")}</div>;
  return <ul className="card-body stack analytics-bars" aria-label={t("Daily values")}>
    {rows.map(row => {
      const value = Number(row[metric]);
      return <li key={row.day}>
        <time className="muted" dateTime={row.day}>{date.format(new Date(row.day))}</time>
        <div aria-hidden="true" style={{ height: 10, borderRadius: 999, background: "var(--panel-2)", overflow: "hidden" }}>
          <div style={{ width: `${Math.max(value > 0 ? 2 : 0, Math.min(100, value / max * 100))}%`, height: "100%", background: "var(--accent)" }} />
        </div>
        <bdi className="mono">{formatter(value)}</bdi>
      </li>;
    })}
  </ul>;
}

export default function AnalyticsPage() {
  const { projectId } = useProject();
  const [days, setDays] = useState(30);
  const { t, locale } = useLocale();
  return <div className="content">
    <div className="eyebrow">{t("Search feedback")}</div>
    <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "end" }}>
      <div><h1>{t("Analytics")}</h1><p className="muted">{t("Aggregated search health with privacy thresholds for query text.")}</p></div>
      <label>{t("Window")} <select className="input" value={days} onChange={event => setDays(Number(event.target.value))} aria-label={t("Analytics time window")}>
        {[7, 30, 90].map(value => <option key={value} value={value}>{t("{count} days").replace("{count}", value.toLocaleString(locale))}</option>)}
      </select></label>
    </div>
    {projectId ? <ProjectAnalytics key={`${projectId}:${days}`} projectId={projectId} days={days} /> : <p className="empty">{t("Select a project to view analytics.")}</p>}
  </div>;
}

function ProjectAnalytics({ projectId, days }: { projectId: string; days: number }) {
  const { t, locale } = useLocale();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<AnalyticsData>(`/v1/projects/${projectId}/analytics?days=${days}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load analytics"); });
    return () => controller.abort();
  }, [projectId, days, attempt]);

  const maxQueryCount = useMemo(() => Math.max(1, ...[...(data?.topQueries ?? []), ...(data?.zeroResultQueries ?? [])].map(row => Number(row.searches))), [data]);
  if (error) return <div className="card card-body" role="alert" style={{ color: "var(--danger)", marginTop: 18 }}><p>{t(error)}</p><button className="btn" onClick={() => { setError(""); setAttempt(value => value + 1); }}>{t("Retry")}</button></div>;
  if (!data) return <div className="card empty" style={{ marginTop: 18 }} role="status">{t("Loading analytics…")}</div>;

  const count = new Intl.NumberFormat(locale).format;
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format;
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format;
  const latency = (value: number) => `${decimal(value)} ${t("ms")}`;
  const table = (rows: QueryRow[], empty: string) => <div className="table-wrap">
    <table>
      <thead><tr><th>{t("Query")}</th><th>{t("Searches")}</th><th>{t("Avg latency")}</th></tr></thead>
      <tbody>
        {rows.map(row => <tr key={row.query}>
          <td><div dir="auto">{row.query}</div><div style={{ marginTop: 6, height: 6, maxWidth: 220, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}><div style={{ width: `${Math.max(4, Number(row.searches) / maxQueryCount * 100)}%`, height: "100%", background: "var(--accent)" }} /></div></td>
          <td>{count(row.searches)}</td>
          <td>{row.averageLatencyMs !== null && row.averageLatencyMs !== undefined ? latency(Number(row.averageLatencyMs)) : "—"}</td>
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={3} className="empty">{t(empty)}</td></tr>}
      </tbody>
    </table>
  </div>;

  return <>
    {!data.analyticsEnabled && <div className="card card-body" style={{ marginTop: 18 }}><strong>{t("Analytics collection is disabled.")}</strong><p className="muted">{t("Historical aggregates remain available. SearchForge has paused recording new searches and clicks.")}</p></div>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", marginTop: 18 }}>
        <section className="card card-body"><div className="muted">{t("Searches")}</div><h2>{count(data.summary.searches)}</h2></section>
        <section className="card card-body"><div className="muted">{t("Clicks")}</div><h2>{count(data.summary.clicks)}</h2></section>
        <section className="card card-body"><div className="muted">{t("Click-through")}</div><h2>{percent(data.summary.clickThroughRate)}</h2></section>
        <section className="card card-body"><div className="muted">{t("Zero-result rate")}</div><h2>{percent(data.summary.zeroResultRate)}</h2></section>
        <section className="card card-body"><div className="muted">{t("Average latency")}</div><h2>{latency(data.summary.averageLatencyMs)}</h2></section>
      </div>

      <div className="grid analytics-grid">
        <section className="card"><div className="card-head"><h2>{t("Search volume")}</h2><span className="muted">{t("Daily totals in UTC")}</span></div><MetricBars rows={data.timeline} metric="searches" formatter={count} /></section>
        <section className="card"><div className="card-head"><h2>{t("Zero-result rate")}</h2></div><MetricBars rows={data.timeline} metric="zeroResultRate" formatter={percent} /></section>
        <section className="card"><div className="card-head"><h2>{t("Click volume")}</h2></div><MetricBars rows={data.timeline} metric="clicks" formatter={count} /></section>
        <section className="card"><div className="card-head"><h2>{t("Search latency")}</h2><span className="muted">{t("Average per day")}</span></div><MetricBars rows={data.timeline} metric="averageLatencyMs" formatter={latency} /></section>
      </div>

      <div className="card card-body" style={{ marginTop: 18 }}>
        <strong>{t("Query privacy threshold")}</strong>
        <p className="muted">{t("Queries appear when the same text occurs at least {count} times in the selected window.").replace("{count}", count(data.privacyThreshold))}</p>
      </div>

      <div className="grid analytics-grid">
        <section className="card"><div className="card-head"><h2>{t("Top repeated queries")}</h2></div>{table(data.topQueries, "No query meets the privacy threshold.")}</section>
        <section className="card"><div className="card-head"><h2>{t("Repeated zero-result queries")}</h2></div>{table(data.zeroResultQueries, "No zero-result query meets the privacy threshold.")}</section>
      </div>
  </>;
}
