"use client";

import { FormEvent, useEffect, useState } from "react";

type Props = {
  documentId: string;
  body: Record<string, unknown>;
  disabled: boolean;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
};

export function DocumentEditor({ documentId, body, disabled, onSave }: Props) {
  const [text, setText] = useState(() => JSON.stringify(body, null, 2));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setText(JSON.stringify(body, null, 2));
    setError("");
    setSaved(false);
  }, [documentId, body]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaved(false);
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { setError("Enter valid JSON before saving."); return; }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      setError("The document must be a JSON object.");
      return;
    }
    const next = { ...(parsed as Record<string, unknown>), id: documentId };
    const ok = await onSave(next);
    if (ok) setSaved(true);
  };

  return <details open>
    <summary>Edit stored fields</summary>
    <form onSubmit={submit} className="stack" style={{ marginTop: 12 }}>
      <p className="muted">Edit the complete stored JSON object. The document ID is immutable. Saving queues an immutable index rebuild while the current active version keeps serving search.</p>
      <textarea
        className="input mono"
        aria-label="Editable document JSON"
        value={text}
        onChange={event => { setText(event.target.value); setSaved(false); }}
        rows={16}
        spellCheck={false}
        style={{ width: "100%", resize: "vertical" }}
      />
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {saved && <p role="status" className="muted">Stored fields updated. The replacement index build has been queued when changes were detected.</p>}
      <div className="toolbar">
        <button className="btn primary" disabled={disabled}>Save fields</button>
        <button className="btn" type="button" disabled={disabled} onClick={() => { setText(JSON.stringify(body, null, 2)); setError(""); setSaved(false); }}>Reset</button>
      </div>
    </form>
  </details>;
}
