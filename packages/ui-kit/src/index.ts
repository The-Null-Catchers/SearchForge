import { SearchForge, type SearchHit, type SearchResult } from "@searchforge/sdk-js";

export type SearchWidgetDirection = "auto" | "ltr" | "rtl";

export type SearchWidgetOptions = {
  target: HTMLElement | string;
  baseUrl: string;
  projectId: string;
  apiKey: string;
  indexSlug?: string;
  placeholder?: string;
  limit?: number;
  autocompleteLimit?: number;
  debounceMs?: number;
  direction?: SearchWidgetDirection;
  titleField?: string;
  descriptionField?: string;
  urlField?: string;
  resultUrl?: (hit: SearchHit<Record<string, unknown>>) => string | null;
};

export type SearchWidgetHandle = {
  element: HTMLElement;
  search(query: string): Promise<void>;
  focus(): void;
  destroy(): void;
};

const styles = `
:host {
  --sf-bg: #ffffff;
  --sf-fg: #101828;
  --sf-muted: #667085;
  --sf-border: #d0d5dd;
  --sf-accent: #6941c6;
  --sf-accent-soft: #f4f3ff;
  --sf-danger: #b42318;
  display: block;
  color: var(--sf-fg);
  font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
.wrap { position: relative; width: 100%; }
.search-row { display: flex; gap: 8px; }
.input-wrap { position: relative; flex: 1; }
input {
  width: 100%; min-height: 44px; padding: 10px 42px 10px 14px;
  border: 1px solid var(--sf-border); border-radius: 10px; background: var(--sf-bg); color: var(--sf-fg);
  font: inherit; outline: none; transition: border-color .15s, box-shadow .15s;
}
:host([dir="rtl"]) input { padding: 10px 14px 10px 42px; }
input:focus { border-color: var(--sf-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sf-accent) 18%, transparent); }
button {
  min-height: 44px; border: 0; border-radius: 10px; padding: 0 16px; cursor: pointer;
  background: var(--sf-accent); color: white; font: inherit; font-weight: 650;
}
button:disabled { opacity: .55; cursor: default; }
.spinner { position: absolute; inset-inline-end: 14px; top: 13px; width: 18px; height: 18px; border: 2px solid var(--sf-border); border-top-color: var(--sf-accent); border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.suggestions {
  position: absolute; z-index: 20; inset-inline: 0; top: calc(100% + 6px); margin: 0; padding: 6px;
  list-style: none; border: 1px solid var(--sf-border); border-radius: 10px; background: var(--sf-bg);
  box-shadow: 0 12px 30px rgba(16,24,40,.14); max-height: 280px; overflow: auto;
}
.suggestions[hidden] { display: none; }
.suggestion { padding: 9px 10px; border-radius: 7px; cursor: pointer; }
.suggestion[aria-selected="true"], .suggestion:hover { background: var(--sf-accent-soft); color: var(--sf-accent); }
.meta { display: flex; justify-content: space-between; gap: 12px; margin: 14px 2px 8px; color: var(--sf-muted); font-size: 12px; }
.results { display: grid; gap: 10px; }
.result { border: 1px solid var(--sf-border); border-radius: 12px; padding: 14px; background: var(--sf-bg); }
.result a { color: var(--sf-fg); text-decoration: none; font-weight: 700; font-size: 15px; }
.result a:hover { color: var(--sf-accent); text-decoration: underline; }
.result p { margin: 6px 0 0; color: var(--sf-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.result .url { margin-top: 5px; color: var(--sf-accent); font-size: 12px; overflow-wrap: anywhere; }
.empty, .error { margin-top: 14px; border-radius: 10px; padding: 12px; }
.empty { background: var(--sf-accent-soft); color: var(--sf-muted); }
.error { background: #fef3f2; color: var(--sf-danger); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
`;

