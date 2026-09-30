"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type Row={query:string;searches:number;averageLatencyMs?:string|null};
export default function AnalyticsPage(){
  const {projectId}=useProject(); const [data,setData]=useState<{topQueries:Row[];zeroResultQueries:Row[]}>({topQueries:[],zeroResultQueries:[]});
  useEffect(()=>{if(projectId)api<typeof data>(`/v1/projects/${projectId}/analytics`).then(setData).catch(()=>{});},[projectId]);
  const table=(rows:Row[])=> <div className="table-wrap"><table><thead><tr><th>Query</th><th>Searches</th><th>Avg latency</th></tr></thead><tbody>{rows.map(r=><tr key={r.query}><td className="mono">{r.query}</td><td>{r.searches}</td><td>{r.averageLatencyMs?Number(r.averageLatencyMs).toFixed(1)+" ms":"—"}</td></tr>)}{rows.length===0&&<tr><td colSpan={3} className="empty">No search events yet.</td></tr>}</tbody></table></div>;
  return <div className="content"><div className="eyebrow">Search feedback</div><h1>Analytics</h1><p className="muted">Queries are analytics-only by default and never alter ranking unless a future ranking experiment explicitly enables that behavior.</p><div className="grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(360px,1fr))",marginTop:22}}><section className="card"><div className="card-head"><h2>Top queries</h2></div>{table(data.topQueries)}</section><section className="card"><div className="card-head"><h2>Zero-result queries</h2></div>{table(data.zeroResultQueries)}</section></div></div>;
}
