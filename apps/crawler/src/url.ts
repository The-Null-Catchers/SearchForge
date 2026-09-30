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
  return parsed.range() !== "unicast";
}

export async function resolveSafeDestination(input: string, allowPrivateNetworks = false) {
  const url = new URL(normalizeUrl(input));
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === "ipv4" ? 4 : 6 }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Hostname did not resolve");
  if (!allowPrivateNetworks && addresses.some(result => isBlockedAddress(result.address))) {
    throw new Error("Blocked crawler destination");
  }
  // Pin this checked address to the actual socket. No second DNS lookup occurs.
  const chosen = addresses[0]!;
  return { url, address: chosen.address, family: chosen.family };
}

export async function assertSafeUrl(input: string, allowPrivateNetworks = false): Promise<URL> {
  return (await resolveSafeDestination(input, allowPrivateNetworks)).url;
}

export function sameAllowedDomain(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return false;
  const hostname = new URL(url).hostname.toLowerCase();
  return allowedDomains.some((domain) => {
    const normalized = domain.toLowerCase().replace(/^\./, "");
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}
