const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

function accessToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("sf_access_token");
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = accessToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include"
  });

  if (response.status === 401 && retry) {
    const refreshed = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: "POST",
      credentials: "include"
    });
    if (refreshed.ok) {
      const body = await refreshed.json() as { accessToken: string };
      sessionStorage.setItem("sf_access_token", body.accessToken);
      return api<T>(path, init, false);
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Request failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function publicSearch<T>(indexSlug: string, apiKey: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}/v1/indexes/${encodeURIComponent(indexSlug)}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(error.error?.message ?? "Search request failed");
  }
  return response.json() as Promise<T>;
}
