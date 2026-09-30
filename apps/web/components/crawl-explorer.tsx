"use client";
import { FormEvent } from "react";
import { useCrawlPages } from "../lib/use-crawl-pages";
import { safeExternalUrl } from "../lib/source-form";

export function CrawlExplorer({ sourceId, name }: { sourceId: string; name: string }) {
  const ex = useCrawlPages(sourceId);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fields = new FormData(event.currentTarget);
    ex.filter(String(fields.get("q") ?? ""), String(fields.get("status") ?? ""));
  };
  return <section className="card" style={{ marginTop: 14 }}><div className="card-head"><h2>Crawl pages · {name}</h2><span className="muted">Auto-refresh · 3s</span></div>
    <form className="toolbar card-body" onSubmit={submit}><input className="input" name="q" placeholder="Filter URL" aria-label="Filter crawl URL" maxLength={200}/>
      <select className="input" name="status" aria-label="Crawl page status"><option value="">All statuses</option>{["indexed", "unchanged", "blocked", "failed", "duplicate", "skipped"].map(status => <option key={status} value={status}>{status}</option>)}</select><button className="btn">Apply</button>
    </form>
    {ex.error && <p role="alert" className="card-body" style={{ color: "var(--danger)" }}>{ex.error}</p>}
    <div className="table-wrap"><table><thead><tr><th>URL / canonical</th><th>Status</th><th>HTTP</th><th>Time</th><th>Content type</th><th>Crawled</th></tr></thead><tbody>
      {ex.data.pages.map(page => <tr key={page.id}><td><div dir="auto">{safeExternalUrl(page.url) ? <a href={safeExternalUrl(page.url)!} target="_blank" rel="noopener noreferrer">{page.url}</a> : page.url}</div>
        {page.canonicalUrl && <div className="muted" dir="auto">Canonical: {page.canonicalUrl}</div>}{page.error && <div style={{ color: "var(--danger)" }} dir="auto">{page.error}</div>}</td>
        <td><span className="badge">{page.status}</span><div className="muted">Depth {page.depth}</div></td><td>{page.httpStatus ?? "—"}</td><td>{page.responseTimeMs === null ? "—" : `${page.responseTimeMs} ms`}</td><td>{page.contentType ?? "—"}</td><td>{page.crawledAt ? new Date(page.crawledAt).toLocaleString() : "—"}</td></tr>)}
      {!ex.data.pages.length && <tr><td colSpan={6} className="empty">{ex.loading ? "Loading pages…" : "No pages match these filters."}</td></tr>}
    </tbody></table></div>
    <div className="toolbar card-body"><button className="btn" disabled={ex.loading} onClick={ex.first}>Latest pages</button><button className="btn" disabled={ex.loading || !ex.data.nextCursor} onClick={ex.next}>Older pages</button></div>
  </section>;
}
