"use client";

import { useLocale } from "../../../components/locale-context";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useProject } from "../../../components/project-context";

type Settings = {
  id: string;
  name: string;
  slug: string;
  description: string;
  defaultLanguage: "en" | "ar" | "auto";
  supportedLanguages: Array<"en" | "ar">;
  analyticsEnabled: boolean;
  role: string;
};

export default function SettingsPage() {
  const { t } = useLocale();
  const { projectId } = useProject();
  const [receipt, setReceipt] = useState<string | null>(null);
  return <div className="content">
    <h1>{t("Settings")}</h1>
    <p className="muted">{t("Manage project identity, language behavior, analytics collection, and destructive operations.")}</p>
    {receipt && <p className="muted" role="status">{t("Deletion accepted. Cleanup receipt")} <bdi className="mono">{receipt}</bdi></p>}
    <ProjectSettings key={projectId} onDeleted={setReceipt} />
  </div>;
}

function ProjectSettings({ onDeleted }: { onDeleted: (receipt: string) => void }) {
  const { t } = useLocale();
  const { projects, projectId, refresh } = useProject();
  const project = useMemo(() => projects.find((item) => item.id === projectId) ?? null, [projects, projectId]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(!!projectId);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId) { setSettings(null); return; }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Settings>(`/v1/projects/${projectId}/settings`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSettings(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Failed to load settings"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, attempt]);

  const canEdit = settings && ["admin", "owner"].includes(settings.role);

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings || !canEdit) return;
    setSaving(true);
    setError("");
    setSaveMessage("");
    try {
      const result = await api<Settings & { rebuildJobId: string | null }>(`/v1/projects/${settings.id}/settings`, {
        method: "PUT",
        body: JSON.stringify({
          name: settings.name,
          description: settings.description,
          defaultLanguage: settings.defaultLanguage,
          supportedLanguages: settings.supportedLanguages,
          analyticsEnabled: settings.analyticsEnabled
        })
      });
      setSettings(current => current ? { ...current, ...result } : current);
      setSaveMessage(result.rebuildJobId
        ? `Saved. Language changes are rebuilding the active index in job ${result.rebuildJobId}.`
        : "Saved. No index rebuild was required.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Project settings update failed"));
    } finally {
      setSaving(false);
    }
  };

  const toggleLanguage = (language: "en" | "ar") => {
    if (!settings || !canEdit) return;
    const exists = settings.supportedLanguages.includes(language);
    if (exists && settings.supportedLanguages.length === 1) return;
    setSettings({
      ...settings,
      supportedLanguages: exists
        ? settings.supportedLanguages.filter(item => item !== language)
        : [...settings.supportedLanguages, language]
    });
  };

  const removeProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project || project.role !== "owner" || confirmation !== project.slug) return;
    setDeleting(true);
    setError("");
    try {
      const result = await api<{ jobId: string }>(`/v1/projects/${project.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation })
      });
      onDeleted(result.jobId);
      setConfirmation("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Project deletion failed"));
    } finally {
      setDeleting(false);
    }
  };

  return <>
    {error && <div role="alert" style={{ color: "var(--danger)", marginTop: 12 }}>{t(error)}
      {!settings && <button className="btn" onClick={() => setAttempt(value => value + 1)}>{t("Retry")}</button>}
    </div>}
    <section className="card card-body" style={{ marginTop: 22 }}>
      <h2>{t("Project configuration")}</h2>
      {!projectId && <p className="muted">{t("Select a project to edit its settings.")}</p>}
      {loading && <p className="muted" role="status">{t("Loading settings…")}</p>}
      {settings && <form onSubmit={saveSettings}>
        <div className="grid-2" style={{ marginTop: 16 }}>
          <div className="field"><label>{t("Name")}</label><input className="input" value={settings.name} disabled={!canEdit} onChange={event => setSettings({ ...settings, name: event.target.value })} /></div>
          <div className="field"><label>{t("Slug")}</label><input className="input mono" value={settings.slug} disabled /></div>
        </div>
        <div className="field" style={{ marginTop: 14 }}><label>{t("Description")}</label><textarea className="input" rows={4} value={settings.description} disabled={!canEdit} onChange={event => setSettings({ ...settings, description: event.target.value })} /></div>
        <div className="grid-2" style={{ marginTop: 14 }}>
          <div className="field"><label>{t("Default language")}</label><select className="input" value={settings.defaultLanguage} disabled={!canEdit} onChange={event => setSettings({ ...settings, defaultLanguage: event.target.value as Settings["defaultLanguage"] })}><option value="auto">{t("Auto detect")}</option><option value="en">{t("English")}</option><option value="ar">{t("Arabic")}</option></select></div>
          <div className="field"><label>{t("Supported languages")}</label><div style={{ display: "flex", gap: 10, marginTop: 8 }}><label><input type="checkbox" checked={settings.supportedLanguages.includes("en")} disabled={!canEdit} onChange={() => toggleLanguage("en")} /> {t("English")}</label><label><input type="checkbox" checked={settings.supportedLanguages.includes("ar")} disabled={!canEdit} onChange={() => toggleLanguage("ar")} /> {t("Arabic")}</label></div></div>
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18 }}><input type="checkbox" checked={settings.analyticsEnabled} disabled={!canEdit} onChange={event => setSettings({ ...settings, analyticsEnabled: event.target.checked })} /> {t("Collect project search and click analytics")}</label>
        {!canEdit && <p className="muted" style={{ marginTop: 14 }}>{t("Admin or owner access is required to modify project settings.")}</p>}
        {canEdit && <button className="btn" disabled={saving || !settings.name.trim() || settings.supportedLanguages.length === 0} style={{ marginTop: 18 }}>{saving ? t("Saving…") : t("Save settings")}</button>}
        {saveMessage && <div className="muted" style={{ marginTop: 12 }}>{saveMessage}</div>}
      </form>}
    </section>

    <section className="card card-body" style={{ marginTop: 22 }}>
      <h2>{t("Danger zone")}</h2>
      {!project && <p className="muted">{t("Select a project to manage destructive operations.")}</p>}
      {project && project.role !== "owner" && <p className="muted">{t("Only an organization owner can permanently delete this project.")}</p>}
      {project && project.role === "owner" && <form onSubmit={removeProject}>
        <p className="muted">{t("This permanently removes indexed documents, sources, API keys, analytics, jobs, and immutable index files. Security audit records and a minimal deletion tombstone are retained.")}</p>
        <div className="field" style={{ marginTop: 16 }}><label>Type <span className="mono">{project.slug}</span> to confirm</label><input className="input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} aria-label={t("Project deletion confirmation")} /></div>
        <button className="btn danger" disabled={deleting || confirmation !== project.slug} style={{ marginTop: 14 }}>{deleting ? t("Deleting…") : t("Delete project permanently")}</button>
      </form>}
    </section>
  </>;
}
