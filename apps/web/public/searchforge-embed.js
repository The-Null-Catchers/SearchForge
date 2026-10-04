(() => {
  "use strict";

  const STYLES = `
:host{--sf-bg:#fff;--sf-fg:#101828;--sf-muted:#667085;--sf-border:#d0d5dd;--sf-accent:#6941c6;--sf-accent-soft:#f4f3ff;--sf-danger:#b42318;display:block;color:var(--sf-fg);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}.wrap{position:relative;width:100%}.search-row{display:flex;gap:8px}.input-wrap{position:relative;flex:1}
input{width:100%;min-height:44px;padding:10px 42px 10px 14px;border:1px solid var(--sf-border);border-radius:10px;background:var(--sf-bg);color:var(--sf-fg);font:inherit;outline:none}
:host([dir="rtl"]) input{padding:10px 14px 10px 42px}input:focus{border-color:var(--sf-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--sf-accent) 18%,transparent)}
button{min-height:44px;border:0;border-radius:10px;padding:0 16px;cursor:pointer;background:var(--sf-accent);color:#fff;font:inherit;font-weight:650}button:disabled{opacity:.55;cursor:default}
.spinner{position:absolute;inset-inline-end:14px;top:13px;width:18px;height:18px;border:2px solid var(--sf-border);border-top-color:var(--sf-accent);border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.suggestions{position:absolute;z-index:20;inset-inline:0;top:calc(100% + 6px);margin:0;padding:6px;list-style:none;border:1px solid var(--sf-border);border-radius:10px;background:var(--sf-bg);box-shadow:0 12px 30px rgba(16,24,40,.14);max-height:280px;overflow:auto}.suggestions[hidden]{display:none}.suggestion{padding:9px 10px;border-radius:7px;cursor:pointer}.suggestion[aria-selected="true"],.suggestion:hover{background:var(--sf-accent-soft);color:var(--sf-accent)}
.meta{display:flex;justify-content:space-between;gap:12px;margin:14px 2px 8px;color:var(--sf-muted);font-size:12px}.results{display:grid;gap:10px}.result{border:1px solid var(--sf-border);border-radius:12px;padding:14px;background:var(--sf-bg)}.result a{color:var(--sf-fg);text-decoration:none;font-weight:700;font-size:15px}.result a:hover{color:var(--sf-accent);text-decoration:underline}.result p{margin:6px 0 0;color:var(--sf-muted);white-space:pre-wrap;overflow-wrap:anywhere}.result .url{margin-top:5px;color:var(--sf-accent);font-size:12px;overflow-wrap:anywhere}.empty,.error{margin-top:14px;border-radius:10px;padding:12px}.empty{background:var(--sf-accent-soft);color:var(--sf-muted)}.error{background:#fef3f2;color:var(--sf-danger)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`;

  const isArabic = value => /[\u0600-\u06ff]/.test(value);
  const text = value => typeof value === "string" ? value : (typeof value === "number" || typeof value === "boolean" ? String(value) : "");
  const safeUrl = value => {
    try {
      const url = new URL(value, document.baseURI);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch { return null; }
  };

  class SearchForgeSearch extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.options = null;
      this.searchAbort = null;
      this.suggestAbort = null;
      this.suggestTimer = null;
      this.suggestions = [];
      this.selected = -1;
      this.lastResult = null;
      this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="wrap"><form class="search-row" role="search"><div class="input-wrap"><label class="sr-only" for="query">Search</label><input id="query" type="search" autocomplete="off" spellcheck="false" aria-autocomplete="list" aria-expanded="false" aria-controls="suggestions"><span class="spinner" hidden aria-hidden="true"></span><ul id="suggestions" class="suggestions" role="listbox" hidden></ul></div><button type="submit">Search</button></form><div class="meta" hidden><span class="count"></span><span class="timing"></span></div><div class="status" role="status" aria-live="polite"></div><div class="results"></div></div>`;
    }

    connectedCallback() {
      this.input.addEventListener("input", this.onInput);
      this.input.addEventListener("keydown", this.onKeyDown);
      this.form.addEventListener("submit", this.onSubmit);
      this.shadowRoot.addEventListener("focusout", this.onFocusOut);
    }

    disconnectedCallback() {
      this.input.removeEventListener("input", this.onInput);
      this.input.removeEventListener("keydown", this.onKeyDown);
      this.form.removeEventListener("submit", this.onSubmit);
      this.shadowRoot.removeEventListener("focusout", this.onFocusOut);
      this.cancelPending();
    }

    configure(options) {
      if (!options || typeof options !== "object") throw new TypeError("SearchForge embed options are required");
      if (!/^sf_search_/.test(options.apiKey || "")) throw new Error("Embeddable SearchForge requires a search-scoped API key");
      const base = new URL(options.baseUrl);
      if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) throw new TypeError("baseUrl must be a clean HTTP(S) URL");
      const limit = options.limit ?? 10;
      const autocompleteLimit = options.autocompleteLimit ?? 6;
      const debounceMs = options.debounceMs ?? 180;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit must be 1..100");
      if (!Number.isInteger(autocompleteLimit) || autocompleteLimit < 1 || autocompleteLimit > 20) throw new TypeError("autocompleteLimit must be 1..20");
      if (!Number.isFinite(debounceMs) || debounceMs < 0 || debounceMs > 5000) throw new TypeError("debounceMs must be 0..5000");
      this.options = { ...options, baseUrl: base.toString().replace(/\/$/, ""), limit, autocompleteLimit, debounceMs, indexSlug: options.indexSlug || "docs" };
      this.input.placeholder = options.placeholder || "Search…";
      this.setDirection("");
    }

    get input() { return this.shadowRoot.querySelector("input"); }
    get form() { return this.shadowRoot.querySelector("form"); }
    get suggestionsElement() { return this.shadowRoot.querySelector(".suggestions"); }
    get resultsElement() { return this.shadowRoot.querySelector(".results"); }
    get statusElement() { return this.shadowRoot.querySelector(".status"); }
    get metaElement() { return this.shadowRoot.querySelector(".meta"); }

    async request(path, method, body, signal) {
      const response = await fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.options.apiKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error?.message || `Search request failed (${response.status})`);
      }
      return response.status === 204 ? undefined : response.json();
    }

    async search(query) {
      if (!this.options) throw new Error("SearchForge widget is not configured");
      const normalized = String(query ?? "").trim();
      this.input.value = normalized;
      this.hideSuggestions();
      this.searchAbort?.abort();
      this.searchAbort = new AbortController();
      this.setDirection(normalized);
      if (!normalized) { this.clearResults(); return; }
      this.setLoading(true);
      this.statusElement.replaceChildren();
      try {
        const path = `/v1/indexes/${encodeURIComponent(this.options.indexSlug)}/search`;
        const result = await this.request(path, "POST", { query: normalized, limit: this.options.limit }, this.searchAbort.signal);
        if (this.searchAbort.signal.aborted) return;
        this.lastResult = result;
        this.renderResults(result);
        this.dispatchEvent(new CustomEvent("searchforge:search", { bubbles: true, composed: true, detail: { query: normalized, total: result.total, processingTimeMs: result.processingTimeMs } }));
      } catch (error) {
        if (!this.searchAbort.signal.aborted) this.renderError(error instanceof Error ? error.message : "Search failed");
      } finally {
        if (!this.searchAbort.signal.aborted) this.setLoading(false);
      }
    }

    focus() { this.input.focus(); }
    destroy() { this.remove(); }
    setDirection(query) { const mode = this.options?.direction || "auto"; this.setAttribute("dir", mode === "auto" ? (isArabic(query) ? "rtl" : "ltr") : mode); }
    setLoading(value) { this.shadowRoot.querySelector(".spinner").hidden = !value; this.form.querySelector("button").disabled = value; }
    clearResults() { this.resultsElement.replaceChildren(); this.statusElement.replaceChildren(); this.metaElement.hidden = true; this.lastResult = null; }
    renderError(message) { this.resultsElement.replaceChildren(); this.metaElement.hidden = true; const node = document.createElement("div"); node.className = "error"; node.textContent = message; this.statusElement.replaceChildren(node); }

    renderResults(result) {
      this.resultsElement.replaceChildren(); this.statusElement.replaceChildren(); this.metaElement.hidden = false;
      this.metaElement.querySelector(".count").textContent = `${result.total} result${result.total === 1 ? "" : "s"}`;
      this.metaElement.querySelector(".timing").textContent = `${Math.round(result.processingTimeMs)} ms`;
      if (!result.hits.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No results found."; this.statusElement.append(empty); return; }
      result.hits.forEach((hit, index) => {
        const doc = hit.document || {};
        const title = text(doc[this.options.titleField || "title"]) || hit.id;
        const description = text(doc[this.options.descriptionField || "content"]);
        const rawUrl = this.options.resultUrl ? this.options.resultUrl(hit) : text(doc[this.options.urlField || "url"]);
        const url = rawUrl ? safeUrl(rawUrl) : null;
        const card = document.createElement("article"); card.className = "result";
        const heading = document.createElement("div");
        if (url) { const link = document.createElement("a"); link.href = url; link.textContent = title; link.addEventListener("click", () => this.trackClick(hit, index + 1)); heading.append(link); }
        else { const label = document.createElement("strong"); label.textContent = title; heading.append(label); }
        card.append(heading);
        if (description) { const p = document.createElement("p"); p.textContent = description.length > 320 ? `${description.slice(0,317)}…` : description; card.append(p); }
        if (url) { const u = document.createElement("div"); u.className = "url"; u.textContent = url; card.append(u); }
        this.resultsElement.append(card);
      });
    }

    async trackClick(hit, position) {
      if (!this.lastResult) return;
      this.dispatchEvent(new CustomEvent("searchforge:select", { bubbles: true, composed: true, detail: { hit, position } }));
      try {
        await this.request("/v1/analytics/click", "POST", { query: this.lastResult.query, documentId: hit.id, position, ...(this.lastResult.searchEventId ? { searchEventId: this.lastResult.searchEventId } : {}) });
      } catch {}
    }

    onInput = () => {
      if (!this.options) return;
      clearTimeout(this.suggestTimer);
      this.suggestAbort?.abort();
      const query = this.input.value.trim(); this.setDirection(query);
      if (!query) { this.hideSuggestions(); return; }
      this.suggestTimer = setTimeout(() => this.loadSuggestions(query), this.options.debounceMs);
    };

    async loadSuggestions(query) {
      this.suggestAbort = new AbortController();
      try {
        const params = new URLSearchParams({ q: query, limit: String(this.options.autocompleteLimit) });
        const data = await this.request(`/v1/indexes/${encodeURIComponent(this.options.indexSlug)}/autocomplete?${params}`, "GET", undefined, this.suggestAbort.signal);
        if (this.suggestAbort.signal.aborted || this.input.value.trim() !== query) return;
        this.suggestions = data.suggestions || []; this.selected = -1; this.renderSuggestions();
      } catch { if (!this.suggestAbort.signal.aborted) this.hideSuggestions(); }
    }

    renderSuggestions() {
      this.suggestionsElement.replaceChildren();
      this.suggestions.forEach((item, index) => { const li = document.createElement("li"); li.className = "suggestion"; li.role = "option"; li.id = `sf-suggestion-${index}`; li.setAttribute("aria-selected", String(index === this.selected)); li.textContent = item.value; li.addEventListener("mousedown", event => { event.preventDefault(); this.input.value = item.value; this.hideSuggestions(); this.search(item.value); }); this.suggestionsElement.append(li); });
      this.suggestionsElement.hidden = this.suggestions.length === 0; this.input.setAttribute("aria-expanded", String(this.suggestions.length > 0));
    }

    hideSuggestions() { this.suggestionsElement.hidden = true; this.input.setAttribute("aria-expanded", "false"); this.input.removeAttribute("aria-activedescendant"); this.selected = -1; }
    onSubmit = event => { event.preventDefault(); this.search(this.input.value); };
    onKeyDown = event => {
      if (event.key === "Escape") { this.hideSuggestions(); return; }
      if (this.suggestionsElement.hidden || !this.suggestions.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const delta = event.key === "ArrowDown" ? 1 : -1; this.selected = (this.selected + delta + this.suggestions.length) % this.suggestions.length; this.renderSuggestions(); this.input.setAttribute("aria-activedescendant", `sf-suggestion-${this.selected}`); }
      else if (event.key === "Enter" && this.selected >= 0) { event.preventDefault(); const value = this.suggestions[this.selected]?.value; if (value) { this.input.value = value; this.hideSuggestions(); this.search(value); } }
    };
    onFocusOut = () => setTimeout(() => { if (!this.shadowRoot.activeElement) this.hideSuggestions(); }, 0);
    cancelPending() { clearTimeout(this.suggestTimer); this.searchAbort?.abort(); this.suggestAbort?.abort(); }
  }

  if (!customElements.get("searchforge-search")) customElements.define("searchforge-search", SearchForgeSearch);

  window.SearchForgeEmbed = {
    mount(options) {
      const target = typeof options.target === "string" ? document.querySelector(options.target) : options.target;
      if (!(target instanceof HTMLElement)) throw new Error("SearchForge embed target not found");
      const element = document.createElement("searchforge-search");
      target.replaceChildren(element);
      element.configure({ ...options, target: undefined });
      return { element, search: query => element.search(query), focus: () => element.focus(), destroy: () => element.destroy() };
    }
  };
})();
