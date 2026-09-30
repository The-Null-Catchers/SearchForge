"use client";
import { FormEvent } from "react";
import { useProject } from "../../../components/project-context";
import { useSources } from "../../../lib/use-sources";

export default function SourcesPage() {
  const { projectId, projects } = useProject();
  const { data, error, busy, loading, add, crawl, cancel, schedule } = useSources(projectId);
  const canEdit = ["owner", "admin", "developer"].includes(projects.find(p => p.id === projectId)?.role ?? "");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (await add(String(fields.get("name")), String(fields.get("url")))) form.reset();
  };
  return <div className="content"><div className="eyebrow">Discovery pipeline</div><h1>Sources & crawler</h1>
    <p className="muted">Robots-aware crawling with durable recrawl schedules. Progress refreshes every three seconds.</p>
    {canEdit && <form className="card card-body form-row" onSubmit={submit} style={{ marginTop: 22 }}>
      <div className="field"><label htmlFor="source-name">Source name</label><input id="source-name" className="input" name="name" required /></div>
      <div className="field"><label htmlFor="source-url">Start URL</label><input id="source-url" className="input" type="url" name="url" placeholder="https://docs.example.com" required /></div>
      <button className="btn primary" disabled={!!busy || !projectId}>{busy === "add" ? "Adding…" : "Add website"}</button>
    </form>}
    {error && <div role="alert" style={{ color: "var(--danger)", marginTop: 12 }}>{error}</div>}
    <section className="card" style={{ marginTop: 14 }}><div className="card-head"><h2>Websites</h2></div>
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Last crawled</th><th>Recrawl schedule</th><th>Next run</th><th>Actions</th></tr></thead><tbody>
        {data.sources.map(source => {
          const saved = data.schedules.find(s => s.sourceId === source.id);
          const active = data.jobs.some(j => j.sourceId === source.id && j.type === "crawl" && ["queued", "running"].includes(j.state));
          return <tr key={source.id}><td>{source.name}</td><td>{source.lastCrawledAt ? new Date(source.lastCrawledAt).toLocaleString() : "Never"}</td>
            <td><select className="input" aria-label={`Recrawl schedule for ${source.name}`} disabled={!canEdit || !!busy}
              value={saved?.enabled ? saved.intervalSeconds : 0}
              onChange={event => void schedule(source.id, Number(event.target.value) || saved?.intervalSeconds || 86400, event.target.value !== "0")}>
              <option value="0">Off</option><option value="3600">Every hour</option><option value="21600">Every 6 hours</option><option value="86400">Daily</option><option value="604800">Weekly</option>
            </select></td><td>{saved?.enabled ? new Date(saved.nextRunAt).toLocaleString() : "—"}</td>
            <td>{canEdit && <button className="btn" disabled={!!busy} onClick={() => void crawl(source.id)}>{active ? "Use existing crawl" : "Run crawl"}</button>}</td></tr>;
        })}
        {data.sources.length === 0 && <tr><td colSpan={5} className="empty">{loading ? "Loading sources…" : "No sources yet. Add a website to start indexing."}</td></tr>}
      </tbody></table></div>
    </section>
    <section className="card" style={{ marginTop: 14 }}><div className="card-head"><h2>Recent jobs</h2><span className="muted">Cancellation keeps the active search version available</span></div>
      <div className="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Phase</th><th>Processed / errors</th><th>Created</th><th>Actions</th></tr></thead><tbody>
        {data.jobs.map(job => <tr key={job.id}><td>{job.type}</td><td><span className="badge">{job.cancelRequestedAt && job.state === "running" ? "cancelling" : job.state}</span></td><td>{job.phase}</td>
          <td>{String(job.progress.processed ?? 0)} / {String(job.progress.failed ?? 0)}</td><td>{new Date(job.createdAt).toLocaleString()}</td>
          <td>{canEdit && ["queued", "running"].includes(job.state) && <button className="btn" disabled={!!busy || !!job.cancelRequestedAt} onClick={() => void cancel(job.id)}>{job.cancelRequestedAt ? "Cancelling…" : "Cancel"}</button>}</td></tr>)}
        {!data.jobs.length && <tr><td colSpan={6} className="empty">No jobs yet.</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
