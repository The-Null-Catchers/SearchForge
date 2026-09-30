"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login"|"register">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
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
    setLoading(false);
    if (!response.ok || !body.accessToken) {
      setError(body.error?.message ?? "Authentication failed");
      return;
    }
    sessionStorage.setItem("sf_access_token", body.accessToken);
    router.push("/dashboard");
  };

  return (
    <main className="login-shell">
      <form className="card login-card stack" onSubmit={submit}>
        <div className="brand"><div className="brand-mark">⌁</div>SearchForge</div>
        <div><div className="eyebrow">Developer search infrastructure</div><h1>{mode === "login" ? "Sign in" : "Create account"}</h1><p className="muted">Crawl, index, rank and inspect search from one workspace.</p></div>
        {mode === "register" && <div className="field"><label>Name</label><input className="input" name="displayName" required /></div>}
        <div className="field"><label>Email</label><input className="input" name="email" type="email" required /></div>
        <div className="field"><label>Password</label><input className="input" name="password" type="password" minLength={10} required /></div>
        {error && <div style={{color:"var(--danger)",fontSize:13}}>{error}</div>}
        <button className="btn primary" disabled={loading}>{loading ? "Working…" : mode === "login" ? "Sign in" : "Create account"}</button>
        <button className="btn" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Need an account?" : "Already have an account?"}</button>
      </form>
    </main>
  );
}
