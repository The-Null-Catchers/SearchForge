"use client";

import { FormEvent, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

export default function SettingsPage() {
  const { projects, projectId, refresh } = useProject();
  const project = useMemo(() => projects.find((item) => item.id === projectId) ?? null, [projects, projectId]);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);

  const removeProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project || project.role !== "owner" || confirmation !== project.slug) return;
    setDeleting(true);
    setError("");
    try {
      const result = await api<{ jobId: string }>(`/v1/projects/${project.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation })
      });
      setReceipt(result.jobId);
      setConfirmation("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Project deletion failed");
    } finally {
      setDeleting(false);
    }
  };

  return <div className="content">
    <div className="eyebrow">Project control</div>
    <h1>Settings</h1>
    <p className="muted">Project-level configuration and destructive operations. Deletion is fenced immediately and completed by a durable cleanup job.</p>

    <section className="card card-body" style={{ marginTop: 22 }}>
      <h2>Danger zone</h2>
      {!project && <p className="muted">Select a project to manage destructive operations.</p>}
      {project && project.role !== "owner" && <p className="muted">Only an organization owner can permanently delete this project.</p>}
      {project && project.role === "owner" && <form onSubmit={removeProject}>
        <p className="muted">
          This permanently removes indexed documents, sources, API keys, analytics, jobs, and immutable index files.
          Security audit records and a minimal deletion tombstone are retained.
        </p>
        <div className="field" style={{ marginTop: 16 }}>
          <label>Type <span className="mono">{project.slug}</span> to confirm</label>
          <input
            className="input"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Project deletion confirmation"
          />
        </div>
        <button
          className="btn danger"
          disabled={deleting || confirmation !== project.slug}
          style={{ marginTop: 14 }}
        >
          {deleting ? "Deleting…" : "Delete project permanently"}
        </button>
      </form>}
      {error && <div style={{ color: "var(--danger)", marginTop: 12 }}>{error}</div>}
      {receipt && <div className="muted" style={{ marginTop: 12 }}>
        Deletion accepted. Cleanup receipt: <span className="mono">{receipt}</span>
      </div>}
    </section>
  </div>;
}
