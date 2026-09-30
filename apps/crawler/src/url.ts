import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export function normalizeUrl(input: string, base?: string): string {
  const url = base ? new URL(input, base) : new URL(input);
  if (!ALLOWED_SCHEMES.has(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are not allowed");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/") || "/";
  const entries = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    aKey.localeCompare(bKey) || aValue.localeCompare(bValue)
  );
  url.search = "";
  for (const [key, value] of entries) url.searchParams.append(key, value);
  return url.toString();
}

export function isBlockedAddress(address: string): boolean {
  const parsed = ipaddr.parse(address);
  const range = parsed.range();
  return new Set([
    "unspecified",
    "broadcast",
    "multicast",
    "linkLocal",
    "loopback",
    "private",
    "carrierGradeNat",
    "uniqueLocal",
    "ipv4Mapped"
  ]).has(range);
}

export async function assertSafeUrl(input: string, allowPrivateNetworks = false): Promise<URL> {
  const normalized = normalizeUrl(input);
  const url = new URL(normalized);
  if (allowPrivateNetworks) return url;

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Hostname did not resolve");
  for (const result of addresses) {
    if (isBlockedAddress(result.address)) {
      throw new Error(`Blocked crawler destination: ${result.address}`);
    }
  }
  return url;
}

export function sameAllowedDomain(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return false;
  const hostname = new URL(url).hostname.toLowerCase();
  return allowedDomains.some((domain) => {
    const normalized = domain.toLowerCase().replace(/^\./, "");
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}
