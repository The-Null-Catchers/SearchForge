const baseUrl = "http://127.0.0.1";

async function request(path, options) {
  const response = await fetch(baseUrl + path, { ...options, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const { accessToken } = await request("/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "owner@searchforge.local", password: "SearchForgeDemo123!" })
});
const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
const { projects } = await request("/v1/me/projects", { headers });
const demo = projects.find(project => project.slug === "docs-search");
if (!demo) throw new Error("The seeded docs-search project is missing");

const { key } = await request(`/v1/projects/${demo.id}/api-keys`, {
  method: "POST",
  headers,
  body: JSON.stringify({ kind: "search", name: "Disposable CI recovery evidence" })
});
if (!key.startsWith("sf_search_")) throw new Error("Expected a search-only key");
process.stdout.write(key);
