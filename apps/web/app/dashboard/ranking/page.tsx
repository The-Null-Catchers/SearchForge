"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type Ranking = {
  bm25: { k1: number; b: number };
  fieldBoosts: Record<string, number>;
  typoTolerance: { enabled: boolean; maxDistance: number; minTokenLength: number };
  prefixSearch: boolean;
};

const defaults: Ranking = {
  bm25: { k1: 1.2, b: 0.75 },
  fieldBoosts: { title: 4, headings: 2.5, content: 1 },
  typoTolerance: { enabled: true, maxDistance: 2, minTokenLength: 4 },
  prefixSearch: true
};

const roleWeight: Record<string, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };

export default function RankingPage() {
  const { projects, projectId } = useProject();
  const project = useMemo(() => projects.find(item => item.id === projectId) ?? null, [projects, projectId]);
  const [ranking, setRanking] = useState<Ranking>(defaults);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setLoading(true);
    setError("");
    setJobId(null);
    void api<{ ranking: Ranking }>(`/v1/projects/${projectId}/ranking`)
      .then(result => { if (active) setRanking(result.ranking); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Failed to load ranking settings"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const canEdit = project ? (roleWeight[project.role] ?? -1) >= roleWeight.developer : false;
  const setBoost = (field: string, value: number) => setRanking(current => ({
    ...current,
    fieldBoosts: { ...current.fieldBoosts, [field]: value }
  }));

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || !canEdit) return;
    setSaving(true);
    setError("");
    setJobId(null);
    try {
      const result = await api<{ jobId: string; ranking: Ranking }>(`/v1/projects/${projectId}/ranking`, {
        method: "PUT",
        body: JSON.stringify(ranking)
      });
      setRanking(result.ranking);
      setJobId(result.jobId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save ranking settings");
    } finally {
      setSaving(false);
    }
  };

  return <div className="content">
    <div className="eyebrow">Relevance</div>
    <h1>Ranking configuration</h1>
    <p className="muted">Tune BM25, field boosts, typo tolerance, and prefix matching. Saving creates a durable rebuild job so the new analyzer and scoring settings become active atomically.</p>

    {loading && <div className="card empty" style={{ marginTop: 22 }}>Loading ranking settings…</div>}
    {!loading && !project && <div className="card empty" style={{ marginTop: 22 }}>Select a project to configure ranking.</div>}
    {!loading && project && <form onSubmit={save} className="card card-body" style={{ marginTop: 22 }}>
      <h2>BM25 scoring</h2>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="field">
          <label>k1 · term-frequency saturation</label>
          <input className="input" type="number" min="0.1" max="4" step="0.05" value={ranking.bm25.k1}
            disabled={!canEdit} onChange={event => setRanking(current => ({ ...current, bm25: { ...current.bm25, k1: Number(event.target.value) } }))} />
        </div>
        <div className="field">
          <label>b · length normalization</label>
          <input className="input" type="number" min="0" max="1" step="0.05" value={ranking.bm25.b}
            disabled={!canEdit} onChange={event => setRanking(current => ({ ...current, bm25: { ...current.bm25, b: Number(event.target.value) } }))} />
        </div>
      </div>

      <h2 style={{ marginTop: 24 }}>Field boosts</h2>
      <div className="grid-3" style={{ marginTop: 14 }}>
        {(["title", "headings", "content"] as const).map(field => <div className="field" key={field}>
          <label>{field}</label>
          <input className="input" type="number" min="0.01" max="100" step="0.25"
            value={ranking.fieldBoosts[field] ?? defaults.fieldBoosts[field]}
            disabled={!canEdit} onChange={event => setBoost(field, Number(event.target.value))} />
        </div>)}
      </div>

      <h2 style={{ marginTop: 24 }}>Query expansion</h2>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <label className="card card-body" style={{ cursor: canEdit ? "pointer" : "default" }}>
          <span><input type="checkbox" checked={ranking.typoTolerance.enabled} disabled={!canEdit}
            onChange={event => setRanking(current => ({ ...current, typoTolerance: { ...current.typoTolerance, enabled: event.target.checked } }))} /> Typo tolerance</span>
          <span className="muted" style={{ marginTop: 8 }}>Use the persisted deletion dictionary before edit-distance scoring.</span>
        </label>
        <label className="card card-body" style={{ cursor: canEdit ? "pointer" : "default" }}>
          <span><input type="checkbox" checked={ranking.prefixSearch} disabled={!canEdit}
            onChange={event => setRanking(current => ({ ...current, prefixSearch: event.target.checked }))} /> Prefix search</span>
          <span className="muted" style={{ marginTop: 8 }}>Allow the final query token to expand as a prefix.</span>
        </label>
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="field">
          <label>Maximum typo distance</label>
          <input className="input" type="number" min="0" max="2" step="1" value={ranking.typoTolerance.maxDistance}
            disabled={!canEdit || !ranking.typoTolerance.enabled}
            onChange={event => setRanking(current => ({ ...current, typoTolerance: { ...current.typoTolerance, maxDistance: Number(event.target.value) } }))} />
        </div>
        <div className="field">
          <label>Minimum token length</label>
          <input className="input" type="number" min="2" max="12" step="1" value={ranking.typoTolerance.minTokenLength}
            disabled={!canEdit || !ranking.typoTolerance.enabled}
            onChange={event => setRanking(current => ({ ...current, typoTolerance: { ...current.typoTolerance, minTokenLength: Number(event.target.value) } }))} />
        </div>
      </div>

      {!canEdit && <p className="muted" style={{ marginTop: 16 }}>Viewer access is read-only. Developer, admin, or owner access is required to change ranking.</p>}
      {canEdit && <button className="btn primary" disabled={saving} style={{ marginTop: 20 }}>{saving ? "Saving & rebuilding…" : "Save ranking & rebuild index"}</button>}
      {error && <div style={{ color: "var(--danger)", marginTop: 12 }}>{error}</div>}
      {jobId && <div className="muted" style={{ marginTop: 12 }}>Ranking saved. Rebuild job: <span className="mono">{jobId}</span></div>}
    </form>}
  </div>;
}
