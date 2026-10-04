"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type Metric = { used:number; limit:number|null; percent:number|null; state:"unlimited"|"ok"|"warning"|"exceeded" };
type QuotaResponse = {
  period:string;
  role:"viewer"|"developer"|"admin"|"owner";
  limits:{ monthlySearches:number|null; monthlyApiRequests:number|null; monthlyCrawlPages:number|null; maxDocuments:number|null; warningPercent:number };
  current:{ searches:number; apiRequests:number; crawlPages:number; documents:number };
  metrics:{ searches:Metric; apiRequests:Metric; crawlPages:Metric; documents:Metric };
  notifications:Array<{metric:string;state:"warning"|"exceeded";percent:number|null;used:number;limit:number|null}>;
};

const labels:Record<string,string>={ searches:"Monthly searches",apiRequests:"Monthly API requests",crawlPages:"Monthly crawl pages",documents:"Documents" };
const inputNumber=(value:FormDataEntryValue|null)=>value && String(value).trim()?Number(value):null;

export default function UsagePage(){
  const {projectId}=useProject();
  const [data,setData]=useState<QuotaResponse|null>(null);
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const load=async()=>{if(!projectId)return;setError("");try{setData(await api<QuotaResponse>(`/v1/projects/${projectId}/quotas`));}catch(e){setError(e instanceof Error?e.message:"Unable to load quotas");}};
  useEffect(()=>{setData(null);void load();},[projectId]);
  const save=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!projectId)return;const f=new FormData(e.currentTarget);setSaving(true);setError("");try{await api(`/v1/projects/${projectId}/quotas`,{method:"PUT",body:JSON.stringify({monthlySearches:inputNumber(f.get("monthlySearches")),monthlyApiRequests:inputNumber(f.get("monthlyApiRequests")),monthlyCrawlPages:inputNumber(f.get("monthlyCrawlPages")),maxDocuments:inputNumber(f.get("maxDocuments")),warningPercent:Number(f.get("warningPercent"))})});await load();}catch(err){setError(err instanceof Error?err.message:"Unable to save quotas");}finally{setSaving(false);}};
  const canEdit=data?.role==="admin"||data?.role==="owner";
  return <div className="content">
    <div className="eyebrow">Limits & usage</div><h1>Usage</h1>
    <p className="muted">Project-wide monthly usage, hard limits, and in-product threshold notifications. Blank limits mean unlimited.</p>
    {error&&<div className="card card-body" style={{color:"var(--danger)",marginTop:18}}>{error}</div>}
    {data&&<>
      {data.notifications.length>0&&<section className="card card-body" style={{marginTop:18}}><strong>Quota notifications</strong>{data.notifications.map(n=><p key={n.metric} className="muted" style={{marginBottom:0}}>{labels[n.metric]??n.metric}: {n.used.toLocaleString()} / {n.limit?.toLocaleString()} ({Math.round(n.percent??100)}%) — {n.state}</p>)}</section>}
      <div className="grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",marginTop:18}}>{Object.entries(data.metrics).map(([key,m])=><section className="card card-body" key={key}><div className="muted">{labels[key]??key}</div><h2 style={{margin:"8px 0"}}>{m.used.toLocaleString()}</h2><div className="muted">{m.limit===null?"Unlimited":`of ${m.limit.toLocaleString()} · ${Math.round(m.percent??0)}%`}</div><span className="badge" style={{marginTop:10}}>{m.state}</span></section>)}</div>
      <form className="card card-body" onSubmit={save} style={{marginTop:18}}><div className="card-head"><h2>Quota policy</h2><span className="muted">Period {data.period}</span></div><div className="grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))"}}>
        <div className="field"><label>Monthly searches</label><input className="input" name="monthlySearches" type="number" min="1" defaultValue={data.limits.monthlySearches??""} disabled={!canEdit}/></div>
        <div className="field"><label>Monthly API requests</label><input className="input" name="monthlyApiRequests" type="number" min="1" defaultValue={data.limits.monthlyApiRequests??""} disabled={!canEdit}/></div>
        <div className="field"><label>Monthly crawl pages</label><input className="input" name="monthlyCrawlPages" type="number" min="1" defaultValue={data.limits.monthlyCrawlPages??""} disabled={!canEdit}/></div>
        <div className="field"><label>Maximum documents</label><input className="input" name="maxDocuments" type="number" min="1" defaultValue={data.limits.maxDocuments??""} disabled={!canEdit}/></div>
        <div className="field"><label>Warn at %</label><input className="input" name="warningPercent" type="number" min="1" max="99" defaultValue={data.limits.warningPercent} disabled={!canEdit}/></div>
      </div>{canEdit&&<button className="btn primary" disabled={saving} style={{marginTop:14}}>{saving?"Saving…":"Save quota policy"}</button>}</form>
    </>}
  </div>;
}
