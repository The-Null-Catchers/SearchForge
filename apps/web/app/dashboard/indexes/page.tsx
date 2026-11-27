"use client";
import { useLocale } from "../../../components/locale-context";
import { FormEvent } from "react";
import { useProject } from "../../../components/project-context";
import { DocumentEditor } from "../../../components/document-editor";
import { useIndexExplorer } from "../../../lib/use-index-explorer";
import { safeExternalUrl } from "../../../lib/source-form";

export default function IndexesPage() {
  const { projectId } = useProject();
  return <ProjectIndexes key={projectId} projectId={projectId} />;
}

function ProjectIndexes({ projectId }: { projectId: string | null }) {
  const { t, locale } = useLocale();
  const { projects } = useProject();
  const ex = useIndexExplorer(projectId);
  const role = projects.find(project => project.id === projectId)?.role ?? "";
  const canEdit = ["owner", "admin", "developer"].includes(role);
  const canDelete = ["owner", "admin"].includes(role);
  const pending = !!ex.job && ["queued", "running"].includes(ex.job.state);
  const filter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    ex.filter(String(values.get("q") ?? ""), String(values.get("status") ?? "live"));
  };
  const detail = ex.detail;
  const externalUrl = safeExternalUrl(detail?.body.url);

  return <div className="content">
    <div className="eyebrow">{t("Immutable segments")}</div>
    <h1>{t("Index explorer")}</h1>
    <p className="muted">{t("Inspect and safely edit stored documents, compare them with the active immutable search version, and rebuild without search downtime.")}</p>
    {ex.error && <p role="alert" style={{ color: "var(--danger)" }}>{t(ex.error)}</p>}

    <div className="card card-body toolbar" style={{ marginTop: 20 }}>
      <label>{t("Index")} <select className="input" value={ex.indexId} disabled={ex.busy} onChange={event => ex.selectIndex(event.target.value)}>
        {!ex.indexes.length && <option value="">{t("No indexes")}</option>}
        {ex.indexes.map(index => <option key={index.id} value={index.id}>{index.name} · {index.slug}</option>)}
      </select></label>
      {canEdit && <button className="btn primary" disabled={!ex.indexId || ex.busy || pending} onClick={() => void ex.rebuild()}>{t("Rebuild index")}</button>}
      {canDelete && <button className="btn" disabled={!ex.indexId || ex.busy} onClick={() => {
        const selected = ex.indexes.find(index => index.id === ex.indexId);
        if (!selected) return;
        const confirmation = window.prompt(`Permanently delete ${selected.name}, all documents and every index version? Search stops immediately. Type ${selected.slug} to confirm.`);
        if (confirmation === selected.slug) void ex.deleteIndex(confirmation);
      }}>{t("Delete index")}</button>}
      {ex.job && <span role="status" className="badge">{t(ex.job.state)} · {t(ex.job.phase)}</span>}
    </div>

    {ex.indexId && <section className="card" style={{ marginTop: 14 }}>
      <div className="card-head"><h2>{t("Index versions")}</h2></div>
      <div className="table-wrap"><table><thead><tr><th>{t("Version")}</th><th>{t("State")}</th><th>{t("Documents")}</th><th>{t("Size")}</th><th>{t("Actions")}</th></tr></thead><tbody>
        {ex.versions.map(version => <tr key={version.id}>
          <td className="mono">v{version.sequence}</td>
          <td><span className="badge">{t(version.state)}</span></td>
          <td>{version.documentCount.toLocaleString(locale)}</td>
          <td>{(version.indexedBytes / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KB</td>
          <td>{canEdit && ["ready", "retired"].includes(version.state) && <button className="btn" disabled={ex.busy || pending} onClick={() => {
            if (window.confirm(`Activate version ${version.sequence}? Search results will use this version.`)) void ex.activate(version.id);
          }}>{t("Activate")}</button>}</td>
        </tr>)}
        {!ex.versions.length && <tr><td colSpan={5} className="empty">{ex.loading ? t("Loading versions…") : t("No builds yet. Push documents or run a crawl.")}</td></tr>}
      </tbody></table></div>
    </section>}

    {ex.indexId && <div className="split" style={{ marginTop: 14 }}>
      <section className="card">
        <div className="card-head"><h2>{t("Stored documents")}</h2><span className="muted">{t("Metadata browser")}</span></div>
        <form key={ex.indexId} className="toolbar card-body" onSubmit={filter}>
          <input className="input" name="q" placeholder={t("Filter ID, title or content")} aria-label={t("Filter documents")} maxLength={200}/>
          <select className="input" name="status" aria-label={t("Document state")} defaultValue="live">
            <option value="live">{t("Live documents")}</option><option value="deleted">{t("Deleted documents")}</option><option value="all">{t("All documents")}</option>
          </select>
          <button className="btn" disabled={ex.loading}>{t("Apply")}</button>
        </form>
        <div className="table-wrap"><table><thead><tr><th>{t("Document")}</th><th>{t("Language")}</th><th>{t("Updated")}</th><th></th></tr></thead><tbody>
          {ex.page.documents.map(document => <tr key={document.documentId}>
            <td><strong dir="auto">{document.title}</strong><div className="muted mono" dir="auto">{document.documentId}</div>{document.deletedAt && <span className="badge">{t("deleted")}</span>}</td>
            <td>{document.language ?? t("auto")}</td>
            <td>{new Date(document.updatedAt).toLocaleString(locale)}</td>
            <td><button className="btn" disabled={ex.busy} onClick={() => void ex.inspect(document.documentId)}>{t("Inspect")}</button></td>
          </tr>)}
          {!ex.page.documents.length && <tr><td colSpan={4} className="empty">{ex.loading ? t("Loading documents…") : t("No documents match these filters.")}</td></tr>}
        </tbody></table></div>
        <div className="toolbar card-body"><button className="btn" disabled={ex.loading} onClick={ex.first}>{t("First page")}</button><button className="btn" disabled={ex.loading || !ex.page.nextAfter} onClick={ex.next}>{t("Next page")}</button></div>
      </section>

      <section className="card">
        <div className="card-head"><h2>{t("Document inspection")}</h2>{detail && <span className="badge">{t(detail.state)}</span>}</div>
        {!detail ? <div className="empty">{t("Select a document to inspect its fields and indexed terms.")}</div> : <div className="card-body stack">
          <div>
            <h2 dir="auto">{typeof detail.body.title === "string" ? detail.body.title : detail.documentId}</h2>
            <p className="muted">Active version: {detail.activeVersion ? `v${detail.activeVersion}` : t("none")} · {detail.inActiveVersion ? t("Present in active index") : t("Absent from active index")}</p>
            {detail.state === "pending" && <p className="muted">{t("Stored changes await a successful rebuild.")}</p>}
            {detail.state === "deleted" && detail.inActiveVersion && <p className="muted">{t("Deletion is pending in the active search version.")}</p>}
            {externalUrl && <a className="btn" href={externalUrl} target="_blank" rel="noopener noreferrer">{t("Open page")}</a>}
          </div>

          {canEdit && !detail.deletedAt && <DocumentEditor
            documentId={detail.documentId}
            body={detail.body}
            disabled={ex.busy || pending}
            onSave={body => ex.save(detail.documentId, body)}
          />}

          {typeof detail.body.content === "string" && <div className="document-preview" dir="auto">{detail.body.content.slice(0, 6000)}{detail.body.content.length > 6000 && "…"}</div>}
          <details><summary>{t("Stored fields")}</summary><pre className="codebox" dir="ltr">{JSON.stringify(detail.body, null, 2)}</pre></details>
          <details><summary>{t("Active indexed fields")}</summary><pre className="codebox" dir="ltr">{JSON.stringify(detail.activeDocument, null, 2)}</pre></details>
          <details open><summary>Indexed terms · {detail.terms.length}</summary>
            {detail.termsTruncated && <p className="muted">{t("Showing the first 500 terms. Positions are capped at 100 per term.")}</p>}
            <div className="table-wrap"><table><thead><tr><th>{t("Field")}</th><th>{t("Term")}</th><th>TF / DF</th><th>{t("Positions")}</th></tr></thead><tbody>
              {detail.terms.map(term => <tr key={`${term.field}:${term.term}`}><td>{term.field}</td><td dir="auto">{term.term}</td><td>{term.frequency} / {term.documentFrequency}</td><td className="mono">{term.positions.join(", ")}{term.frequency > term.positions.length && "…"}</td></tr>)}
              {!detail.terms.length && <tr><td colSpan={4} className="empty">{t("No terms in the active version.")}</td></tr>}
            </tbody></table></div>
          </details>
          {canEdit && !detail.deletedAt && <button className="btn" disabled={ex.busy || pending} onClick={() => {
            if (window.confirm(`Delete document ${detail.documentId}? A background rebuild will remove it from search.`)) void ex.remove(detail.documentId);
          }}>{t("Delete document")}</button>}
        </div>}
      </section>
    </div>}
    {!ex.indexes.length && !ex.loading && <div className="card empty" style={{ marginTop: 14 }}>{t("Create a project to start exploring its index.")}</div>}
  </div>;
}