function resolveTarget(target: HTMLElement | string): HTMLElement {
  if (typeof target !== "string") return target;
  const element = document.querySelector<HTMLElement>(target);
  if (!element) throw new Error(`SearchForge target not found: ${target}`);
  return element;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function isArabic(value: string): boolean {
  return /[\u0600-\u06ff]/.test(value);
}

function safeUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, document.baseURI);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export class SearchForgeSearchElement extends HTMLElement {
  private readonly root: ShadowRoot;
  private client: SearchForge | null = null;
  private options: Omit<SearchWidgetOptions, "target"> | null = null;
  private searchAbort?: AbortController;
  private autocompleteAbort?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private suggestions: Array<{ value: string; score: number }> = [];
  private selectedSuggestion = -1;
  private lastResult?: SearchResult<Record<string, unknown>>;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.root.innerHTML = `
      <style>${styles}</style>
      <div class="wrap">
        <form class="search-row" role="search">
          <div class="input-wrap">
            <label class="sr-only" for="query">Search</label>
            <input id="query" type="search" autocomplete="off" spellcheck="false" aria-autocomplete="list" aria-expanded="false" aria-controls="suggestions" />
            <span class="spinner" hidden aria-hidden="true"></span>
            <ul id="suggestions" class="suggestions" role="listbox" hidden></ul>
          </div>
          <button type="submit">Search</button>
        </form>
        <div class="meta" hidden><span class="count"></span><span class="timing"></span></div>
        <div class="status" role="status" aria-live="polite"></div>
        <div class="results"></div>
      </div>`;
  }

  connectedCallback() {
    this.input.addEventListener("input", this.onInput);
    this.input.addEventListener("keydown", this.onKeyDown);
    this.form.addEventListener("submit", this.onSubmit);
    this.root.addEventListener("focusout", this.onFocusOut);
  }

  disconnectedCallback() {
    this.input.removeEventListener("input", this.onInput);
    this.input.removeEventListener("keydown", this.onKeyDown);
    this.form.removeEventListener("submit", this.onSubmit);
    this.root.removeEventListener("focusout", this.onFocusOut);
    this.cancelPending();
  }

  configure(options: Omit<SearchWidgetOptions, "target">) {
    if (options.apiKey.startsWith("sf_admin_") || options.apiKey.startsWith("sf_indexing_")) {
      throw new Error("Embeddable SearchForge UI requires a search-scoped API key; never embed admin or indexing keys.");
    }
    const limit = options.limit ?? 10;
    const autocompleteLimit = options.autocompleteLimit ?? 6;
    const debounceMs = options.debounceMs ?? 180;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit must be an integer from 1 to 100");
    if (!Number.isInteger(autocompleteLimit) || autocompleteLimit < 1 || autocompleteLimit > 20) throw new TypeError("autocompleteLimit must be an integer from 1 to 20");
    if (!Number.isFinite(debounceMs) || debounceMs < 0 || debounceMs > 5000) throw new TypeError("debounceMs must be from 0 to 5000");

    this.options = { ...options, limit, autocompleteLimit, debounceMs };
    this.client = new SearchForge({
      baseUrl: options.baseUrl,
      projectId: options.projectId,
      apiKey: options.apiKey,
      ...(options.indexSlug ? { indexSlug: options.indexSlug } : {})
    });
    this.input.placeholder = options.placeholder ?? "Search…";
    this.setDirection("");
  }

  async search(query: string): Promise<void> {
    if (!this.options || !this.client) throw new Error("SearchForge widget is not configured");
    const normalized = query.trim();
    this.input.value = normalized;
    this.hideSuggestions();
    this.searchAbort?.abort();
    this.searchAbort = new AbortController();
    this.setDirection(normalized);
    if (!normalized) {
      this.clearResults();
      return;
    }

    this.setLoading(true);
    this.clearStatus();
    try {
      const result = await this.client.search<Record<string, unknown>>(normalized, {
        limit: this.options.limit ?? 10,
        signal: this.searchAbort.signal
      });
      if (this.searchAbort.signal.aborted) return;
      this.lastResult = result;
      this.renderResults(result);
      this.dispatchEvent(new CustomEvent("searchforge:search", { bubbles: true, composed: true, detail: { query: normalized, total: result.total, processingTimeMs: result.processingTimeMs } }));
    } catch (error) {
      if (this.searchAbort.signal.aborted) return;
      this.renderError(error instanceof Error ? error.message : "Search failed");
    } finally {
      if (!this.searchAbort.signal.aborted) this.setLoading(false);
    }
  }

  focus() { this.input.focus(); }

  private get input() { return this.root.querySelector<HTMLInputElement>("input")!; }
  private get form() { return this.root.querySelector<HTMLFormElement>("form")!; }
  private get spinner() { return this.root.querySelector<HTMLElement>(".spinner")!; }
  private get suggestionsElement() { return this.root.querySelector<HTMLUListElement>(".suggestions")!; }
  private get resultsElement() { return this.root.querySelector<HTMLElement>(".results")!; }
  private get statusElement() { return this.root.querySelector<HTMLElement>(".status")!; }
  private get metaElement() { return this.root.querySelector<HTMLElement>(".meta")!; }

  private setDirection(query: string) {
    const configured = this.options?.direction ?? "auto";
    const direction = configured === "auto" ? (isArabic(query) ? "rtl" : "ltr") : configured;
    this.setAttribute("dir", direction);
  }

  private setLoading(loading: boolean) {
    this.spinner.hidden = !loading;
    this.form.querySelector<HTMLButtonElement>("button")!.disabled = loading;
  }

  private clearStatus() { this.statusElement.replaceChildren(); }

  private clearResults() {
    this.resultsElement.replaceChildren();
    this.metaElement.hidden = true;
    this.clearStatus();
    this.lastResult = undefined;
  }

  private renderError(message: string) {
    this.resultsElement.replaceChildren();
    this.metaElement.hidden = true;
    const node = document.createElement("div");
    node.className = "error";
    node.textContent = message;
    this.statusElement.replaceChildren(node);
  }

  private renderResults(result: SearchResult<Record<string, unknown>>) {
    this.resultsElement.replaceChildren();
    this.clearStatus();
    this.metaElement.hidden = false;
    this.metaElement.querySelector<HTMLElement>(".count")!.textContent = `${result.total} result${result.total === 1 ? "" : "s"}`;
    this.metaElement.querySelector<HTMLElement>(".timing")!.textContent = `${Math.round(result.processingTimeMs)} ms`;

    if (result.hits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No results found.";
      this.statusElement.replaceChildren(empty);
      return;
    }

    result.hits.forEach((hit, index) => {
      const documentValue = hit.document;
      const title = text(documentValue[this.options?.titleField ?? "title"]) || hit.id;
      const description = text(documentValue[this.options?.descriptionField ?? "content"]);
      const rawUrl = this.options?.resultUrl?.(hit) ?? text(documentValue[this.options?.urlField ?? "url"]);
      const url = rawUrl ? safeUrl(rawUrl) : null;
      const card = document.createElement("article");
      card.className = "result";

      const heading = document.createElement("div");
      if (url) {
        const link = document.createElement("a");
        link.href = url;
        link.textContent = title;
        link.addEventListener("click", () => void this.trackClick(hit, index + 1));
        heading.append(link);
      } else {
        const label = document.createElement("strong");
        label.textContent = title;
        heading.append(label);
      }
      card.append(heading);

      if (description) {
        const snippet = document.createElement("p");
        snippet.textContent = description.length > 320 ? `${description.slice(0, 317)}…` : description;
        card.append(snippet);
      }
      if (url) {
        const urlLabel = document.createElement("div");
        urlLabel.className = "url";
        urlLabel.textContent = url;
        card.append(urlLabel);
      }
      this.resultsElement.append(card);
    });
  }

  private async trackClick(hit: SearchHit<Record<string, unknown>>, position: number) {
    if (!this.client || !this.lastResult) return;
    this.dispatchEvent(new CustomEvent("searchforge:select", { bubbles: true, composed: true, detail: { hit, position } }));
    try {
      await this.client.trackClick({
        query: this.lastResult.query,
        documentId: hit.id,
        position,
        ...(this.lastResult.searchEventId ? { searchEventId: this.lastResult.searchEventId } : {})
      });
    } catch {
      // Navigation must not fail when analytics delivery is unavailable.
    }
  }

  private onInput = () => {
    if (!this.options || !this.client) return;
    if (this.timer) clearTimeout(this.timer);
    this.autocompleteAbort?.abort();
    const query = this.input.value.trim();
    this.setDirection(query);
    if (!query) {
      this.hideSuggestions();
      return;
    }
    this.timer = setTimeout(() => void this.loadSuggestions(query), this.options?.debounceMs ?? 180);
  };

  private async loadSuggestions(query: string) {
    if (!this.client || !this.options) return;
    this.autocompleteAbort = new AbortController();
    try {
      const response = await this.client.autocomplete(query, this.options.autocompleteLimit ?? 6, this.autocompleteAbort.signal);
      if (this.autocompleteAbort.signal.aborted || this.input.value.trim() !== query) return;
      this.suggestions = response.suggestions;
      this.selectedSuggestion = -1;
      this.renderSuggestions();
    } catch {
      if (!this.autocompleteAbort.signal.aborted) this.hideSuggestions();
    }
  }

  private renderSuggestions() {
    const list = this.suggestionsElement;
    list.replaceChildren();
    if (this.suggestions.length === 0) {
      this.hideSuggestions();
      return;
    }
    this.suggestions.forEach((suggestion, index) => {
      const item = document.createElement("li");
      item.className = "suggestion";
      item.role = "option";
      item.id = `sf-suggestion-${index}`;
      item.setAttribute("aria-selected", String(index === this.selectedSuggestion));
      item.textContent = suggestion.value;
      item.addEventListener("mousedown", event => event.preventDefault());
      item.addEventListener("click", () => {
        this.input.value = suggestion.value;
        this.hideSuggestions();
        void this.search(suggestion.value);
      });
      list.append(item);
    });
    list.hidden = false;
    this.input.setAttribute("aria-expanded", "true");
  }

  private hideSuggestions() {
    this.suggestions = [];
    this.selectedSuggestion = -1;
    this.suggestionsElement.hidden = true;
    this.suggestionsElement.replaceChildren();
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (this.suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectedSuggestion = Math.min(this.selectedSuggestion + 1, this.suggestions.length - 1);
      this.renderSuggestions();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectedSuggestion = Math.max(this.selectedSuggestion - 1, 0);
      this.renderSuggestions();
    } else if (event.key === "Enter" && this.selectedSuggestion >= 0) {
      event.preventDefault();
      const value = this.suggestions[this.selectedSuggestion]?.value;
      if (value) {
        this.input.value = value;
        this.hideSuggestions();
        void this.search(value);
      }
    } else if (event.key === "Escape") {
      this.hideSuggestions();
    }
  };

  private onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    void this.search(this.input.value);
  };

  private onFocusOut = () => {
    queueMicrotask(() => {
      if (!this.matches(":focus-within")) this.hideSuggestions();
    });
  };

  private cancelPending() {
    if (this.timer) clearTimeout(this.timer);
    this.searchAbort?.abort();
    this.autocompleteAbort?.abort();
  }
}

if (typeof customElements !== "undefined" && !customElements.get("searchforge-search")) {
  customElements.define("searchforge-search", SearchForgeSearchElement);
}

export function mountSearchWidget(options: SearchWidgetOptions): SearchWidgetHandle {
  const target = resolveTarget(options.target);
  const element = document.createElement("searchforge-search") as SearchForgeSearchElement;
  const { target: _target, ...configuration } = options;
  void _target;
  element.configure(configuration);
  target.append(element);
  return {
    element,
    search: query => element.search(query),
    focus: () => element.focus(),
    destroy: () => element.remove()
  };
}
