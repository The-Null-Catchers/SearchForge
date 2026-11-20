"use client";

import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import type { HighlightRange, SearchResponse } from "@searchforge/shared";
import { useProject } from "../../../components/project-context";
import { useLocale } from "../../../components/locale-context";
import { publicAutocomplete, publicSearch } from "../../../lib/api";

const categoryField = "metadata.category";
type Document = Record<string, unknown> & { title?: string; content?: string; language?: string; published?: boolean; metadata?: Record<string, unknown> };
type Result = SearchResponse<Document> & { debug?: { expandedTerms: Record<string, string[]> } };
type Suggestion = { value: string; score: number };
const examples = [
  { label: "Arabic search", query: "محرك بحث", category: "docs" },
  { label: "English typo", query: "javscript", category: "" }
];

function highlight(value: string, ranges: HighlightRange[], field: string): ReactNode {
  const matches = ranges.filter(range => range.field === field && range.start >= 0 && range.end <= value.length && range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!matches.length) return value;
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const [index, range] of matches.entries()) {
    if (range.start < cursor) continue;
    if (range.start > cursor) output.push(value.slice(cursor, range.start));
    output.push(<mark className="match-highlight" key={`${field}-${index}`}>{value.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < value.length) output.push(value.slice(cursor));
  return output;
}

export default function PlaygroundPage() {
  const { projectId } = useProject();
  const { t } = useLocale();
  return <div className="content">
    <div className="eyebrow">Search lab</div>
    <h1>{t("Search Playground")}</h1>
    <p className="muted">{t("Filter search results and inspect how BM25 ranks them.")}</p>
    <Playground key={projectId} projectId={projectId} />
  </div>;
}

function Playground({ projectId }: { projectId: string | null }) {
  const { t } = useLocale();
  const [apiKey, setApiKey] = useState("");
  const [indexSlug, setIndexSlug] = useState("docs");
  const [query, setQuery] = useState("distributed systems");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [typoTolerance, setTypoTolerance] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  useEffect(() => {
    if (projectId) setApiKey(sessionStorage.getItem(`sf_search_key:${projectId}`) ?? "");
  }, [projectId]);

  useEffect(() => {
    if (!apiKey.trim() || !indexSlug.trim() || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void publicAutocomplete<{ suggestions: Suggestion[] }>(indexSlug.trim(), apiKey.trim(), query.trim(), 6, controller.signal)
        .then(body => {
          if (!controller.signal.aborted) { setSuggestions(body.suggestions); setActiveSuggestion(-1); }
        })
        .catch(() => { if (!controller.signal.aborted) setSuggestions([]); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [apiKey, indexSlug, query]);

  function chooseSuggestion(value: string) {
    setQuery(value);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
  }

  function handleQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggestionsOpen || suggestions.length === 0) {
      if (event.key === "Escape") setSuggestionsOpen(false);
      return;
    }
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveSuggestion(index => Math.min(index + 1, suggestions.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveSuggestion(index => Math.max(index - 1, 0)); }
    else if (event.key === "Enter" && activeSuggestion >= 0) { event.preventDefault(); chooseSuggestion(suggestions[activeSuggestion]!.value); }
    else if (event.key === "Escape") setSuggestionsOpen(false);
  }

  async function runSearch(categoryOverride?: string) {
    const key = apiKey.trim();
    const selectedIndex = indexSlug.trim();
    if (!projectId) { setError(t("Select a project before searching.")); return; }
    if (!key) { setError(t("Enter an API key for the selected project.")); return; }
    if (!selectedIndex) { setError(t("Enter an index slug.")); return; }

    const filters: Record<string, unknown>[] = [];
    const selectedCategory = categoryOverride === undefined ? category.trim() : categoryOverride;
    if (selectedCategory) filters.push({ [categoryField]: selectedCategory });
    if (language) filters.push({ language });
    if (publishedOnly) filters.push({ published: true });
    const expression = filters.length > 1 ? { and: filters } : filters[0];

    setError("");
    setLatency(null);
    setPending(true);
    const started = performance.now();
    try {
      const response = await publicSearch<Result>(selectedIndex, key, {
        query, ...(expression ? { filters: expression } : {}),
        facets: [categoryField, "language"], typoTolerance, debug: true, limit: 20
      });
      setResult(response);
      setLatency(performance.now() - started);
      sessionStorage.setItem(`sf_search_key:${projectId}`, key);
      setSuggestionsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  const categoryFacets = result?.facets[categoryField] ?? {};

  return <div className="split playground-layout" style={{ marginTop: 22, alignItems: "start" }}>
    <form className="card card-body stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="playground-key">{t("Search API key")}</label>
        <input id="playground-key" className="input mono" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="sf_search_…" />
      </div>
      <div className="field">
        <label htmlFor="playground-index">{t("Index slug")}</label>
        <input id="playground-index" className="input mono" value={indexSlug} onChange={event => setIndexSlug(event.target.value)} required maxLength={80} />
      </div>
      <div className="field autocomplete-field">
        <label htmlFor="playground-query">{t("Query")}</label>
        <input id="playground-query" className="input" dir="auto" value={query} onChange={event => setQuery(event.target.value)}
          onFocus={() => setSuggestionsOpen(true)} onKeyDown={handleQueryKeyDown} maxLength={1000}
          role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen && suggestions.length > 0}
          aria-controls="playground-suggestions" />
        {suggestionsOpen && suggestions.length > 0 && <div className="autocomplete-panel" id="playground-suggestions" role="listbox" aria-label={t("Autocomplete")}>
          {suggestions.map((suggestion, index) => <button key={suggestion.value} type="button" role="option" aria-selected={index === activeSuggestion}
            className={index === activeSuggestion ? "autocomplete-option active" : "autocomplete-option"}
            onMouseDown={event => event.preventDefault()} onClick={() => chooseSuggestion(suggestion.value)}>
            <span dir="auto">{suggestion.value}</span><small className="muted">{suggestion.score}</small>
          </button>)}
        </div>}
      </div>
      <div className="field">
        <label htmlFor="playground-category">{t("Category filter")}</label>
        <input id="playground-category" className="input" dir="auto" value={category} onChange={event => setCategory(event.target.value)} placeholder={t("All categories")} />
      </div>
      <div className="field">
        <label htmlFor="playground-language">{t("Language")}</label>
        <select id="playground-language" className="input" value={language} onChange={event => setLanguage(event.target.value)}>
          <option value="">{t("Any language")}</option><option value="ar">العربية</option><option value="en">English</option><option value="mixed">Mixed</option>
        </select>
      </div>
      <div className="playground-options">
        <label><input type="checkbox" checked={typoTolerance} onChange={event => setTypoTolerance(event.target.checked)} /> {t("Typo tolerance")}</label>
        <label><input type="checkbox" checked={publishedOnly} onChange={event => setPublishedOnly(event.target.checked)} /> {t("Published only")}</label>
      </div>
      <div className="playground-presets">
        {examples.map(example => <button key={example.label} className="btn" type="button" onClick={() => {
          setQuery(example.query); setCategory(example.category); setLanguage(""); setPublishedOnly(false);
        }}>{t(example.label)}</button>)}
      </div>
      <button className="btn primary" disabled={pending}>{pending ? t("Searching…") : t("Run search")}</button>
      {error && <div role="alert" style={{ color: "var(--danger)" }}>{error}</div>}
    </form>

    <section className="card playground-results" aria-label="Search results" aria-busy={pending} style={{ minWidth: 0 }}>
      <div className="card-head"><h2>{t("Results")}</h2>{pending && <span className="badge">{t("Searching…")}</span>}</div>
      <div className="card-body stack">
        {result ? <>
          <p className="muted" role="status">{result.total} {result.total === 1 ? t("result") : t("results")} · {t("Index")} v{result.indexVersion} · {result.processingTimeMs.toFixed(1)} ms {t("engine")} · {latency?.toFixed(1)} ms {t("round trip")}</p>
          {Object.keys(categoryFacets).length > 0 && <div className="facet-block">
            <span className="muted">{t("Category")}</span>
            <div className="facet-list">
              {Object.entries(categoryFacets).map(([name, count]) => <button className={category === name ? "facet-chip active" : "facet-chip"} key={name} type="button" aria-pressed={category === name}
                onClick={() => { setCategory(name); void runSearch(name); }}><bdi>{name}</bdi><span>{count}</span></button>)}
            </div>
          </div>}
          {Object.entries(result.debug?.expandedTerms ?? {}).filter(([, terms]) => terms.length > 1).map(([term, terms]) =>
            <p className="muted" key={term}>{t("Expanded")} <bdi>{term}</bdi> → <bdi>{terms.join(", ")}</bdi></p>)}
          {result.hits.length === 0 && <div className="empty">{t("No matching documents")}</div>}
          {result.hits.map((hit, index) => <article className="result-card" key={hit.id}>
            <div className="result-heading">
              <span className="result-position">{String(index + 1).padStart(2, "0")}</span>
              <div className="result-title">
                <h3 dir="auto">{typeof hit.document.title === "string" ? highlight(hit.document.title, hit.highlights, "title") : hit.id}</h3>
                <p className="muted mono">{hit.id}</p>
              </div>
              <span className="result-score">{hit.score.toFixed(3)}</span>
            </div>
            {typeof hit.document.content === "string" && <p className="result-snippet" dir="auto">
              {highlight(hit.document.content.slice(0, 360), hit.highlights.filter(range => range.start < 360), "content")}
            </p>}
            <div className="result-meta">
              {typeof hit.document.language === "string" && <span className="badge">{hit.document.language}</span>}
              {typeof hit.document.metadata?.category === "string" && <span className="badge">{hit.document.metadata.category}</span>}
              <span className="muted">BM25 {hit.score.toFixed(3)}</span>
            </div>
            {hit.explanation && <details className="result-explanation">
              <summary>{t("Why this result?")} · {t("BM25 score breakdown")}</summary>
              <dl>{Object.entries(hit.explanation).map(([component, score]) => <div key={component}>
                <dt dir="auto">{component.replace(/^bm25:/, "").replace(/:/g, " · ")}</dt><dd>{score.toFixed(3)}</dd>
              </div>)}</dl>
            </details>}
          </article>)}
          <details><summary>{t("Raw JSON response")}</summary><pre className="codebox">{JSON.stringify(result, null, 2)}</pre></details>
        </> : <div className="empty">{pending ? t("Waiting for results…") : t("Run a query to see matching documents.")}</div>}
      </div>
    </section>
  </div>;
}
