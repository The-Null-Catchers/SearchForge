"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CrawlConfig } from "@searchforge/shared";
import { api } from "./api";

export type Source = { id: string; name: string; kind: string; config: CrawlConfig; lastCrawledAt?: string | null; deletionRequestedAt?: string | null };
export type Schedule = { sourceId: string; enabled: boolean; intervalSeconds: number; nextRunAt: string };
export type CrawlJob = { id: string; sourceId: string | null; type: string; state: string; phase: string; createdAt: string;
  cancelRequestedAt: string | null; progress: Record<string, unknown> };
type Resources = { sources: Source[]; jobs: CrawlJob[]; schedules: Schedule[] };
const empty: Resources = { sources: [], jobs: [], schedules: [] };

export function useSources(projectId: string | null) {
  const [data, setData] = useState<Resources>(empty);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const activeProject = useRef(projectId);
  activeProject.current = projectId;
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) { setData(empty); setLoading(false); return; }
    const result = await api<Resources>(`/v1/projects/${projectId}/resources`, { signal });
    if (!signal?.aborted && activeProject.current === projectId) { setData(result); setLoading(false); }
  }, [projectId]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setData(empty); setLoading(true); setError(""); setBusy(null);
    const poll = async () => {
      try { await load(controller.signal); setError(""); }
      catch (err) { if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "Unable to load sources"); setLoading(false); } }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load]);

  const mutate = async (id: string, path: string, body?: unknown, method = "POST") => {
    if (busy) return false;
    setBusy(id); setError("");
    try {
      await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      await load();
      return true;
    } catch (err) { if (activeProject.current === projectId) setError(err instanceof Error ? err.message : "Operation failed"); return false; }
    finally { if (activeProject.current === projectId) setBusy(null); }
  };
  return { data, loading, error, busy,
    add: (name: string, url: string) => mutate("add", `/v1/projects/${projectId}/sources`,
      { name, config: { startUrls: [url], maxDepth: 5, maxPages: 10000, respectRobots: true } }),
    update: (id: string, name: string, config: CrawlConfig) => mutate(id, `/v1/sources/${id}`, { name, config }, "PUT"),
    remove: (id: string, confirmation: string) => mutate(id, `/v1/sources/${id}`, { confirmation }, "DELETE"),
    crawl: (id: string) => mutate(id, `/v1/sources/${id}/crawl`),
    cancel: (id: string) => mutate(id, `/v1/jobs/${id}/cancel`),
    schedule: (id: string, intervalSeconds: number, enabled: boolean) => mutate(id, `/v1/sources/${id}/schedule`, { intervalSeconds, enabled }, "PUT")
  };
}
