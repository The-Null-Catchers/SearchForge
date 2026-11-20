const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("playwright");

const baseUrl = (process.env.SEARCHFORGE_E2E_BASE_URL || "http://127.0.0.1").replace(/\/$/, "");
const artifactsDir = process.env.SEARCHFORGE_E2E_ARTIFACTS || "/artifacts/browser-e2e";
const email = process.env.SEARCHFORGE_E2E_EMAIL || "owner@searchforge.local";
const password = process.env.SEARCHFORGE_E2E_PASSWORD || "SearchForgeDemo123!";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyAccountSecurityRoutes(page) {
  await page.goto(`${baseUrl}/forgot-password`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("heading", { name: "Reset your password", exact: true }).waitFor({ timeout: 5_000 });
  assert(await page.getByLabel("Email", { exact: true }).isVisible(), "Forgot-password email field did not render");
  assert(await page.getByRole("button", { name: "Send reset link", exact: true }).isEnabled(), "Forgot-password submit is disabled");

  await page.goto(`${baseUrl}/reset-password`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("heading", { name: "Choose a new password", exact: true }).waitFor({ timeout: 5_000 });
  assert(await page.getByText("The link is missing its token. Open the complete link from your email or request a new link.", { exact: true }).isVisible(), "Reset-password missing-token warning did not render");
  assert(await page.getByRole("button", { name: "Update password", exact: true }).isDisabled(), "Reset-password submit should be disabled without a token");

  await page.goto(`${baseUrl}/reset-password?token=browser-e2e-placeholder`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByLabel("New password", { exact: true }).fill("BrowserE2EPassword123!");
  await page.getByLabel("Confirm password", { exact: true }).fill("BrowserE2EPassword456!");
  assert(!page.url().includes("token="), "Reset token was not scrubbed from browser history");
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  assert(await page.getByText("The passwords do not match.", { exact: true }).isVisible(), "Reset-password client validation did not reject mismatched passwords");

  await page.goto(`${baseUrl}/verify-email`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("heading", { name: "Verify your email", exact: true }).waitFor({ timeout: 5_000 });
  assert(await page.getByText("The link is missing its token. Open the complete link from your email or request a new link.", { exact: true }).isVisible(), "Verify-email missing-token warning did not render");
  assert(await page.getByRole("button", { name: "Verify email", exact: true }).isDisabled(), "Verify-email submit should be disabled without a token");

  await page.goto(`${baseUrl}/verify-email?token=browser-e2e-placeholder`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("heading", { name: "Verify your email", exact: true }).waitFor({ timeout: 5_000 });
  assert(!page.url().includes("token="), "Verification token was not scrubbed from browser history");
  assert(await page.getByRole("button", { name: "Verify email", exact: true }).isEnabled(), "Verify-email submit should be enabled when a token is present");
}


async function verifySearchPlayground(page) {
  async function request(method, route, token, data) {
    const response = await page.request.fetch(`${baseUrl}${route}`, {
      method, headers: { authorization: `Bearer ${token}` }, data
    });
    assert(response.ok(), `${method} ${route} returned HTTP ${response.status()}`);
    return response.json();
  }

  const accessToken = await page.evaluate(() => sessionStorage.getItem("sf_access_token"));
  assert(accessToken, "Browser session does not have an access token");
  const { projects } = await request("GET", "/v1/me/projects", accessToken);
  const docs = projects.find(project => project.slug === "docs-search");
  const labs = projects.find(project => project.slug === "product-catalog");
  assert(docs && labs, "Seeded projects are missing");

  const keysRoute = `/v1/projects/${docs.id}/api-keys`;
  const { key: indexingKey } = await request("POST", keysRoute, accessToken, { name: "Browser fixture import", kind: "indexing" });
  const { key: searchKey } = await request("POST", keysRoute, accessToken, { name: "Browser playground", kind: "search" });
  const documents = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/demo-documents.json"), "utf8"));
  const batch = await request("POST", "/v1/indexes/docs/documents/batch", indexingKey, { documents });
  let state;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const job = await request("GET", `/v1/jobs/${batch.jobId}`, accessToken);
    state = job.state;
    if (state === "completed" || state === "failed" || state === "cancelled") break;
    await delay(500);
  }
  assert(state === "completed", `Portfolio indexing job ended in state ${state}`);

  await page.getByRole("link", { name: "Search Playground", exact: true }).click();
  await page.getByRole("heading", { name: "Search Playground", exact: true }).waitFor();
  const projectSelector = page.locator("select.project-select");
  await projectSelector.selectOption(docs.id);
  const keyInput = page.getByLabel("Search API key");
  const results = page.getByRole("region", { name: "Search results" });
  const runSearch = page.getByRole("button", { name: "Run search", exact: true });
  await keyInput.fill(searchKey);

  async function search() {
    const reply = page.waitForResponse(response =>
      response.url().endsWith("/v1/indexes/docs/search") && response.request().method() === "POST");
    await runSearch.click();
    const response = await reply;
    assert(response.ok(), `Playground search returned HTTP ${response.status()}`);
    await results.getByRole("status").waitFor();
    return response.json();
  }

  await page.getByRole("button", { name: "Arabic search", exact: true }).click();
  await page.getByLabel("Category filter").clear();
  const unfiltered = await search();
  assert(unfiltered.hits.some(hit => hit.document.metadata?.category === "guides"), "Arabic query did not match a guide before filtering");

  await page.getByLabel("Category filter").fill("docs");
  const arabic = await search();
  const arabicHit = results.getByRole("article").filter({ has: page.getByRole("heading", { name: "محرك بحث عربي", exact: true }) });
  await arabicHit.getByText(/BM25 score breakdown/).click();
  assert(arabic.hits.some(hit => hit.id === "search-ar") && arabic.hits.every(hit => hit.document.metadata?.category === "docs"), "Arabic category filter returned unexpected documents");
  assert(await arabicHit.locator("dl dt").count() > 0, "Arabic result is missing BM25 components");
  assert(await arabicHit.locator("mark.match-highlight").count() > 0, "Arabic result did not highlight matching terms");
  await page.screenshot({ path: path.join(artifactsDir, "playground-arabic.png"), fullPage: true });
  await page.screenshot({ path: path.join(artifactsDir, "playground-bm25.png"), fullPage: true });

  await page.getByRole("button", { name: "English typo", exact: true }).click();
  await page.getByLabel("Typo tolerance").uncheck();
  const exact = await search();
  assert(exact.total === 0, "Misspelled query without typo tolerance should have no matches");
  await page.getByLabel("Typo tolerance").check();
  const typo = await search();
  const typoHit = results.getByRole("article").filter({ has: page.getByRole("heading", { name: "JavaScript search engine", exact: true }) });
  await typoHit.getByText(/BM25 score breakdown/).click();
  assert(typo.hits[0]?.id === "search-en", "Typo-tolerant query did not rank the expected document first");
  assert(typo.debug?.expandedTerms?.javscript?.includes("javascript"), "Typo expansion did not include javascript");
  await page.screenshot({ path: path.join(artifactsDir, "playground-typo.png"), fullPage: true });

  const alias = "ecmascript";
  const replacementTitle = "JavaScript search engine release candidate";
  async function searchForAlias() {
    await page.getByLabel("Query", { exact: true }).fill(alias);
    await page.getByLabel("Typo tolerance").uncheck();
    return search();
  }

  const beforeSynonym = await searchForAlias();
  assert(beforeSynonym.total === 0, "The demo alias unexpectedly matches before a synonym is added");
  await page.getByRole("link", { name: "Synonyms", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("ECMAScript documentation");
  const terms = page.getByLabel("Terms (comma separated)", { exact: true });
  await terms.fill(alias);
  const saveSynonym = page.getByRole("button", { name: "Save synonym set", exact: true });
  await saveSynonym.click();
  await page.getByRole("alert").filter({ hasText: "at least two different terms" }).waitFor();
  await terms.fill(`${alias}, javascript`);
  await page.getByLabel(/One-way expansion/).check();
  await saveSynonym.click();
  await page.getByRole("status").filter({ hasText: "Synonym set saved" }).waitFor();

  async function openPlayground() {
    await page.getByRole("link", { name: "Search Playground", exact: true }).click();
    await keyInput.fill(searchKey);
  }
  await openPlayground();
  const expanded = await searchForAlias();
  assert(expanded.hits[0]?.id === "search-en" && expanded.indexVersion === beforeSynonym.indexVersion, "The new synonym did not expand search on the current index");
  await results.getByText(/Expanded ecmascript.*javascript/).waitFor();
  await page.screenshot({ path: path.join(artifactsDir, "playground-synonym.png"), fullPage: true });

  await page.getByRole("link", { name: "Indexes", exact: true }).click();
  const source = page.getByRole("row").filter({ hasText: "search-en" });
  await source.getByRole("button", { name: "Inspect", exact: true }).click();
  const editor = page.getByLabel("Editable document JSON");
  const original = JSON.parse(await editor.inputValue());
  await editor.fill(JSON.stringify({ ...original, title: replacementTitle }));
  await page.getByRole("button", { name: "Save fields", exact: true }).click();
  const oldVersion = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: `v${expanded.indexVersion}`, exact: true })
  });
  await oldVersion.getByRole("cell", { name: "retired", exact: true }).waitFor({ timeout: 60_000 });

  await openPlayground();
  const rebuilt = await searchForAlias();
  assert(Number(rebuilt.indexVersion) > Number(expanded.indexVersion), "An updated immutable version did not become active");
  assert(rebuilt.hits[0]?.id === "search-en" && rebuilt.hits[0].document.title === replacementTitle, "Search did not return the updated indexed document");
  await results.getByRole("heading", { name: replacementTitle, exact: true }).waitFor();

  await page.getByRole("link", { name: "Indexes", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await oldVersion.getByRole("button", { name: "Activate", exact: true }).click();
  await oldVersion.getByRole("cell", { name: "active", exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifactsDir, "index-version-rollback.png"), fullPage: true });

  await openPlayground();
  const rolledBack = await searchForAlias();
  assert(rolledBack.indexVersion === expanded.indexVersion, "Search did not resume serving the original version");
  assert(rolledBack.hits[0]?.id === "search-en" && rolledBack.hits[0].document.title === original.title, "Rollback did not restore the original search result");
  await results.getByRole("heading", { name: original.title, exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifactsDir, "playground-rollback.png"), fullPage: true });

  await projectSelector.selectOption(labs.id);
  await results.getByText("Run a query to see matching documents.").waitFor();
  assert(await keyInput.inputValue() === "", "The previous project's API key remained in the form");
  return { indexedDocuments: documents.length, indexVersion: arabic.indexVersion, arabicHits: arabic.hits.map(hit => hit.id), typoTopHit: typo.hits[0].id,
    synonym: { alias, beforeHits: beforeSynonym.total, afterTopHit: expanded.hits[0].id },
    rollback: { originalVersion: expanded.indexVersion, rebuiltVersion: rebuilt.indexVersion, activeVersion: rolledBack.indexVersion, restoredTitle: rolledBack.hits[0].document.title }
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await verifyAccountSecurityRoutes(page);

    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.getByRole("heading", { name: "Search infrastructure, built for your product", exact: true }).waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.join(artifactsDir, "landing-page.png"), fullPage: true });
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle", timeout: 30_000 });
    assert((await page.locator("h1").textContent())?.trim() === "Sign in", "Login heading did not render");
    const loginBrand = page.locator(".login-card .brand");
    await loginBrand.waitFor({ state: "visible", timeout: 5_000 });
    assert((await loginBrand.textContent())?.includes("SearchForge"), "SearchForge brand is not visible");

    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([
      page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 30_000 }),
      page.getByRole("button", { name: "Sign in", exact: true }).click()
    ]);

    await page.getByRole("heading", { name: "Search overview", exact: true }).waitFor({ timeout: 30_000 });
    const projectOptions = await page.locator("select.project-select option").count();
    assert(projectOptions >= 2, `Expected seeded tenant projects, found ${projectOptions}`);
    assert(await page.getByText("Indexed documents", { exact: true }).isVisible(), "Overview metrics did not render");
    await page.screenshot({ path: path.join(artifactsDir, "dashboard-overview.png"), fullPage: true });
    await page.getByRole("button", { name: "Switch language" }).click();
    await page.waitForFunction(() => document.documentElement.dir === "rtl");
    assert(await page.getByRole("link", { name: "مختبر البحث", exact: true }).isVisible(), "Arabic navigation did not render");
    await page.getByRole("button", { name: "تغيير اللغة" }).click();
    await page.waitForFunction(() => document.documentElement.dir === "ltr");

    const initialTheme = await page.locator("html").getAttribute("data-theme");
    await page.getByRole("button", { name: "Toggle theme" }).click();
    const toggledTheme = await page.locator("html").getAttribute("data-theme");
    assert(initialTheme !== toggledTheme, "Theme toggle did not update the document theme");

    await page.keyboard.press("Control+K");
    const palette = page.getByPlaceholder("Navigate SearchForge…");
    await palette.waitFor({ timeout: 5_000 });
    await palette.fill("Analytics");
    assert(await page.getByRole("button", { name: /Analytics/ }).isVisible(), "Command palette did not filter navigation");
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "Analytics", exact: true }).click();
    await page.waitForURL(/\/dashboard\/analytics$/, { timeout: 15_000 });
    await page.getByRole("heading", { name: "Analytics", exact: true }).waitFor({ timeout: 15_000 });
    assert(await page.getByText("Search feedback", { exact: true }).isVisible(), "Analytics page did not render");
    assert(await page.getByLabel("Analytics time window").isVisible(), "Analytics controls are missing");

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Analytics", exact: true }).waitFor({ timeout: 15_000 });
    assert(page.url().endsWith("/dashboard/analytics"), "Authenticated dashboard route did not survive reload");

    await page.screenshot({ path: path.join(artifactsDir, "dashboard-analytics.png"), fullPage: true });
    const analyticsUrl = page.url();
    const playground = await verifySearchPlayground(page);
    if (pageErrors.length > 0) throw new Error(`Browser page errors: ${pageErrors.join(" | ")}`);
    fs.writeFileSync(path.join(artifactsDir, "result.json"), JSON.stringify({
      status: "passed",
      url: analyticsUrl,
      projectOptions,
      playground,
      accountSecurityRoutes: ["forgot-password", "reset-password", "verify-email"]
    }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(artifactsDir, "failure.png"), fullPage: true }).catch(() => undefined);
    fs.writeFileSync(path.join(artifactsDir, "result.json"), JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : String(error), url: page.url(), pageErrors }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
