"use client";

import Link from "next/link";
import { ArrowUpRight, Braces, Database, Globe2, Layers3, ShieldCheck, Sparkles } from "lucide-react";
import { useLocale } from "./locale-context";

export function LandingPage() {
  const { locale, setLocale, t } = useLocale();
  const features = [
    { icon: Database, title: "Self-hosted by design", body: "Own your data, indexes, and deployment. No hosted search vendor is required." },
    { icon: Globe2, title: "Bilingual analysis", body: "Arabic normalization and English stemming share one explainable lexical pipeline." },
    { icon: Braces, title: "Explainable ranking", body: "Inspect BM25 components, matching terms, facets, and typo expansions." },
    { icon: ShieldCheck, title: "Safe crawling", body: "DNS-pinned requests, robots rules, redirect checks, and private-network blocking." },
    { icon: Layers3, title: "Immutable index releases", body: "Build a new version, activate it atomically, and roll back without rewriting the active segment." },
    { icon: Sparkles, title: "Tenant isolation", body: "Organizations, projects, scoped API keys, quotas, and audit trails." }
  ];

  return (
    <main className="landing-shell">
      <header className="landing-header">
        <Link href="/" className="brand" aria-label="SearchForge home">
          <span className="brand-mark"><Sparkles size={17} /></span>
          <span>SearchForge</span>
        </Link>
        <nav className="landing-actions" aria-label="Main navigation">
          <button className="btn" type="button" onClick={() => setLocale(locale === "en" ? "ar" : "en")} aria-label={t("Switch language")}>
            {locale === "en" ? "العربية" : "English"}
          </button>
          <Link className="btn" href="/login">{t("Sign in")}</Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <div className="eyebrow">{t("Self-hosted search infrastructure")}</div>
          <h1>{t("Search infrastructure, built for your product")}</h1>
          <p>{t("Self-hosted bilingual search with crawling, a custom inverted index, BM25 ranking, typo tolerance, and immutable index releases.")}</p>
          <div className="landing-cta">
            <Link className="btn primary" href="/login">{t("Explore the workspace")} <ArrowUpRight size={16} /></Link>
            <a className="btn" href="https://github.com/The-Null-Catchers/SearchForge/blob/main/docs/architecture.md" target="_blank" rel="noreferrer">{t("Read the architecture")}</a>
          </div>
          <div className="landing-stack" aria-label="Technology stack">
            {["TypeScript", "Next.js", "Fastify", "PostgreSQL", "Redis", "BM25"].map(item => <span key={item}>{item}</span>)}
          </div>
        </div>

        <aside className="landing-console" aria-label="Search API example">
          <div className="landing-console-head">
            <span className="landing-dots"><i /><i /><i /></span>
            <span className="muted mono">POST /v1/indexes/docs/search</span>
            <span className="badge">REST API</span>
          </div>
          <div className="landing-console-body">
            <div className="eyebrow">{t("Search response")}</div>
            <pre dir="ltr"><code>{JSON.stringify({
              query: "محرك البحث",
              facets: ["metadata.category"],
              typoTolerance: true,
              debug: true
            }, null, 2)}</code></pre>
            <div className="landing-console-note">
              <span className="badge">{t("Bilingual analysis")}</span>
              <span className="badge">{t("Explainable ranking")}</span>
            </div>
          </div>
        </aside>
      </section>

      <section className="landing-section" id="capabilities">
        <div className="landing-section-heading">
          <div className="eyebrow">{t("Built for engineers who need control")}</div>
          <h2>{t("Your search stack. Your data. Your rules.")}</h2>
        </div>
        <div className="landing-features">
          {features.map(({ icon: Icon, title, body }) => (
            <article className="landing-feature card" key={title}>
              <span className="landing-feature-icon"><Icon size={19} /></span>
              <h3>{t(title)}</h3>
              <p className="muted">{t(body)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-architecture" id="architecture">
        <div>
          <div className="eyebrow">{t("From URL to ranked result")}</div>
          <h2>{t("One engine. Multiple ways to integrate.")}</h2>
          <p className="muted">{t("Operational visibility")}: {t("Health endpoints, Prometheus metrics, OpenTelemetry traces, durable jobs, and recovery tooling.")}</p>
        </div>
        <div className="pipeline" aria-label={t("Indexing pipeline")}>
          {[t("Crawler"), t("Analyzer"), t("Inverted index"), t("BM25 ranking"), t("REST and SDKs")].map((step, index) => (
            <div className="pipeline-step" key={step}>
              <span className="mono">{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
              {index < 4 && <span className="pipeline-arrow">→</span>}
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <span>SearchForge</span>
        <span className="muted">Self-hosted · Arabic + English · Built for developers</span>
        <Link href="/login">{t("Sign in")}</Link>
      </footer>
    </main>
  );
}
