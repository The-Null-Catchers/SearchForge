import { describe, expect, it } from "vitest";
import { isBlockedAddress, normalizeUrl, sameAllowedDomain } from "./url.js";

describe("crawler URL safety", () => {
  it("normalizes fragments, ports and query ordering", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/a//b?z=2&a=1#section"))
      .toBe("https://example.com/a/b?a=1&z=2");
  });

  it("rejects private and metadata-style network ranges", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.0.0.4")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
  });

  it("restricts crawl domains including subdomains", () => {
    expect(sameAllowedDomain("https://docs.example.com/x", ["example.com"])).toBe(true);
    expect(sameAllowedDomain("https://evil-example.com/x", ["example.com"])).toBe(false);
  });
});
