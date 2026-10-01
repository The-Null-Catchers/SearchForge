"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsoleDocumentDetail, ConsoleDocumentsPage } from "@searchforge/shared";
import { api } from "./api";

export type IndexView = { id: string; name: string; slug: string; activeVersionId: string | null };
export type VersionView = { id: string; sequence: number; state: string; documentCount: number; indexedBytes: number };
type JobView = { id: string; state: string; phase: string; errorMessage?: string; progress: Record<string, unknown> };

export function useIndexExplorer(projectId: string | null) {
  const [indexes, setIndexes] = useState<IndexView[]>([]);
  const [indexId, setIndexId] = useState("");
  const [versions, setVersions] = useState<VersionView[]>([]);
  const [page, setPage] = useState<ConsoleDocumentsPage>({ documents: [], nextAfter: null });
  const [detail, setDetail] = useState<ConsoleDocumentDetail | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("live");
  const [after, setAfter] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<JobView | null>(null);
  const activeScope = useRef("");
  const inspection = useRef(0);
  activeScope.current = `${projectId}:${indexId}`;
  useEffect(() => {
    const controller = new AbortController();
    setIndexes([]); setIndexId(""); setDetail(null); setJob(null); setError(""); setBusy(false); setAfter(""); setQ(""); setStatus("live");
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    void api<{ indexes: IndexView[] }>(`/v1/projects/${projectId}/resources`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setIndexes(result.indexes); setIndexId(result.indexes[0]?.id ?? ""); setLoading(false); } })
      .catch(err => { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setPage({ documents: [], nextAfter: null });
    if (!indexId) { setVersions([]); setLoading(false); return; }
    setLoading(true);
    const params = new URLSearchParams({ q, status, limit: "30", ...(after ? { after } : {}) });
    void Promise.all([
      api<ConsoleDocumentsPage>(`/v1/console/indexes/${indexId}/documents?${params}`, { signal: controller.signal }),
      api<{ versions: VersionView[] }>(`/v1/indexes/${indexId}/versions`, { signal: controller.signal })
    ]).then(([documents, result]) => { if (!controller.signal.aborted) { setPage(documents); setVersions(result.versions); setLoading(false); } })
      .catch(err => { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
    return () => controller.abort();
  }, [indexId, q, status, after, revision]);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.state)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<JobView>(`/v1/jobs/${job.id}`, { signal: controller.signal }).then(result => {
        if (controller.signal.aborted) return;
        setJob(result);
        if (result.state === "completed") setRevision(value => value + 1);
        if (result.state === "failed") setError(result.errorMessage ?? "Index job failed");
      }).catch(err => { if (!controller.signal.aborted) { setError(err.message); setJob(null); } });
    }, 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job]);

  const run = async (path: string, method: string, queued: boolean) => {
    const scope = activeScope.current;
    setBusy(true); setError("");
    try {
      const result = await api<{ jobId?: string }>(path, { method });
      if (scope !== activeScope.current) return true;
      if (queued && result.jobId) setJob({ id: result.jobId, state: "queued", phase: "queued", progress: {} });
      setRevision(value => value + 1);
      return true;
    } catch (err) { if (scope === activeScope.current) setError(err instanceof Error ? err.message : "Operation failed"); return false; }
    finally { if (scope === activeScope.current) setBusy(false); }
  };
  const deleteIndex = async (confirmation: string) => {
    const scope = activeScope.current;
    const removedId = indexId;
    setBusy(true); setError("");
    try {
      const result = await api<{ jobId: string }>(`/v1/console/indexes/${removedId}`, {
        method: "DELETE", body: JSON.stringify({ confirmation })
      });
      if (scope !== activeScope.current) return;
      const remaining = indexes.filter(index => index.id !== removedId);
      setIndexes(remaining); setIndexId(remaining[0]?.id ?? ""); setDetail(null); setAfter("");
      setJob({ id: result.jobId, state: "queued", phase: "cleanup", progress: {} });
      setRevision(value => value + 1);
    } catch (err) { if (scope === activeScope.current) setError(err instanceof Error ? err.message : "Deletion failed"); }
    finally { if (scope === activeScope.current) setBusy(false); }
  };
  const inspect = useCallback(async (documentId: string) => {
    const scope = activeScope.current;
    const sequence = ++inspection.current;
    setBusy(true); setError("");
    try {
      const result = await api<ConsoleDocumentDetail>(`/v1/console/indexes/${indexId}/documents/${encodeURIComponent(documentId)}`);
      if (scope === activeScope.current && sequence === inspection.current) setDetail(result);
    } catch (err) { if (scope === activeScope.current) setError(err instanceof Error ? err.message : "Unable to inspect document"); }
    finally { if (scope === activeScope.current && sequence === inspection.current) setBusy(false); }
  }, [indexId]);
  return { indexes, indexId, versions, page, detail, job, loading, busy, error, status,
    selectIndex: (id: string) => { setIndexId(id); setAfter(""); setDetail(null); setJob(null); setBusy(false); },
    filter: (query: string, nextStatus: string) => { setQ(query); setStatus(nextStatus); setAfter(""); },
    next: () => setAfter(page.nextAfter ?? ""), first: () => setAfter(""), inspect,
    rebuild: () => run(`/v1/console/indexes/${indexId}/rebuild`, "POST", true),
    remove: (id: string) => run(`/v1/console/indexes/${indexId}/documents/${encodeURIComponent(id)}`, "DELETE", true),
    deleteIndex,
    activate: (id: string) => run(`/v1/indexes/${indexId}/versions/${id}/activate`, "POST", false)
  };
}
