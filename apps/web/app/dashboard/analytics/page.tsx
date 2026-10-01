"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type Row = {
  query: string;
  searches: number;
  averageLatencyMs?: string | null;
};
export default function AnalyticsPage() {
  const { projectId } = useProject();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{
    topQueries: Row[];
    zeroResultQueries: Row[];
  }>({ topQueries: [], zeroResultQueries: [] });
  useEffect(() => {
    const controller = new AbortController();
    setData({ topQueries: [], zeroResultQueries: [] });
    setError("");
    setLoading(!!projectId);
    if (projectId) {
      api<typeof data>(`/v1/projects/${projectId}/analytics`, {
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted) setData(value);
        })
        .catch((err) => {
          if (!controller.signal.aborted)
            setError(
              err instanceof Error ? err.message : "Unable to load analytics",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }
    return () => controller.abort();
  }, [projectId, attempt]);
  const table = (rows: Row[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Query</th>
            <th>Searches</th>
            <th>Avg latency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.query}>
              <td className="mono">{r.query}</td>
              <td>{r.searches}</td>
              <td>
                {r.averageLatencyMs
                  ? Number(r.averageLatencyMs).toFixed(1) + " ms"
                  : "—"}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="empty">
                {loading ? "Loading analytics…" : "No search events yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="content">
      <div className="eyebrow">Search feedback</div>
      <h1>Analytics</h1>
      <p className="muted">
        Queries are analytics-only by default and never alter ranking unless a
        future ranking experiment explicitly enables that behavior.
      </p>
      <div role="status" aria-live="polite">
        {error && (
          <div
            className="card card-body"
            style={{ color: "var(--danger)", marginTop: 22 }}
          >
            <p>{error}</p>
            <button
              className="btn"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        )}
      </div>
      {!error && (
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))",
            marginTop: 22,
          }}
        >
          <section className="card">
            <div className="card-head">
              <h2>Top queries</h2>
            </div>
            {table(data.topQueries)}
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Zero-result queries</h2>
            </div>
            {table(data.zeroResultQueries)}
          </section>
        </div>
      )}
    </div>
  );
}
