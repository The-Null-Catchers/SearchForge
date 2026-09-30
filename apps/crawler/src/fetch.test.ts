import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { safeFetch } from "./fetch.js";
import { parseSitemap } from "./sitemap.js";

const options = { userAgent: "SearchForgeBot/1.0", timeoutMs: 2000, maxBytes: 128, allowPrivateNetworks: true };

describe("safe crawler transport", () => {
  it("blocks private literal IPs unless trusted mode is explicit", async () => {
    await expect(safeFetch("http://127.0.0.1/", { ...options, allowPrivateNetworks: false })).rejects.toThrow("Blocked crawler destination");
    await expect(safeFetch("http://[::1]/", { ...options, allowPrivateNetworks: false })).rejects.toThrow("Blocked crawler destination");
  });
  it("streams with size limits, propagates validators and validates every redirect", async () => {
    const server = createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { location: '/blocked' }); res.end(); }
      else if (req.url === '/large') { res.end('x'.repeat(256)); }
      else if (req.headers['if-none-match'] === '"version-1"') { res.writeHead(304); res.end(); }
      else { res.setHeader('etag', '"version-1"'); res.end('document'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const first = await safeFetch(base, options);
      expect(new TextDecoder().decode(first.body)).toBe('document');
      const unchanged = await safeFetch(base, { ...options, headers: { 'if-none-match': first.headers.get('etag')! } });
      expect(unchanged.status).toBe(304);
      await expect(safeFetch(`${base}/large`, options)).rejects.toThrow('maximum allowed size');
      const visited: string[] = [];
      await expect(safeFetch(`${base}/redirect`, { ...options, validateUrl: url => {
        visited.push(url.pathname);
        if (url.pathname === '/blocked') throw new Error('Redirect not permitted');
      } })).rejects.toThrow('Redirect not permitted');
      expect(visited).toEqual(['/redirect', '/blocked']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

describe("sitemap safety", () => {
  it("parses gzip URL metadata and nested references", () => {
    const xml = '<urlset><url><loc>https://example.com/docs</loc><lastmod>2026-09-30</lastmod><priority>0.8</priority></url></urlset>';
    expect(parseSitemap(gzipSync(xml), true).urls[0]).toEqual({ url: 'https://example.com/docs', lastmod: '2026-09-30', priority: 0.8 });
    expect(parseSitemap(Buffer.from('<sitemapindex><sitemap><loc>https://example.com/nested.xml</loc></sitemap></sitemapindex>')).nested).toEqual(['https://example.com/nested.xml']);
  });
  it("rejects entity declarations and compressed expansion bombs", () => {
    expect(() => parseSitemap(Buffer.from('<!DOCTYPE x [<!ENTITY e "secret">]><urlset/>'))).toThrow('entities');
    expect(() => parseSitemap(gzipSync('x'.repeat(11 * 1024 * 1024)), true)).toThrow();
  });
});
