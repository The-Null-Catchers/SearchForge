"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type Key={id:string;name:string;kind:string;prefix:string;lastUsedAt?:string|null;revokedAt?:string|null};
export default function ApiKeysPage(){
 const {projectId}=useProject(); const [keys,setKeys]=useState<Key[]>([]); const [secret,setSecret]=useState<string|null>(null); const [error,setError]=useState("");
 const load=()=>projectId?api<{keys:Key[]}>(`/v1/projects/${projectId}/api-keys`).then(r=>setKeys(r.keys)).catch(e=>setError(e.message)):Promise.resolve();
 useEffect(()=>{void load();},[projectId]);
 const create=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!projectId)return;const f=new FormData(e.currentTarget);try{const r=await api<{key:string}>(`/v1/projects/${projectId}/api-keys`,{method:"POST",body:JSON.stringify({name:f.get("name"),kind:f.get("kind")})});setSecret(r.key);await load();}catch(err){setError(err instanceof Error?err.message:"Failed");}};
 const revoke=async(id:string)=>{if(!projectId)return;await api(`/v1/projects/${projectId}/api-keys/${id}`,{method:"DELETE"});await load();};
 return <div className="content"><div className="eyebrow">Credentials</div><h1>API keys</h1><p className="muted">Secrets are displayed once. Only keyed digests are stored server-side.</p>{secret&&<div className="secret mono" style={{margin:"18px 0"}}>{secret}</div>}<form className="card card-body form-row" onSubmit={create} style={{marginTop:18}}><div className="field"><label>Name</label><input className="input" name="name" required/></div><div className="field"><label>Scope</label><select className="project-select" name="kind"><option value="search">Search-only</option><option value="indexing">Indexing</option><option value="admin">Admin</option></select></div><button className="btn primary">Create key</button></form>{error&&<div style={{color:"var(--danger)"}}>{error}</div>}<section className="card" style={{marginTop:14}}><div className="table-wrap"><table><thead><tr><th>Name</th><th>Scope</th><th>Prefix</th><th>Last used</th><th></th></tr></thead><tbody>{keys.map(k=><tr key={k.id}><td>{k.name}</td><td><span className="badge">{k.kind}</span></td><td className="mono">{k.prefix}</td><td>{k.lastUsedAt?new Date(k.lastUsedAt).toLocaleString():"Never"}</td><td>{!k.revokedAt&&<button className="btn danger" onClick={()=>void revoke(k.id)}>Revoke</button>}</td></tr>)}</tbody></table></div></section></div>;
}
