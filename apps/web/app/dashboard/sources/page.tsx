"use client";
import { useLocale } from "../../../components/locale-context";
import { FormEvent, useState } from "react";
import { useProject } from "../../../components/project-context";
import { CrawlExplorer } from "../../../components/crawl-explorer";
import { SourceEditor } from "../../../components/source-editor";
import { useSources } from "../../../lib/use-sources";

export default function SourcesPage() {
  const { projectId } = useProject();
  return <ProjectSources key={projectId} projectId={projectId} />;
}

function ProjectSources({ projectId }: { projectId: string | null }) {
  const { t, locale } = useLocale();
  const { projects } = useProject();
  const { data, error, busy, loading, add, update, crawl, cancel, schedule, remove } = useSources(projectId);
  const [selected, setSelected] = useState<{ id: string; pane: "rules" | "pages" } | null>(null);
  const source = data.sources.find(item => item.id === selected?.id && !item.deletionRequestedAt);
  const canEdit = ["owner", "admin", "developer"].includes(projects.find(p => p.id === projectId)?.role ?? "");
  const canDelete = ["owner", "admin"].includes(projects.find(p => p.id === projectId)?.role ?? "");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (await add(String(fields.get("name")), String(fields.get("url")))) form.reset();
  };
  return <div className="content"><div className="eyebrow">{t("Discovery pipeline")}</div><h1>{t("Sources & crawler")}</h1>
    <p className="muted">{t("Robots-aware crawling with durable recrawl schedules. Progress refreshes every three seconds.")}</p>
    {canEdit && <form className="card card-body form-row" onSubmit={submit} style={{ marginTop: 22 }}>
      <div className="field"><label htmlFor="source-name">{t("Source name")}</label><input id="source-name" className="input" name="name" required /></div>
      <div className="field"><label htmlFor="source-url">{t("Start URL")}</label><input id="source-url" className="input" type="url" name="url" placeholder="https://docs.example.com" required /></div>
      <button className="btn primary" disabled={!!busy || !projectId}>{busy === "add" ? t("Adding…") : t("Add website")}</button>
    </form>}
    {error && <div role="alert" style={{ color: "var(--danger)", marginTop: 12 }}>{t(error)}</div>}
    <section className="card" style={{ marginTop: 14 }}><div className="card-head"><h2>{t("Websites")}</h2></div>
      <div className="table-wrap"><table><thead><tr><th>{t("Name")}</th><th>{t("Last crawled")}</th><th>{t("Recrawl schedule")}</th><th>{t("Next run")}</th><th>Actions</th></tr></thead><tbody>
        {data.sources.map(source => {
          const saved = data.schedules.find(s => s.sourceId === source.id);
          const active = data.jobs.some(j => j.sourceId === source.id && j.type === "crawl" && ["queued", "running"].includes(j.state));
          const deleting = !!source.deletionRequestedAt;
          const failedDeletion = data.jobs.some(job => job.type === "cleanup" && job.progress.targetId === source.id && job.state === "failed");
          return <tr key={source.id}><td>{source.name}{deleting && <span className="badge">deleting</span>}</td><td>{source.lastCrawledAt ? new Date(source.lastCrawledAt).toLocaleString(locale) : "Never"}</td>
            <td><select className="input" aria-label={`Recrawl schedule for ${source.name}`} disabled={!canEdit || !!busy || deleting}
              value={saved?.enabled ? saved.intervalSeconds : 0}
              onChange={event => void schedule(source.id, Number(event.target.value) || saved?.intervalSeconds || 86400, event.target.value !== "0")}>
              <option value="0">{t("Off")}</option><option value="3600">{t("Every hour")}</option><option value="21600">{t("Every 6 hours")}</option><option value="86400">{t("Daily")}</option><option value="604800">{t("Weekly")}</option>
            </select></td><td>{saved?.enabled ? new Date(saved.nextRunAt).toLocaleString(locale) : "—"}</td>
            <td><div className="toolbar">{!deleting && <><button className="btn" onClick={() => setSelected({ id: source.id, pane: "pages" })}>{t("Pages")}</button>{canEdit && <><button className="btn" onClick={() => setSelected({ id: source.id, pane: "rules" })}>{t("Rules")}</button><button className="btn" disabled={!!busy} onClick={() => void crawl(source.id)}>{active ? t("Use existing crawl") : t("Run crawl")}</button></>}</>}{canDelete && <button className="btn" disabled={!!busy || (deleting && !failedDeletion)} onClick={() => {
                const confirmation = window.prompt(`Delete ${source.name} and remove its content from every index version? Other documents stay searchable. Type the source name to confirm.`);
                if (confirmation === source.name) void remove(source.id, confirmation);
              }}>{deleting ? t("Retry deletion") : t("Delete source")}</button>}</div></td></tr>;
        })}
        {data.sources.length === 0 && <tr><td colSpan={5} className="empty">{loading ? t("Loading sources…") : t("No sources yet. Add a website to start indexing.")}</td></tr>}
      </tbody></table></div>
    </section>
    {source && selected?.pane === "rules" && canEdit && <SourceEditor key={source.id} source={source} disabled={!!busy} save={(name, config) => update(source.id, name, config)}/>}
    {source && selected?.pane === "pages" && <CrawlExplorer key={source.id} sourceId={source.id} name={source.name}/>}
    <section className="card" style={{ marginTop: 14 }}><div className="card-head"><h2>{t("Recent jobs")}</h2><span className="muted">{t("Cancellation keeps the active search version available")}</span></div>
      <div className="table-wrap"><table><thead><tr><th>{t("Type")}</th><th>Status</th><th>{t("Phase")}</th><th>{t("Processed / errors")}</th><th>{t("Created")}</th><th>Actions</th></tr></thead><tbody>
        {data.jobs.map(job => <tr key={job.id}><td>{t(job.type)}</td><td><span className="badge">{job.cancelRequestedAt && job.state === "running" ? "cancelling" : job.state}</span></td><td>{t(job.phase)}</td>
          <td>{String(job.progress.processed ?? 0)} / {String(job.progress.failed ?? 0)}</td><td>{new Date(job.createdAt).toLocaleString(locale)}</td>
          <td>{canEdit && job.type !== "cleanup" && ["queued", "running"].includes(job.state) && <button className="btn" disabled={!!busy || !!job.cancelRequestedAt} onClick={() => void cancel(job.id)}>{job.cancelRequestedAt ? t("Cancelling…") : "Cancel"}</button>}</td></tr>)}
        {!data.jobs.length && <tr><td colSpan={6} className="empty">{t("No jobs yet.")}</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
