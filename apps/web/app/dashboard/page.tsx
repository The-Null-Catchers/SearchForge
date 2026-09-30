"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useProject } from "../../components/project-context";

type Overview = {
  documents: number;
  searches: number;
  averageLatencyMs: number;
  zeroResultRate: number;
  activeJobs: number;
  sources: number;
  indexes: Array<{ indexId: string; indexName: string; version: number | null; documentCount: number | null; indexedBytes: number | null }>;
};

export default function OverviewPage() {
  const { projectId, projects, refresh, loading } = useProject();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [createdSecrets, setCreatedSecrets] = useState<{ searchKey:string; adminKey:string } | null>(null);

  useEffect(() => {
    if (!projectId) { setOverview(null); return; }
    api<Overview>(`/v1/projects/${projectId}/overview`).then(setOverview).catch((err) => setError(err.message));
  }, [projectId]);

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const org = await api<{id:string}>("/v1/organizations", {
        method:"POST",
        body:JSON.stringify({ name:data.get("organizationName"), slug:data.get("organizationSlug") })
      });
      const project = await api<{id:string;searchKey:string;adminKey:string}>(`/v1/organizations/${org.id}/projects`, {
        method:"POST",
        body:JSON.stringify({ name:data.get("projectName"), slug:data.get("projectSlug"), defaultLanguage:"auto", supportedLanguages:["en","ar"] })
      });
      localStorage.setItem("sf_project_id", project.id);
      sessionStorage.setItem(`sf_search_key:${project.id}`, project.searchKey);
      setCreatedSecrets({searchKey:project.searchKey,adminKey:project.adminKey});
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to create workspace"); }
  };

  if (loading) return <div className="content"><div className="card empty">Loading workspace…</div></div>;

  if (projects.length === 0) {
    return (
      <div className="content">
        <div className="eyebrow">First run</div><h1>Create your search workspace</h1>
        <p className="muted">Create an organization and your first project. SearchForge will create a default <span className="mono">docs</span> index and one-time API secrets.</p>
        <form className="card card-body stack" onSubmit={createWorkspace} style={{maxWidth:760,marginTop:22}}>
          <div className="form-row">
            <div className="field"><label>Organization</label><input className="input" name="organizationName" required /></div>
            <div className="field"><label>Organization slug</label><input className="input mono" name="organizationSlug" pattern="[a-z0-9][a-z0-9-]{1,78}[a-z0-9]" required /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Project</label><input className="input" name="projectName" required /></div>
            <div className="field"><label>Project slug</label><input className="input mono" name="projectSlug" pattern="[a-z0-9][a-z0-9-]{1,78}[a-z0-9]" required /></div>
          </div>
          {error && <div style={{color:"var(--danger)"}}>{error}</div>}
          <button className="btn primary">Create workspace</button>
        </form>
      </div>
    );
  }

  return (
    <div className="content">
      <div className="eyebrow">Control plane</div><h1>Search overview</h1><p className="muted">Live metadata from the selected project. Search metrics begin populating as API traffic arrives.</p>
      {createdSecrets && <div className="card card-body stack" style={{marginTop:18}}><h2>Copy these secrets now</h2><div className="muted">SearchForge stores only digests and cannot show the full values again.</div><div className="secret mono">{createdSecrets.searchKey}</div><div className="secret mono">{createdSecrets.adminKey}</div></div>}
      {error && <div className="card card-body" style={{color:"var(--danger)",marginTop:16}}>{error}</div>}
      <div className="grid metrics">
        {[
          ["Indexed documents", overview?.documents ?? "—"],
          ["Search requests", overview?.searches ?? "—"],
          ["Avg latency", overview ? `${overview.averageLatencyMs.toFixed(1)} ms` : "—"],
          ["Zero-result rate", overview ? `${(overview.zeroResultRate*100).toFixed(1)}%` : "—"],
          ["Active jobs", overview?.activeJobs ?? "—"],
          ["Sources", overview?.sources ?? "—"]
        ].map(([label,value]) => <div className="card metric" key={label}><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>)}
      </div>
      <section className="card">
        <div className="card-head"><h2>Active index versions</h2><span className="badge">atomic activation</span></div>
        <div className="table-wrap"><table><thead><tr><th>Index</th><th>Version</th><th>Documents</th><th>Size</th></tr></thead><tbody>
          {(overview?.indexes ?? []).map((index) => <tr key={index.indexId}><td>{index.indexName}</td><td className="mono">{index.version ?? "not built"}</td><td>{index.documentCount ?? 0}</td><td>{index.indexedBytes ? `${(index.indexedBytes/1024).toFixed(1)} KB` : "—"}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
