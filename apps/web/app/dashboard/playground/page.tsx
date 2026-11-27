"use client";

import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
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
  { label: "Mixed-language search", query: "محرك search", category: "" },
  { label: "English typo", query: "javscript", category: "" }
];
const languages: Record<string, string> = { ar: "Arabic", en: "English", mixed: "Mixed" };

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
    <h1>{t("Search Playground")}</h1>
    <p className="muted">{t("Filter search results and inspect how BM25 ranks them.")}</p>
    <Playground key={projectId} projectId={projectId} />
  </div>;
}

function Playground({ projectId }: { projectId: string | null }) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const scoreFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 3, minimumFractionDigits: 3 });
  const searchRequest = useRef<AbortController | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [indexSlug, setIndexSlug] = useState("docs");
  const [query, setQuery] = useState("distributed systems");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [published, setPublished] = useState("");
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
    return () => searchRequest.current?.abort();
  }, [projectId]);

  useEffect(() => {
    setSuggestions([]);
    setActiveSuggestion(-1);
    if (!suggestionsOpen || !projectId || !apiKey.trim() || !indexSlug.trim() || query.trim().length < 2 || query.trim().length > 200) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void publicAutocomplete<{ suggestions: Suggestion[] }>(indexSlug.trim(), apiKey.trim(), query.trim(), 6, controller.signal, projectId)
        .then(body => {
          if (!controller.signal.aborted) { setSuggestions(body.suggestions); setActiveSuggestion(-1); }
        })
        .catch(() => { if (!controller.signal.aborted) setSuggestions([]); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [apiKey, indexSlug, projectId, query, suggestionsOpen]);

  function chooseSuggestion(value: string) {
    setQuery(query.trimEnd().replace(/[^\s]+$/u, value));
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
  }

  function handleQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (!suggestionsOpen || suggestions.length === 0) {
      if (event.key === "Escape") setSuggestionsOpen(false);
      return;
    }
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveSuggestion(index => (index + 1) % suggestions.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveSuggestion(index => index <= 0 ? suggestions.length - 1 : index - 1); }
    else if (event.key === "Enter" && activeSuggestion >= 0) { event.preventDefault(); chooseSuggestion(suggestions[activeSuggestion]!.value); }
    else if (event.key === "Escape") setSuggestionsOpen(false);
  }

  function resetSearch() {
    searchRequest.current?.abort();
    setPending(false);
    setResult(null);
    setError("");
  }

  async function runSearch(overrides: { category?: string; language?: string } = {}) {
    resetSearch();
    setSuggestionsOpen(false);
    const key = apiKey.trim();
    const selectedIndex = indexSlug.trim();
    if (!projectId) { setError(t("Select a project before searching.")); return; }
    if (!key) { setError(t("Enter an API key for the selected project.")); return; }
    if (!selectedIndex) { setError(t("Enter an index slug.")); return; }

    const filters: Record<string, unknown>[] = [];
    const selectedCategory = overrides.category ?? category.trim();
    if (selectedCategory) filters.push({ [categoryField]: selectedCategory });
    const selectedLanguage = overrides.language ?? language;
    if (selectedLanguage) filters.push({ language: selectedLanguage });
    if (published) filters.push({ published: published === "true" });
    const expression = filters.length > 1 ? { and: filters } : filters[0];

    setLatency(null);
    setPending(true);
    const controller = new AbortController();
    searchRequest.current = controller;
    const started = performance.now();
    try {
      const response = await publicSearch<Result>(selectedIndex, key, {
        query, ...(expression ? { filters: expression } : {}),
        facets: [categoryField, "language"], typoTolerance, debug: true, limit: 20
      }, { projectId, signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult(response);
      setLatency(performance.now() - started);
      sessionStorage.setItem(`sf_search_key:${projectId}`, key);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  const expanded = suggestionsOpen && suggestions.length > 0;
  const facets = [
    { field: categoryField, label: "Category", selected: category, select: setCategory, parameter: "category" },
    { field: "language", label: "Language", selected: language, select: setLanguage, parameter: "language" }
  ] as const;

  return <div className="split playground-layout" style={{ marginTop: 22, alignItems: "start" }}>
    <form className="card card-body stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="playground-key">{t("Search API key")}</label>
        <input id="playground-key" className="input mono" dir="ltr" type="password" autoComplete="off" value={apiKey} onChange={event => { resetSearch(); setApiKey(event.target.value); }} placeholder="sf_search_…" />
      </div>
      <div className="field">
        <label htmlFor="playground-index">{t("Index slug")}</label>
        <input id="playground-index" className="input mono" dir="ltr" value={indexSlug} onChange={event => { resetSearch(); setIndexSlug(event.target.value); }} required maxLength={80} />
      </div>
      <div className="field autocomplete-field">
        <label htmlFor="playground-query">{t("Query")}</label>
        <input id="playground-query" className="input" dir="auto" value={query} onChange={event => { setQuery(event.target.value); setSuggestionsOpen(true); }}
          onFocus={() => setSuggestionsOpen(true)} onBlur={() => setSuggestionsOpen(false)} onKeyDown={handleQueryKeyDown} maxLength={1000}
          role="combobox" aria-autocomplete="list" aria-expanded={expanded}
          aria-controls={expanded ? "playground-suggestions" : undefined}
          aria-activedescendant={expanded && activeSuggestion >= 0 ? `playground-option-${activeSuggestion}` : undefined} />
        {expanded && <div className="autocomplete-panel" id="playground-suggestions" role="listbox" aria-label={t("Autocomplete")}>
          {suggestions.map((suggestion, index) => <button key={suggestion.value} id={`playground-option-${index}`} type="button" tabIndex={-1} role="option" aria-selected={index === activeSuggestion}
            className={index === activeSuggestion ? "autocomplete-option active" : "autocomplete-option"}
            onMouseDown={event => event.preventDefault()} onClick={() => chooseSuggestion(suggestion.value)}>
            <span dir="auto">{suggestion.value}</span><small className="muted">{number.format(suggestion.score)}</small>
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
          <option value="">{t("Any language")}</option>{Object.entries(languages).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="playground-published">{t("Published state")}</label>
        <select id="playground-published" className="input" value={published} onChange={event => setPublished(event.target.value)}>
          <option value="">{t("Any published state")}</option><option value="true">{t("Published only")}</option><option value="false">{t("Unpublished only")}</option>
        </select>
      </div>
      <div className="playground-options">
        <label><input type="checkbox" checked={typoTolerance} onChange={event => setTypoTolerance(event.target.checked)} /> {t("Typo tolerance")}</label>
      </div>
      <div className="playground-presets">
        {examples.map(example => <button key={example.label} className="btn" type="button" onClick={() => {
          setQuery(example.query); setCategory(example.category); setLanguage(""); setPublished("");
        }}>{t(example.label)}</button>)}
      </div>
      <button className="btn primary" disabled={pending}>{pending ? t("Searching…") : t("Run search")}</button>
      {error && <div role="alert" style={{ color: "var(--danger)" }}>{t(error)}</div>}
    </form>

    <section className="card playground-results" aria-label={t("Search results")} aria-busy={pending} style={{ minWidth: 0 }}>
      <div className="card-head"><h2>{t("Results")}</h2>{pending && <span className="badge">{t("Searching…")}</span>}</div>
      <div className="card-body stack">
        {result ? <>
          <p className="muted" role="status">{t("Results")} <bdi>{number.format(result.total)}</bdi> · {t("Index")} <bdi dir="ltr">v{result.indexVersion}</bdi> · <bdi>{number.format(result.processingTimeMs)} ms</bdi> {t("engine")} · {latency !== null && <bdi>{number.format(latency)} ms</bdi>} {t("round trip")}</p>
          {facets.map(({ field, label, selected, select, parameter }) => Object.keys(result.facets[field] ?? {}).length > 0 && <div className="facet-block" key={field}>
            <span className="muted">{t(label)}</span>
            <div className="facet-list">
              {Object.entries(result.facets[field] ?? {}).map(([name, count]) => <button className={selected === name ? "facet-chip active" : "facet-chip"} key={name} type="button" aria-pressed={selected === name}
                onClick={() => { const value = selected === name ? "" : name; select(value); void runSearch({ [parameter]: value }); }}><bdi>{field === "language" ? t(languages[name] ?? name) : name}</bdi><span>{number.format(count)}</span></button>)}
            </div>
          </div>)}
          {Object.entries(result.debug?.expandedTerms ?? {}).filter(([, terms]) => terms.length > 1).map(([term, terms]) =>
            <p className="muted" key={term}>{t("Expanded")} <bdi>{term}</bdi> → <bdi>{terms.join(", ")}</bdi></p>)}
          {result.hits.length === 0 && <div className="empty">{t("No matching documents")}</div>}
          {result.hits.map(hit => <article className="result-card" key={hit.id}>
            <div className="result-heading">
              <div className="result-title">
                <h3 dir="auto">{typeof hit.document.title === "string" ? highlight(hit.document.title, hit.highlights, "title") : hit.id}</h3>
                <p className="muted mono"><bdi>{hit.id}</bdi></p>
              </div>
              <span className="result-score"><bdi>BM25 {scoreFormat.format(hit.score)}</bdi></span>
            </div>
            {typeof hit.document.content === "string" && <p className="result-snippet" dir="auto">
              {highlight(hit.document.content.slice(0, 360), hit.highlights.filter(range => range.start < 360), "content")}
            </p>}
            <div className="result-meta">
              {typeof hit.document.language === "string" && <span className="badge">{t(languages[hit.document.language] ?? hit.document.language)}</span>}
              {typeof hit.document.metadata?.category === "string" && <span className="badge"><bdi>{hit.document.metadata.category}</bdi></span>}
            </div>
            {hit.explanation && <details className="result-explanation">
              <summary>{t("Why this result?")} · {t("BM25 score breakdown")}</summary>
              <dl>{Object.entries(hit.explanation).map(([component, score]) => <div key={component}>
                <dt dir="auto">{component.replace(/^bm25:/, "").split(":").map(part => t(part)).join(" · ")}</dt><dd>{scoreFormat.format(score)}</dd>
              </div>)}</dl>
            </details>}
            <details><summary>{t("Inspect document")}</summary><pre className="codebox" dir="ltr">{JSON.stringify(hit.document, null, 2)}</pre></details>
          </article>)}
          <details><summary>{t("Raw JSON response")}</summary><pre className="codebox" dir="ltr">{JSON.stringify(result, null, 2)}</pre></details>
        </> : <div className="empty">{pending ? t("Waiting for results…") : t("Run a query to see matching documents.")}</div>}
      </div>
    </section>
  </div>;
}
