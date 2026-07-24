/**
 * Phase 8 — markdown renderer + dark-mode tests (R8-RENDER-01).
 *
 * Asserts markdownToHtml handles the supported subset (headings, bold, italic,
 * inline code, fenced code, lists, links, paragraphs) and HTML-escapes raw
 * input (no injected live tags). Asserts toggleTheme/initTheme flip the
 * data-theme attribute + persist to a fake localStorage.
 */

import { describe, test, expect } from "bun:test";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ui = require("../../../web-ui/src/static/app.js") as {
  markdownToHtml: (md: string) => string;
  toggleTheme: (doc?: unknown, store?: unknown) => string;
  initTheme: (doc?: unknown, store?: unknown) => string;
};

describe("web-ui markdown renderer (R8-RENDER-01)", () => {
  test("headings render as h1..h6", () => {
    expect(ui.markdownToHtml("# Title")).toContain("<h1>Title</h1>");
    expect(ui.markdownToHtml("### Sub")).toContain("<h3>Sub</h3>");
    expect(ui.markdownToHtml("###### Deep")).toContain("<h6>Deep</h6>");
  });

  test("bold + italic + inline code", () => {
    const html = ui.markdownToHtml("This is **bold** and *italic* and `code`.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
  });

  test("unordered list", () => {
    const html = ui.markdownToHtml("- one\n- two\n- three");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>three</li>");
    expect(html).toContain("</ul>");
  });

  test("ordered list", () => {
    const html = ui.markdownToHtml("1. first\n2. second");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
  });

  test("fenced code block becomes pre>code", () => {
    const html = ui.markdownToHtml("```ts\nconst x = 1;\n```");
    expect(html).toContain("<pre><code");
    expect(html).toContain('language-ts');
    expect(html).toContain("const x = 1;");
    expect(html).toContain("</code></pre>");
  });

  test("safe link with allowed scheme", () => {
    const html = ui.markdownToHtml("[docs](https://example.com/x)");
    expect(html).toContain('<a href="https://example.com/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("paragraphs separated by blank line", () => {
    const html = ui.markdownToHtml("para one\n\npara two");
    expect(html).toContain("<p>para one</p>");
    expect(html).toContain("<p>para two</p>");
  });

  test("HTML-escape: raw <script> does not survive as a live tag", () => {
    const html = ui.markdownToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("HTML-escape: ampersand escaped", () => {
    const html = ui.markdownToHtml("a & b < c > d");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
  });

  test("empty/falsy input returns empty string", () => {
    expect(ui.markdownToHtml("")).toBe("");
    expect(ui.markdownToHtml(null as unknown as string)).toBe("");
  });
});

describe("web-ui dark mode (R8-RENDER-01)", () => {
  function fakeDoc(theme: string | null) {
    const attrs: Record<string, string> = {};
    if (theme !== null) attrs["data-theme"] = theme;
    return {
      documentElement: {
        getAttribute: (k: string) => attrs[k] ?? null,
        setAttribute: (k: string, v: string) => {
          attrs[k] = v;
        },
      },
    };
  }
  function fakeStore(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
      raw: data,
    };
  }

  test("toggleTheme flips light→dark and persists", () => {
    const doc = fakeDoc("light");
    const store = fakeStore();
    const next = ui.toggleTheme(doc, store);
    expect(next).toBe("dark");
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(store.raw["massa-ai-ui-theme"]).toBe("dark");
  });

  test("toggleTheme flips dark→light", () => {
    const doc = fakeDoc("dark");
    const store = fakeStore();
    const next = ui.toggleTheme(doc, store);
    expect(next).toBe("light");
    expect(doc.documentElement.getAttribute("data-theme")).toBe("light");
  });

  test("initTheme applies persisted dark from store", () => {
    const doc = fakeDoc(null);
    const store = fakeStore({ "massa-ai-ui-theme": "dark" });
    const theme = ui.initTheme(doc, store);
    expect(theme).toBe("dark");
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("initTheme defaults to light when store empty", () => {
    const doc = fakeDoc(null);
    const store = fakeStore();
    const theme = ui.initTheme(doc, store);
    expect(theme).toBe("light");
    expect(doc.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
