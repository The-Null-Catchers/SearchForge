"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";
import { useLocale } from "../../../components/locale-context";

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
  const { projectId, projects } = useProject();
  const { t } = useLocale();
  const role = projects.find(project => project.id === projectId)?.role;
  return <div className="content">
    <h1>{t("API keys")}</h1>
    {projectId && (role === "owner" || role === "admin")
      ? <ProjectKeys key={projectId} projectId={projectId} />
      : <p className="empty">{t(projectId ? "Only admins and owners can manage API keys." : "Select a project to manage API keys.")}</p>}
  </div>;
}

function ProjectKeys({ projectId }: { projectId: string }) {
  const { t, locale } = useLocale();
  const [keys, setKeys] = useState<Key[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const selected = useMemo(() => keys.find(key => key.id === editing) ?? null, [keys, editing]);

  const load = async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const result = await api<{ keys: Key[] }>(`/v1/projects/${projectId}/api-key-controls`, { signal });
      if (!signal?.aborted) setKeys(result.keys);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t("Unable to load API keys"));
    } finally { if (!signal?.aborted) setLoading(false); }
  };
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [projectId]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!projectId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
      setSecret(result.key); formElement.reset(); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Key creation failed")); }
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Unable to update controls")); }
  };

  const revoke = async (id: string) => {
    if (!projectId || !window.confirm(t("Revoke this API key? Existing clients will stop working immediately."))) return;
    setError("");
    try { await api(`/v1/projects/${projectId}/api-keys/${id}`, { method: "DELETE" }); setEditing(null); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Unable to revoke key")); }
  };

  const localExpiry = selected?.expiresAt ? new Date(selected.expiresAt) : null;
  const expiryInput = localExpiry
    ? new Date(localExpiry.getTime() - localExpiry.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";

  return <>
    <p className="muted">{t("Create scoped credentials with expiration, exact-IP allowlists, and enforced per-key request limits. Secrets are displayed once; only keyed digests are stored.")}</p>
    {secret && <div className="card card-body" style={{ marginTop: 18 }}><strong>{t("Copy this secret now")}</strong><p className="muted">{t("It cannot be recovered later.")}</p><div className="secret mono" dir="ltr">{secret}</div><button className="btn" style={{ marginTop: 10 }} onClick={() => void navigator.clipboard.writeText(secret)}>{t("Copy secret")}</button></div>}

    <form className="card card-body stack" onSubmit={create} style={{ marginTop: 18 }}>
      <h2>{t("Create API key")}</h2><div className="form-row">
        <div className="field"><label>{t("Name")}<input className="input" name="name" maxLength={120} required /></label></div>
        <div className="field"><label>{t("Scope")}<select className="project-select" name="kind"><option value="search">{t("Search-only")}</option><option value="indexing">{t("Indexing")}</option><option value="admin">{t("Admin")}</option></select></label></div>
        <div className="field"><label>{t("Expires at")}<input className="input" type="datetime-local" name="expiresAt" /></label></div>
        <div className="field"><label>{t("Requests / minute")}<input className="input" type="number" name="rateLimitPerMinute" min={1} max={10000} placeholder={t("Unlimited")} /></label></div>
      </div><div className="field"><label>{t("Allowed IPs")}<input className="input" name="ipRestrictions" dir="ltr" placeholder="203.0.113.10, 2001:db8::1" /></label></div>
      <button className="btn primary" disabled={!projectId}>{t("Create key")}</button>
    </form>

    {error && <div role="alert" className="card card-body" style={{ color: "var(--danger)", marginTop: 14 }}>{t(error)} <button type="button" className="btn" onClick={() => void load()}>{t("Refresh keys")}</button></div>}

    {selected && !selected.revokedAt && <form className="card card-body stack" onSubmit={saveControls} style={{ marginTop: 14 }} key={selected.id}>
      <h2>Controls · <bdi>{selected.name}</bdi></h2><div className="form-row">
        <div className="field"><label>{t("Expires at")}<input className="input" type="datetime-local" name="expiresAt" defaultValue={expiryInput} /></label></div>
        <div className="field"><label>{t("Requests / minute")}<input className="input" type="number" name="rateLimitPerMinute" min={1} max={10000} defaultValue={selected.rateLimitPerMinute ?? ""} placeholder={t("Unlimited")} /></label></div>
      </div><div className="field"><label>{t("Allowed IPs")}<input className="input" name="ipRestrictions" defaultValue={selected.ipRestrictions.join(", ")} /></label></div>
      <div className="toolbar"><button className="btn primary">{t("Save controls")}</button><button className="btn" type="button" onClick={() => setEditing(null)}>{t("Cancel")}</button></div>
    </form>}

    <section className="card" style={{ marginTop: 14 }}><div className="table-wrap"><table><thead><tr><th>{t("Name")}</th><th>{t("Scope")}</th><th>{t("Status")}</th><th>{t("Prefix")}</th><th>{t("Expiration")}</th><th>{t("Rate")}</th><th>{t("IP allowlist")}</th><th>{t("Last used")}</th><th>Actions</th></tr></thead><tbody>
      {keys.map(key => <tr key={key.id}><td><bdi>{key.name}</bdi></td><td><span className="badge">{t(key.kind)}</span></td><td><span className="badge">{t(expiryStatus(key))}</span></td><td className="mono"><bdi dir="ltr">{key.prefix}</bdi></td><td>{key.expiresAt ? new Date(key.expiresAt).toLocaleString(locale) : t("Never")}</td><td>{key.rateLimitPerMinute ? `${key.rateLimitPerMinute.toLocaleString(locale)}/min` : t("Global limit")}</td><td>{key.ipRestrictions.length ? key.ipRestrictions.join(", ") : t("Any IP")}</td><td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString(locale) : t("Never")}</td><td><div className="toolbar">{!key.revokedAt && <><button className="btn" onClick={() => setEditing(key.id)}>{t("Edit")}</button><button className="btn danger" onClick={() => void revoke(key.id)}>{t("Revoke")}</button></>}</div></td></tr>)}
      {!keys.length && <tr><td colSpan={9} className="empty">{loading ? t("Loading API keys…") : t("No API keys yet.")}</td></tr>}
    </tbody></table></div></section>
  </>;
}
