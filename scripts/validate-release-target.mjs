import { isIP } from "node:net";

const candidate = process.argv[2];
if (!candidate) {
  console.error("SEARCHFORGE_LOAD_BASE_URL is required");
  process.exit(2);
}
let url;
try {
  url = new URL(candidate);
} catch {
  console.error("Release evidence requires a valid absolute HTTPS URL");
  process.exit(2);
}
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/" ||
  !url.hostname ||
  url.hostname.endsWith(".localhost") ||
  url.hostname === "localhost" ||
  url.hostname.endsWith(".local") ||
  url.hostname.endsWith(".internal") ||
  url.hostname.endsWith(".test") ||
  url.hostname.endsWith(".invalid") ||
  url.hostname.endsWith(".example") ||
  url.hostname.endsWith(".onion") ||
  url.hostname.endsWith(".home.arpa") ||
  url.hostname.endsWith(".") ||
  isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0 ||
  !url.hostname.includes(".")
) {
  console.error("Release evidence requires an HTTPS origin without credentials, paths, query strings or fragments");
  process.exit(2);
}
