"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type Key = {
  id: string;
  name: string;
  kind: string;
  prefix: string;
  expiresAt?: string | null;
  ipRestrictions: string[];
  rateLimitPerMinute?: number | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
};

function parseIps(value: FormDataEntryValue | null) {
  return String(value ?? "").split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
}

function expiryStatus(key: Key) {
  if (key.revokedAt) return "revoked";
  if (!key.expiresAt) return "active";
  const remaining = new Date(key.expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "expired";
  if (remaining <= 7 * 24 * 60 * 60 * 1000) return "expires soon";
  return "active";
}

export default function ApiKeysPage() {
  const { projectId } = useProject();
  const [keys, setKeys] = useState<Key[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const selected = useMemo(() => keys.find(key => key.id === editing) ?? null, [keys, editing]);

  const load = async () => {
    if (!projectId) { setKeys([]); return; }
    setLoading(true); setError("");
    try {
      const result = await api<{ keys: Key[] }>(`/v1/projects/${projectId}/api-key-controls`);
      setKeys(result.keys);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load API keys");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [projectId]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!projectId) return;
    const form = new FormData(event.currentTarget);
    const expiry = String(form.get("expiresAt") ?? "").trim();
    const rate = String(form.get("rateLimitPerMinute") ?? "").trim();
    setError("");
    try {
      const result = await api<{ key: string }>(`/v1/projects/${projectId}/api-keys/configured`, {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"), kind: form.get("kind"),
          expiresAt: expiry ? new Date(expiry).toISOString() : null,
          ipRestrictions: parseIps(form.get("ipRestrictions")),
          rateLimitPerMinute: rate ? Number(rate) : null
        })
      });
      setSecret(result.key); event.currentTarget.reset(); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Key creation failed"); }
  };

  const saveControls = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!projectId || !selected) return;
    const form = new FormData(event.currentTarget);
    const expiry = String(form.get("expiresAt") ?? "").trim();
    const rate = String(form.get("rateLimitPerMinute") ?? "").trim();
    setError("");
    try {
      await api(`/v1/projects/${projectId}/api-keys/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expiresAt: expiry ? new Date(expiry).toISOString() : null,
          ipRestrictions: parseIps(form.get("ipRestrictions")),
          rateLimitPerMinute: rate ? Number(rate) : null
        })
      });
      setEditing(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update controls"); }
  };

  const revoke = async (id: string) => {
    if (!projectId || !window.confirm("Revoke this API key? Existing clients will stop working immediately.")) return;
    setError("");
    try { await api(`/v1/projects/${projectId}/api-keys/${id}`, { method: "DELETE" }); setEditing(null); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to revoke key"); }
  };

  return <div className="content">
    <div className="eyebrow">Credentials</div><h1>API keys</h1>
    <p className="muted">Create scoped credentials with expiration, exact-IP allowlists, and enforced per-key request limits. Secrets are displayed once; only keyed digests are stored.</p>
    {secret && <div className="card card-body" style={{ marginTop: 18 }}><strong>Copy this secret now</strong><p className="muted">It cannot be recovered later.</p><div className="secret mono">{secret}</div><button className="btn" style={{ marginTop: 10 }} onClick={() => void navigator.clipboard.writeText(secret)}>Copy secret</button></div>}

    <form className="card card-body stack" onSubmit={create} style={{ marginTop: 18 }}>
      <h2>Create API key</h2><div className="form-row">
        <div className="field"><label>Name</label><input className="input" name="name" maxLength={120} required /></div>
        <div className="field"><label>Scope</label><select className="project-select" name="kind"><option value="search">Search-only</option><option value="indexing">Indexing</option><option value="admin">Admin</option></select></div>
        <div className="field"><label>Expires at</label><input className="input" type="datetime-local" name="expiresAt" /></div>
        <div className="field"><label>Requests / minute</label><input className="input" type="number" name="rateLimitPerMinute" min={1} max={10000} placeholder="Unlimited" /></div>
      </div><div className="field"><label>Allowed IPs</label><input className="input" name="ipRestrictions" placeholder="203.0.113.10, 2001:db8::1 — blank allows any IP" /></div>
      <button className="btn primary" disabled={!projectId}>Create key</button>
    </form>

    {error && <div role="alert" className="card card-body" style={{ color: "var(--danger)", marginTop: 14 }}>{error}</div>}

    {selected && !selected.revokedAt && <form className="card card-body stack" onSubmit={saveControls} style={{ marginTop: 14 }} key={selected.id}>
      <h2>Controls · {selected.name}</h2><div className="form-row">
        <div className="field"><label>Expires at</label><input className="input" type="datetime-local" name="expiresAt" defaultValue={selected.expiresAt ? new Date(selected.expiresAt).toISOString().slice(0,16) : ""} /></div>
        <div className="field"><label>Requests / minute</label><input className="input" type="number" name="rateLimitPerMinute" min={1} max={10000} defaultValue={selected.rateLimitPerMinute ?? ""} placeholder="Unlimited" /></div>
      </div><div className="field"><label>Allowed IPs</label><input className="input" name="ipRestrictions" defaultValue={selected.ipRestrictions.join(", ")} /></div>
      <div className="toolbar"><button className="btn primary">Save controls</button><button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form>}

    <section className="card" style={{ marginTop: 14 }}><div className="table-wrap"><table><thead><tr><th>Name</th><th>Scope</th><th>Status</th><th>Prefix</th><th>Expiration</th><th>Rate</th><th>IP allowlist</th><th>Last used</th><th>Actions</th></tr></thead><tbody>
      {keys.map(key => <tr key={key.id}><td>{key.name}</td><td><span className="badge">{key.kind}</span></td><td><span className="badge">{expiryStatus(key)}</span></td><td className="mono">{key.prefix}</td><td>{key.expiresAt ? new Date(key.expiresAt).toLocaleString() : "Never"}</td><td>{key.rateLimitPerMinute ? `${key.rateLimitPerMinute}/min` : "Global limit"}</td><td>{key.ipRestrictions.length ? key.ipRestrictions.join(", ") : "Any IP"}</td><td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}</td><td><div className="toolbar">{!key.revokedAt && <><button className="btn" onClick={() => setEditing(key.id)}>Edit</button><button className="btn danger" onClick={() => void revoke(key.id)}>Revoke</button></>}</div></td></tr>)}
      {!keys.length && <tr><td colSpan={9} className="empty">{loading ? "Loading API keys…" : "No API keys yet."}</td></tr>}
    </tbody></table></div></section>
  </div>;
}
