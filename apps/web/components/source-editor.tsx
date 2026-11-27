"use client";
import { useLocale } from "./locale-context";
import { FormEvent, useState } from "react";
import type { CrawlConfig } from "@searchforge/shared";
import type { Source } from "../lib/use-sources";
import { readCrawlForm } from "../lib/source-form";

export function SourceEditor({ source, disabled, save }: { source: Source; disabled: boolean; save: (name: string, config: CrawlConfig) => Promise<boolean> }) {
  const { t } = useLocale();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaved(false); setError("");
    try {
      const fields = new FormData(event.currentTarget);
      setSaved(await save(String(fields.get("name")), readCrawlForm(fields, source.config)));
    } catch (err) { setError(err instanceof Error ? err.message : t("Invalid crawl rules")); }
  };
  return <section className="card card-body" style={{ marginTop: 14 }}><h2>{t("Crawl rules")} · <bdi>{source.name}</bdi></h2><p className="muted">{t("Changes apply to the next crawl. robots.txt stays enforced; private network protection is controlled by the deployment.")}</p>
    <form className="stack" onSubmit={submit}>
      <label className="field">{t("Source name")}<input className="input" name="name" defaultValue={source.name} required maxLength={140}/></label>
      <label className="field">{t("Start URLs · one per line")}<textarea className="textarea" name="startUrls" dir="ltr" defaultValue={source.config.startUrls.join("\n")} required/></label>
      <div className="form-row"><label className="field">{t("Include paths · one glob per line")}<textarea className="textarea" name="include" dir="ltr" defaultValue={source.config.include.join("\n")}/></label>
        <label className="field">{t("Exclude paths · one glob per line")}<textarea className="textarea" name="exclude" dir="ltr" defaultValue={source.config.exclude.join("\n")}/></label></div>
      <label className="field">{t("Allowed domains · blank uses start URL hosts")}<textarea className="textarea" name="allowedDomains" dir="ltr" placeholder="docs.example.com" defaultValue={source.config.allowedDomains.join("\n")}/></label>
      <div className="form-row">{([
        ["maxPages", "Page limit", 1, 1000000], ["maxDepth", "Maximum depth", 0, 50],
        ["concurrency", "Concurrent requests", 1, 64], ["perDomainConcurrency", "Requests per domain", 1, 16],
        ["requestTimeoutMs", "Request timeout (ms)", 1000, 120000],
        ["retryMaxAttempts", "Maximum fetch attempts", 1, 5],
        ["retryBaseDelayMs", "Retry base delay (ms)", 100, 10000],
        ["retryMaxDelayMs", "Maximum retry wait (ms)", 100, 30000]
      ] as const).map(([name, label, min, max]) => <label className="field" key={name}>{t(label)}<input className="input" type="number" name={name} min={min} max={max} defaultValue={source.config[name] ?? ({retryMaxAttempts:3,retryBaseDelayMs:500,retryMaxDelayMs:30000} as Record<string, number>)[name]} required/></label>)}</div>
      <p className="muted">{t("Transient fetch failures use backoff. Long Retry-After delays are scheduled for later delivery.")}</p>
      <span className="badge">{t("Respect robots.txt: ON")}</span>
      {error && <p role="alert" style={{ color: "var(--danger)", whiteSpace: "pre-wrap" }}>{t(error)}</p>}{saved && <p role="status">{t("Crawl rules saved.")}</p>}
      <button className="btn primary" disabled={disabled}>{t("Save crawl rules")}</button>
    </form>
  </section>;
}
