import { describe, it, expect } from "vitest";
import { prepareExportHtml } from "./export-html.js";

// A faithful miniature of a Next static-export index.html: bare <head>, a
// root-absolute favicon, relative asset links, an inline hydration script, and an
// external chunk.
const SAMPLE = [
  "<!DOCTYPE html><html><head>",
  '<meta charSet="utf-8"/>',
  '<link rel="icon" href="/favicon.ico?x" sizes="256x256" type="image/x-icon"/>',
  '<link rel="stylesheet" href="./_next/static/chunks/a.css"/>',
  '<script src="./_next/static/chunks/a.js" async=""></script>',
  "</head><body>",
  '<script>self.__next_f.push([1,"payload"])</script>',
  "</body></html>",
].join("");

const OPTS = { baseHref: "https://x.vscode-webview.net/out/", cspSource: "https://x.vscode-webview.net", nonce: "NCE123" } as const;

describe("prepareExportHtml", () => {
  it("injects <base> immediately after <head>, before any asset", () => {
    const out = prepareExportHtml(SAMPLE, OPTS);
    const base = out.indexOf(`<base href="${OPTS.baseHref}">`);
    expect(base).toBeGreaterThan(-1);
    // The base must precede the first stylesheet/script so they resolve against it.
    expect(base).toBeLessThan(out.indexOf("_next/static/chunks/a.css"));
    expect(base).toBeLessThan(out.indexOf("<script"));
  });

  it("injects a strict, nonce-bearing CSP that needs no eval or inline scripts", () => {
    const out = prepareExportHtml(SAMPLE, OPTS);
    const csp = out.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src ${OPTS.cspSource} 'nonce-${OPTS.nonce}'`);
    expect(csp).toContain(`base-uri ${OPTS.cspSource}`);
    expect(csp).not.toContain("unsafe-eval");
    // styles may be inline (cannot execute); scripts may NOT use unsafe-inline.
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("stamps the nonce on every script — inline hydration AND external chunk", () => {
    const out = prepareExportHtml(SAMPLE, OPTS);
    const scripts = out.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBe(2);
    expect(scripts.every((s) => s.includes(`nonce="${OPTS.nonce}"`))).toBe(true);
  });

  it("drops the root-absolute favicon link (404s under a non-root mount)", () => {
    const out = prepareExportHtml(SAMPLE, OPTS);
    expect(out).not.toContain("favicon.ico");
    expect(out).not.toMatch(/rel="icon"/);
  });

  it("preserves the relative asset URLs so <base> can resolve them", () => {
    const out = prepareExportHtml(SAMPLE, OPTS);
    expect(out).toContain('href="./_next/static/chunks/a.css"');
    expect(out).toContain('src="./_next/static/chunks/a.js"');
  });
});
