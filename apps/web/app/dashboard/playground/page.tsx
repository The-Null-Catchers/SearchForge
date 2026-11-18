"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { SearchResponse } from "@searchforge/shared";
import { useProject } from "../../../components/project-context";
import { publicSearch } from "../../../lib/api";

const categoryField = "metadata.category";
const examples = [
  { label: "Arabic search", query: "محرك بحث", category: "docs" },
  { label: "English typo", query: "javscript", category: "" },
];

type PlaygroundResponse = SearchResponse & { debug?: { expandedTerms: Record<string, string[]> } };

export default function PlaygroundPage() {
  const { projectId } = useProject();

  return (
    <div className="content">
      <h1>Search Playground</h1>
      <p className="muted">Filter search results and inspect how BM25 ranks them.</p>
      <Playground key={projectId} projectId={projectId} />
    </div>
  );
}

function Playground({ projectId }: { projectId: string | null }) {
  const [apiKey, setApiKey] = useState("");
  const [query, setQuery] = useState("distributed systems");
  const [category, setCategory] = useState("");
  const [result, setResult] = useState<PlaygroundResponse | null>(null);
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (projectId) setApiKey(sessionStorage.getItem(`sf_search_key:${projectId}`) ?? "");
  }, [projectId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const key = apiKey.trim();
    setResult(null);
    setLatency(null);
    setError("");
    if (!key) {
      setError("Enter an API key for the selected project.");
      return;
    }

    const categoryValue = category.trim();
    const started = performance.now();
    setPending(true);
    try {
      const response = await publicSearch<PlaygroundResponse>(String(form.get("index")).trim(), key, {
        query,
        ...(categoryValue ? { filters: { [categoryField]: categoryValue } } : {}),
        facets: [categoryField],
        typoTolerance: form.get("typoTolerance") === "on",
        debug: true,
        limit: 20,
      });
      setResult(response);
      setLatency(performance.now() - started);
      if (projectId) sessionStorage.setItem(`sf_search_key:${projectId}`, key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="split" style={{ marginTop: 22, alignItems: "start" }}>
      <form className="card card-body stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="playground-key">Search API key</label>
          <input id="playground-key" className="input mono" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="sf_search_…" />
        </div>
        <div className="field">
          <label htmlFor="playground-index">Index slug</label>
          <input id="playground-index" className="input mono" name="index" defaultValue="docs" required maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="playground-query">Query</label>
          <input id="playground-query" className="input" dir="auto" value={query} onChange={event => setQuery(event.target.value)} maxLength={1000} />
        </div>
        <div className="field">
          <label htmlFor="playground-category">Category filter</label>
          <input id="playground-category" className="input" dir="auto" value={category} onChange={event => setCategory(event.target.value)} placeholder="All categories" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {examples.map(example => (
            <button key={example.label} className="btn" type="button" onClick={() => { setQuery(example.query); setCategory(example.category); }}>
              {example.label}
            </button>
          ))}
        </div>
        <label className="muted"><input type="checkbox" name="typoTolerance" defaultChecked /> Typo tolerance</label>
        <button className="btn primary" disabled={pending}>{pending ? "Searching…" : "Run search"}</button>
        {error && <div role="alert" style={{ color: "var(--danger)" }}>{error}</div>}
      </form>
      <section className="card" aria-label="Search results" aria-busy={pending} style={{ minWidth: 0 }}>
        <div className="card-head"><h2>Results</h2></div>
        <div className="card-body stack">
          {result ? (
            <>
              <p className="muted" role="status">
                {result.total} {result.total === 1 ? "result" : "results"} · Index v{result.indexVersion} · {result.processingTimeMs.toFixed(1)} ms engine · {latency?.toFixed(1)} ms round trip
              </p>
              {Object.entries(result.facets[categoryField] ?? {}).map(([name, count]) => (
                <span className="badge" key={name}>{name} ({count})</span>
              ))}
              {Object.entries(result.debug?.expandedTerms ?? {}).filter(([, terms]) => terms.length > 1).map(([term, terms]) => (
                <p className="muted" key={term}>Expanded <bdi>{term}</bdi> → <bdi>{terms.join(", ")}</bdi></p>
              ))}
              {result.hits.map(hit => (
                <article className="card card-body" key={hit.id}>
                  <h3 dir="auto">{typeof hit.document.title === "string" ? hit.document.title : hit.id}</h3>
                  <p className="muted">Score {hit.score.toFixed(3)}</p>
                  {hit.explanation && (
                    <details>
                      <summary>BM25 score breakdown</summary>
                      <dl>
                        {Object.entries(hit.explanation).map(([component, score]) => (
                          <div key={component}><dt dir="auto">{component}</dt><dd>{score.toFixed(3)}</dd></div>
                        ))}
                      </dl>
                    </details>
                  )}
                </article>
              ))}
              <details><summary>Raw JSON response</summary><pre className="codebox">{JSON.stringify(result, null, 2)}</pre></details>
            </>
          ) : (
            <p className="muted">{pending ? "Waiting for results…" : "Run a query to see matching documents."}</p>
          )}
        </div>
      </section>
    </div>
  );
}
