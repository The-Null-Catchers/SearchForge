"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { accountAction } from "../lib/auth-api";

type Action = "forgot-password" | "reset-password" | "verify-email";
const labels = {
  "forgot-password": { title: "Reset your password", description: "Enter your email to receive a reset link.", button: "Send reset link", success: "If an account exists for this email, a reset link has been sent." },
  "reset-password": { title: "Choose a new password", description: "Use at least 10 characters. Your existing sessions will be revoked.", button: "Update password", success: "Password updated. Sign in with your new password." },
  "verify-email": { title: "Verify your email", description: "Confirm the email address for your SearchForge account.", button: "Verify email", success: "Email verified. You can return to your workspace." }
} as const;

export function AccountActionForm({ action }: { action: Action }) {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(action === "forgot-password");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  // Read a one-time token once, then remove it from history/referrers.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || action === "forgot-password") return;
    loaded.current = true;
    const url = new URL(window.location.href);
    setToken(url.searchParams.get("token") ?? "");
    url.searchParams.delete("token");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    setReady(true);
  }, [action]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || complete) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (action === "reset-password" && password !== String(form.get("confirmPassword"))) {
      setError("The passwords do not match."); return;
    }
    inFlight.current = true; setLoading(true); setError("");
    try {
      await accountAction(action, action === "forgot-password"
        ? { email: String(form.get("email")) }
        : action === "reset-password" ? { token, password } : { token });
      setComplete(true); setToken("");
      if (action === "reset-password") sessionStorage.removeItem("sf_access_token");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The request failed.");
    } finally { inFlight.current = false; setLoading(false); }
  };
  const copy = labels[action];
  const missing = ready && action !== "forgot-password" && !token && !complete;
  return <main className="login-shell"><form className="card login-card stack" onSubmit={submit}>
    <Link href="/login" className="brand"><div className="brand-mark">⌁</div>SearchForge</Link>
    <div><div className="eyebrow">Account security</div><h1>{copy.title}</h1><p className="muted">{copy.description}</p></div>
    {complete ? <p role="status">{copy.success}</p> : <>
      {action === "forgot-password" && <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" name="email" type="email" autoComplete="email" required /></div>}
      {action === "reset-password" && <>
        <div className="field"><label htmlFor="password">New password</label><input id="password" className="input" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></div>
        <div className="field"><label htmlFor="confirm">Confirm password</label><input id="confirm" className="input" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></div>
      </>}
      {missing && <p role="alert">The link is missing its token. Open the complete link from your email or request a new link.</p>}
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      <button className="btn primary" disabled={loading || !ready || missing}>{loading ? "Working…" : copy.button}</button>
    </>}
    <Link className="btn" href="/login">Back to sign in</Link>
    {action === "reset-password" && <Link className="btn" href="/forgot-password">Request another reset link</Link>}
  </form></main>;
}
