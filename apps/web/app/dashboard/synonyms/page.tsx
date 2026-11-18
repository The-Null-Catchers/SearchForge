"use client";

import { type FormEvent, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

export default function SynonymsPage() {
  const { projectId, projects } = useProject();
  const role = projects.find(project => project.id === projectId)?.role;
  const canEdit = role === "owner" || role === "admin" || role === "developer";

  return (
    <div className="content">
      <h1>Synonyms</h1>
      <p className="muted">Search expands project synonyms before BM25 scoring.</p>
      {projectId && canEdit ? (
        <SynonymForm key={projectId} projectId={projectId} />
      ) : (
        <p className="muted">{projectId ? "Only project editors can add synonyms." : "Select a project to add synonyms."}</p>
      )}
    </div>
  );
}

function SynonymForm({ projectId }: { projectId: string }) {
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
      setError("Enter a name and at least two different terms separated by commas.");
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
      setError(cause instanceof Error ? cause.message : "Unable to save the synonym set.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card card-body stack" onSubmit={submit} style={{ maxWidth: 760, marginTop: 22 }}>
      <div className="field">
        <label htmlFor="synonym-name">Name</label>
        <input id="synonym-name" className="input" name="name" required maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="synonym-terms">Terms (comma separated)</label>
        <input id="synonym-terms" className="input" name="terms" dir="auto" placeholder="js, javascript" required />
      </div>
      <label className="muted"><input type="checkbox" name="oneWay" /> One-way expansion (first term → remaining terms)</label>
      <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save synonym set"}</button>
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {saved && <p role="status">Synonym set saved. New searches use it immediately.</p>}
    </form>
  );
}
