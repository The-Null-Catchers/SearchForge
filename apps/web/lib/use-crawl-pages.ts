"use client";
import { useEffect, useState } from "react";
import type { CrawlPagesResponse } from "@searchforge/shared";
import { api } from "./api";

export function useCrawlPages(sourceId: string) {
  const [data, setData] = useState<CrawlPagesResponse>({ pages: [], nextCursor: null });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setData({ pages: [], nextCursor: null }); setLoading(true); setError("");
    const poll = async () => {
      const params = new URLSearchParams({ q, limit: "30", ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) });
      try {
        const result = await api<CrawlPagesResponse>(`/v1/sources/${sourceId}/pages?${params}`, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result); setLoading(false); setError(""); }
      } catch (err) { if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "Unable to load crawl pages"); setLoading(false); } }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sourceId, q, status, cursor]);
  return { data, error, loading,
    filter: (query: string, state: string) => { setQ(query); setStatus(state); setCursor(""); },
    next: () => setCursor(data.nextCursor ?? ""), first: () => setCursor("") };
}
