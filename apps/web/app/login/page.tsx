"use client";

import { useLocale } from "../../components/locale-context";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function LoginPage() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<"login"|"register">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
    const response = await fetch(`${API_URL}/v1/auth/${mode}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        ...(mode === "register" ? { displayName: form.get("displayName") } : {})
      })
    });
    const body = await response.json().catch(() => ({})) as { accessToken?: string; error?: { message?: string } };
    if (!response.ok || !body.accessToken) {
      setError(body.error?.message ?? t("Authentication failed"));
      return;
    }
    sessionStorage.setItem("sf_access_token", body.accessToken);
    router.push("/dashboard");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Unable to sign in. Please try again."));
    } finally { setLoading(false); }
  };

  return (
    <main className="login-shell">
      <form className="card login-card stack" onSubmit={submit}>
        <div className="toolbar"><Link href="/" className="brand"><span className="brand-mark">⌁</span>SearchForge</Link><button className="btn locale-btn" type="button" onClick={() => setLocale(locale === "en" ? "ar" : "en")} aria-label={t("Switch language")}>{locale === "en" ? "العربية" : "English"}</button></div>
        <div><div className="eyebrow">{t("Developer search infrastructure")}</div><h1>{mode === "login" ? t("Sign in") : t("Create account")}</h1><p className="muted">{t("Crawl, index, rank and inspect search from one workspace.")}</p></div>
        {mode === "register" && <div className="field"><label htmlFor="login-displayName">{t("Name")}</label><input id="login-displayName" className="input" name="displayName" autoComplete="name" required /></div>}
        <div className="field"><label htmlFor="login-email">{t("Email")}</label><input id="login-email" className="input" name="email" autoComplete="email" type="email" dir="ltr" required /></div>
        <div className="field"><label htmlFor="login-password">{t("Password")}</label><input id="login-password" className="input" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} type="password" dir="ltr" minLength={10} required /></div>
        {error && <div role="alert" style={{color:"var(--danger)",fontSize:13}}>{t(error)}</div>}
        <button className="btn primary" disabled={loading}>{loading ? t("Working…") : mode === "login" ? t("Sign in") : t("Create account")}</button>
        {mode === "login" && <Link className="btn" href="/forgot-password">{t("Forgot password?")}</Link>}
        <button className="btn" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? t("Need an account?") : t("Already have an account?")}</button>
      </form>
    </main>
  );
}
