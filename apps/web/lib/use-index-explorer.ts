"use client";
import { useCallback, useEffect, useState } from "react";
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
  useEffect(() => {
    const controller = new AbortController();
    setIndexes([]); setIndexId(""); setDetail(null); setJob(null); setError("");
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
    if (!indexId) { setVersions([]); return; }
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
    setBusy(true); setError("");
    try {
      const result = await api<{ jobId?: string }>(path, { method });
      if (queued && result.jobId) setJob({ id: result.jobId, state: "queued", phase: "queued", progress: {} });
      setRevision(value => value + 1);
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : "Operation failed"); return false; }
    finally { setBusy(false); }
  };
  const inspect = useCallback(async (documentId: string) => {
    setBusy(true); setError("");
    try { setDetail(await api<ConsoleDocumentDetail>(`/v1/console/indexes/${indexId}/documents/${encodeURIComponent(documentId)}`)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to inspect document"); }
    finally { setBusy(false); }
  }, [indexId]);
  return { indexes, indexId, versions, page, detail, job, loading, busy, error, status,
    selectIndex: (id: string) => { setIndexId(id); setAfter(""); setDetail(null); setJob(null); },
    filter: (query: string, nextStatus: string) => { setQ(query); setStatus(nextStatus); setAfter(""); },
    next: () => setAfter(page.nextAfter ?? ""), first: () => setAfter(""), inspect,
    rebuild: () => run(`/v1/console/indexes/${indexId}/rebuild`, "POST", true),
    remove: (id: string) => run(`/v1/console/indexes/${indexId}/documents/${encodeURIComponent(id)}`, "DELETE", true),
    activate: (id: string) => run(`/v1/indexes/${indexId}/versions/${id}/activate`, "POST", false)
  };
}
