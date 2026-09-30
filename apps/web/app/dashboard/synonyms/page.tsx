"use client";

import { FormEvent, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

export default function SynonymsPage(){
 const {projectId}=useProject(); const [message,setMessage]=useState("");
 const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!projectId)return;const f=new FormData(e.currentTarget);const terms=String(f.get("terms")??"").split(",").map(v=>v.trim()).filter(Boolean);await api(`/v1/projects/${projectId}/synonyms`,{method:"POST",body:JSON.stringify({name:f.get("name"),terms,oneWay:f.get("oneWay")==="on"})});setMessage("Synonym set saved. New searches use it immediately.");e.currentTarget.reset();};
 return <div className="content"><div className="eyebrow">Query expansion</div><h1>Synonyms</h1><p className="muted">Project-specific one-way or two-way synonym groups are applied before BM25 scoring.</p><form className="card card-body stack" onSubmit={submit} style={{maxWidth:760,marginTop:22}}><div className="field"><label>Name</label><input className="input" name="name" required/></div><div className="field"><label>Terms (comma separated)</label><input className="input mono" name="terms" placeholder="js, javascript" required/></div><label className="muted"><input type="checkbox" name="oneWay"/> One-way expansion (first term → remaining terms)</label><button className="btn primary">Save synonym set</button>{message&&<div style={{color:"var(--accent)"}}>{message}</div>}</form></div>;
}
