"use client";

import Link from "next/link";
import { ArrowUpRight, Braces, Database, Globe2, Layers3, ShieldCheck, Sparkles } from "lucide-react";
import { useLocale } from "./locale-context";

const docs = "https://github.com/The-Null-Catchers/SearchForge/blob/main/docs";

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
        <Link href="/" className="brand" aria-label={t("SearchForge home")}>
          <span className="brand-mark"><Sparkles size={17} /></span>
          <span>SearchForge</span>
        </Link>
        <nav className="landing-actions" aria-label={t("Main navigation")}>
          <a className="btn" href={`${docs}/development.md`}>{t("Documentation")}</a>
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
            <a className="btn" href={`${docs}/playground-demo.md`}>{t("Run the bilingual demo")}</a>
          </div>
          <div className="landing-stack" aria-label={t("Technology stack")}>
            {["TypeScript", "Next.js", "Fastify", "PostgreSQL", "Redis", "BM25"].map(item => <span key={item}>{item}</span>)}
          </div>
        </div>

        <aside className="landing-console" aria-label={t("Search API example")}>
          <div className="landing-console-head">
            <span className="landing-dots"><i /><i /><i /></span>
            <bdi className="muted mono" dir="ltr">POST /v1/indexes/docs/search</bdi>
          </div>
          <div className="landing-console-body">
            <div className="eyebrow">{t("Example request body")}</div>
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
        <div className="landing-section-heading"><h2>{t("Search for documentation, knowledge bases, and product catalogs")}</h2></div>
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
          <p className="muted">{t("The crawler and ingest API feed a durable queue. Workers publish immutable index segments, and Fastify serves searches from the active version.")}</p>
          <a className="btn" href={`${docs}/architecture.md`}>{t("Read the architecture")}</a>
        </div>
        <div className="pipeline" aria-label={t("Indexing pipeline")}>
          {[t("Crawler"), t("Analyzer"), t("Inverted index"), t("BM25 ranking"), t("REST and SDKs")].map((step, index) => (
            <div className="pipeline-step" key={step}>
              <strong>{step}</strong>
              {index < 4 && <span className="pipeline-arrow" aria-hidden="true">{locale === "ar" ? "←" : "→"}</span>}
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <span>SearchForge</span>
        <a href={`${docs}/sdk.md`}>{t("SDK documentation")}</a>
        <a href={`${docs}/CASE_STUDY.md`}>{t("Engineering case study")}</a>
      </footer>
    </main>
  );
}
