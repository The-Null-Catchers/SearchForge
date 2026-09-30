"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type Index={id:string;name:string;slug:string;activeVersionId?:string|null};
type Resources={indexes:Index[]};
type Version={id:string;sequence:number;state:string;documentCount:number;indexedBytes:number;activatedAt?:string|null};

export default function IndexesPage(){
 const {projectId}=useProject(); const [indexes,setIndexes]=useState<Index[]>([]); const [versions,setVersions]=useState<Record<string,Version[]>>({});
 useEffect(()=>{if(!projectId)return;api<Resources>(`/v1/projects/${projectId}/resources`).then(async r=>{setIndexes(r.indexes);const entries=await Promise.all(r.indexes.map(async i=>[i.id,(await api<{versions:Version[]}>(`/v1/indexes/${i.id}/versions`)).versions] as const));setVersions(Object.fromEntries(entries));}).catch(()=>{});},[projectId]);
 const activate=async(indexId:string,versionId:string)=>{await api(`/v1/indexes/${indexId}/versions/${versionId}/activate`,{method:"POST"});const r=await api<{versions:Version[]}>(`/v1/indexes/${indexId}/versions`);setVersions(v=>({...v,[indexId]:r.versions}));};
 return <div className="content"><div className="eyebrow">Immutable segments</div><h1>Indexes & versions</h1><p className="muted">Builds never overwrite the active index. A ready or retired version can be activated atomically for rollback.</p><div className="stack" style={{marginTop:22}}>{indexes.map(index=><section className="card" key={index.id}><div className="card-head"><div><h2>{index.name}</h2><div className="muted mono">{index.slug}</div></div><span className="badge">active pointer</span></div><div className="table-wrap"><table><thead><tr><th>Version</th><th>State</th><th>Documents</th><th>Size</th><th></th></tr></thead><tbody>{(versions[index.id]??[]).map(v=><tr key={v.id}><td className="mono">v{v.sequence}</td><td><span className="badge">{v.state}</span></td><td>{v.documentCount}</td><td>{(v.indexedBytes/1024).toFixed(1)} KB</td><td>{v.state!=="active"&&["ready","retired"].includes(v.state)&&<button className="btn" onClick={()=>void activate(index.id,v.id)}>Activate</button>}</td></tr>)}</tbody></table></div></section>)}{indexes.length===0&&<div className="card empty">No indexes in this project.</div>}</div></div>;
}
