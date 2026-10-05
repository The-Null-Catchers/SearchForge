const fs = require("node:fs");
const path = require("node:path");
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await verifyAccountSecurityRoutes(page);

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

    if (pageErrors.length > 0) throw new Error(`Browser page errors: ${pageErrors.join(" | ")}`);

    await page.screenshot({ path: path.join(artifactsDir, "dashboard-analytics.png"), fullPage: true });
    fs.writeFileSync(path.join(artifactsDir, "result.json"), JSON.stringify({
      status: "passed",
      url: page.url(),
      projectOptions,
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
