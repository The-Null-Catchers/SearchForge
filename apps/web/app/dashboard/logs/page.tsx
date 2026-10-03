"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type LogRow = {
  id: string;
  kind: "audit" | "job";
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  requestId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export default function LogsPage() {
  const { projectId } = useProject();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [kind, setKind] = useState("all");
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRows([]);
    setError("");
    setLoading(!!projectId);
    if (projectId) {
      const params = new URLSearchParams({ kind, level, q: submittedQuery, limit: "100" });
      api<{ logs: LogRow[] }>(`/v1/projects/${projectId}/logs?${params.toString()}`, { signal: controller.signal })
        .then(value => { if (!controller.signal.aborted) setRows(value.logs); })
        .catch(cause => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load logs");
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
  }, [projectId, kind, level, submittedQuery, attempt]);

  const counts = useMemo(() => ({
    errors: rows.filter(row => row.level === "error").length,
    warnings: rows.filter(row => row.level === "warn").length,
    jobs: rows.filter(row => row.kind === "job").length,
    audit: rows.filter(row => row.kind === "audit").length
  }), [rows]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  };

  return <div className="content">
    <div className="eyebrow">Observability</div>
    <h1>Developer logs</h1>
    <p className="muted">Search persisted project audit events and durable job lifecycle records. Request IDs and job IDs make it easier to correlate dashboard activity with service logs.</p>

    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginTop: 22 }}>
      <div className="card card-body"><div className="muted">Audit events</div><h2>{counts.audit}</h2></div>
      <div className="card card-body"><div className="muted">Job events</div><h2>{counts.jobs}</h2></div>
      <div className="card card-body"><div className="muted">Warnings</div><h2>{counts.warnings}</h2></div>
      <div className="card card-body"><div className="muted">Errors</div><h2>{counts.errors}</h2></div>
    </div>

    <form onSubmit={submit} className="card card-body" style={{ marginTop: 22 }}>
      <div className="grid" style={{ gridTemplateColumns: "minmax(240px,2fr) repeat(2,minmax(150px,1fr)) auto", alignItems: "end" }}>
        <div className="field">
          <label htmlFor="log-search">Search</label>
          <input id="log-search" className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="event, request ID, job type, error…" />
        </div>
        <div className="field">
          <label htmlFor="log-kind">Source</label>
          <select id="log-kind" className="input" value={kind} onChange={event => setKind(event.target.value)}>
            <option value="all">All</option><option value="audit">Audit</option><option value="job">Jobs</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="log-level">Level</label>
          <select id="log-level" className="input" value={level} onChange={event => setLevel(event.target.value)}>
            <option value="all">All</option><option value="info">Info</option><option value="warn">Warning</option><option value="error">Error</option>
          </select>
        </div>
        <button className="btn" disabled={loading}>{loading ? "Loading…" : "Search"}</button>
      </div>
    </form>

    {error && <div className="card card-body" style={{ marginTop: 22, color: "var(--danger)" }}>
      <p>{error}</p><button className="btn" onClick={() => setAttempt(value => value + 1)}>Retry</button>
    </div>}

    {!error && <section className="card" style={{ marginTop: 22 }}>
      <div className="card-head"><h2>Recent events</h2><span className="muted">Newest first · up to 100 records</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Level</th><th>Source</th><th>Event</th><th>Message</th><th>Correlation</th></tr></thead>
          <tbody>
            {rows.map(row => <tr key={row.id}>
              <td className="mono">{new Date(row.createdAt).toLocaleString()}</td>
              <td><span className="mono">{row.level.toUpperCase()}</span></td>
              <td>{row.kind === "audit" ? "Audit" : "Job"}</td>
              <td className="mono">{row.event}</td>
              <td>{row.message}</td>
              <td className="mono">{row.requestId ?? (typeof row.metadata.jobId === "string" ? row.metadata.jobId : row.targetId ?? "—")}</td>
            </tr>)}
            {rows.length === 0 && <tr><td colSpan={6} className="empty">{loading ? "Loading logs…" : "No matching events."}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>}
  </div>;
}
