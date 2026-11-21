"use client";

import { type FormEvent, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";
import { useLocale } from "../../../components/locale-context";

export default function SynonymsPage() {
  const { projectId, projects } = useProject();
  const { t } = useLocale();
  const role = projects.find(project => project.id === projectId)?.role;
  const canEdit = role === "owner" || role === "admin" || role === "developer";

  return (
    <div className="content">
      <h1>{t("Synonyms")}</h1>
      <p className="muted">{t("Search expands project synonyms before BM25 scoring.")}</p>
      {projectId && canEdit ? (
        <SynonymForm key={projectId} projectId={projectId} />
      ) : (
        <p className="muted">{projectId ? t("Only project editors can add synonyms.") : t("Select a project to add synonyms.")}</p>
      )}
    </div>
  );
}

function SynonymForm({ projectId }: { projectId: string }) {
  const { t } = useLocale();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    const form = event.currentTarget;
    const values = new FormData(form);
    const name = String(values.get("name") ?? "").trim();
    const terms = String(values.get("terms") ?? "").split(",").map(term => term.trim()).filter(Boolean);
    if (!name || new Set(terms.map(term => term.toLowerCase())).size < 2) {
      setError(t("Enter a name and at least two different terms separated by commas."));
      return;
    }

    setPending(true);
    try {
      await api(`/v1/projects/${projectId}/synonyms`, {
        method: "POST",
        body: JSON.stringify({ name, terms, oneWay: values.get("oneWay") === "on" })
      });
      form.reset();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Unable to save the synonym set."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card card-body stack" onSubmit={submit} style={{ maxWidth: 760, marginTop: 22 }}>
      <div className="field">
        <label htmlFor="synonym-name">{t("Name")}</label>
        <input id="synonym-name" className="input" name="name" required maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="synonym-terms">{t("Terms (comma separated)")}</label>
        <input id="synonym-terms" className="input" name="terms" dir="auto" placeholder="js, javascript" required />
      </div>
      <label className="muted"><input type="checkbox" name="oneWay" /> {t("One-way expansion (first term → remaining terms)")}</label>
      <button className="btn primary" disabled={pending}>{pending ? t("Saving…") : t("Save synonym set")}</button>
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {saved && <p role="status">{t("Synonym set saved. New searches use it immediately.")}</p>}
    </form>
  );
}
