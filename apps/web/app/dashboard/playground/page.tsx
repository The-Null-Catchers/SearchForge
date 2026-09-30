"use client";

import { FormEvent, useEffect, useState } from "react";
import { publicSearch } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

export default function PlaygroundPage() {
  const { projectId } = useProject();
  const [apiKey,setApiKey] = useState("");
  const [result,setResult] = useState<unknown>(null);
  const [error,setError] = useState("");
  const [latency,setLatency] = useState<number|null>(null);

  useEffect(() => { if (projectId) setApiKey(sessionStorage.getItem(`sf_search_key:${projectId}`) ?? ""); }, [projectId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    if (!apiKey) { setError("Enter a search-only or admin API key for this project."); return; }
    const started=performance.now();
    try {
      const response=await publicSearch("docs",apiKey,{
        query:String(form.get("query") ?? ""),
        facets:["metadata.category"],
        typoTolerance:form.get("typoTolerance")==="on",
        debug:true,
        limit:20
      });
      setLatency(performance.now()-started);
      setResult(response);
      if(projectId) sessionStorage.setItem(`sf_search_key:${projectId}`,apiKey);
    } catch(err) { setError(err instanceof Error ? err.message : "Search failed"); }
  };

  return <div className="content"><div className="eyebrow">Ranking debugger</div><h1>Search Playground</h1><p className="muted">Inspect BM25 components, expanded typo/prefix candidates, facets and end-to-end latency.</p>
    <div className="split" style={{marginTop:22}}>
      <form className="card card-body stack" onSubmit={submit}>
        <div className="field"><label>Search API key</label><input className="input mono" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sf_search_…" /></div>
        <div className="field"><label>Query</label><input className="input" name="query" defaultValue="distributed systems" /></div>
        <label className="muted" style={{display:"flex",gap:8,alignItems:"center"}}><input type="checkbox" name="typoTolerance" defaultChecked/> Typo tolerance</label>
        <button className="btn primary">Run search</button>
        {latency !== null && <div className="muted">Client round-trip: {latency.toFixed(1)} ms</div>}
        {error && <div style={{color:"var(--danger)"}}>{error}</div>}
      </form>
      <div className="card"><div className="card-head"><h2>Response</h2></div><div className="card-body"><pre className="codebox">{result ? JSON.stringify(result,null,2) : "Run a query to inspect the response."}</pre></div></div>
    </div>
  </div>;
}
