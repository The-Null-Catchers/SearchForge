"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type Source={id:string;name:string;kind:string;lastCrawledAt?:string|null;config:Record<string,unknown>};
type Resources={sources:Source[];jobs:Array<{id:string;type:string;state:string;phase:string;createdAt:string}>};

export default function SourcesPage(){
  const {projectId}=useProject();
  const [data,setData]=useState<Resources>({sources:[],jobs:[]});
  const [error,setError]=useState("");
  const load=()=>projectId?api<Resources>(`/v1/projects/${projectId}/resources`).then(setData).catch(e=>setError(e.message)):Promise.resolve();
  useEffect(()=>{void load();},[projectId]);

  const add=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault(); if(!projectId)return; const f=new FormData(e.currentTarget);
    try{
      await api(`/v1/projects/${projectId}/sources`,{method:"POST",body:JSON.stringify({name:f.get("name"),config:{startUrls:[f.get("url")],maxDepth:5,maxPages:10000,include:["/**"],exclude:[],allowedDomains:[],requestTimeoutMs:15000,concurrency:8,perDomainConcurrency:2,respectRobots:true,storeRawHtml:false}})});
      e.currentTarget.reset(); await load();
    }catch(err){setError(err instanceof Error?err.message:"Failed to add source");}
  };
  const crawl=async(id:string)=>{try{await api(`/v1/sources/${id}/crawl`,{method:"POST"});await load();}catch(err){setError(err instanceof Error?err.message:"Failed to start crawl");}};

  return <div className="content"><div className="eyebrow">Discovery pipeline</div><h1>Sources & crawler</h1><p className="muted">Robots-aware crawling is enabled by default. Private network targets are denied by the crawler safety layer.</p>
    <form className="card card-body form-row" onSubmit={add} style={{marginTop:22}}><div className="field"><label>Source name</label><input className="input" name="name" required/></div><div className="field"><label>Start URL</label><input className="input" type="url" name="url" placeholder="https://docs.example.com" required/></div><button className="btn primary">Add website</button></form>
    {error&&<div style={{color:"var(--danger)",marginTop:12}}>{error}</div>}
    <section className="card" style={{marginTop:14}}><div className="card-head"><h2>Websites</h2></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Last crawled</th><th></th></tr></thead><tbody>
      {data.sources.map(s=><tr key={s.id}><td>{s.name}</td><td><span className="badge">{s.kind}</span></td><td>{s.lastCrawledAt?new Date(s.lastCrawledAt).toLocaleString():"Never"}</td><td><button className="btn" onClick={()=>void crawl(s.id)}>Run crawl</button></td></tr>)}
      {data.sources.length===0&&<tr><td colSpan={4} className="empty">No sources yet.</td></tr>}
    </tbody></table></div></section>
    <section className="card" style={{marginTop:14}}><div className="card-head"><h2>Recent jobs</h2></div><div className="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Phase</th><th>Created</th></tr></thead><tbody>{data.jobs.map(j=><tr key={j.id}><td>{j.type}</td><td><span className="badge">{j.state}</span></td><td>{j.phase}</td><td>{new Date(j.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div></section>
  </div>;
}
