import { describe, it, expect, beforeEach, afterEach } from "bun:test";

const { markdownToHtml, escapeHtml, isWriteModeEnabled, renderMemoryBrowser, renderProposals } = await import("../static/app.js");

describe("markdown rendering (marked + DOMPurify)", () => {
  describe("minimal fallback renderer", () => {
    it("renders empty string for falsy input", () => {
      expect(markdownToHtml("")).toBe("");
      expect(markdownToHtml(null)).toBe("");
      expect(markdownToHtml(undefined)).toBe("");
    });

    it("renders a heading", () => {
      const html = markdownToHtml("# Title");
      expect(html).toContain("<h1>");
      expect(html).toContain("Title");
      expect(html).toContain("</h1>");
    });

    it("renders bold and italic", () => {
      const html = markdownToHtml("**bold** and *italic*");
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<em>italic</em>");
    });

    it("renders inline code", () => {
      const html = markdownToHtml("Use `code` here");
      expect(html).toContain("<code>code</code>");
    });

    it("renders fenced code block", () => {
      const html = markdownToHtml("```ts\nconst x = 1;\n```");
      expect(html).toContain("<pre><code");
      expect(html).toContain("const x = 1;");
      expect(html).toContain("</code></pre>");
    });

    it("renders unordered list", () => {
      const html = markdownToHtml("- item1\n- item2");
      expect(html).toContain("<ul>");
      expect(html).toContain("<li>item1</li>");
      expect(html).toContain("<li>item2</li>");
      expect(html).toContain("</ul>");
    });

    it("renders ordered list", () => {
      const html = markdownToHtml("1. first\n2. second");
      expect(html).toContain("<ol>");
      expect(html).toContain("<li>first</li>");
      expect(html).toContain("<li>second</li>");
      expect(html).toContain("</ol>");
    });

    it("escapes raw HTML to prevent XSS (fallback renderer)", () => {
      const html = markdownToHtml("<script>alert('xss')</script>");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("renders a link with safe URL", () => {
      const html = markdownToHtml("[text](https://example.com)");
      expect(html).toContain('<a href="https://example.com"');
      expect(html).toContain("text");
    });
  });

  describe("marked + DOMPurify path (when libraries available)", () => {
    const originalMarked = (globalThis as any).marked;
    const originalDOMPurify = (globalThis as any).DOMPurify;

    afterEach(() => {
      if (originalMarked) (globalThis as any).marked = originalMarked;
      else delete (globalThis as any).marked;
      if (originalDOMPurify) (globalThis as any).DOMPurify = originalDOMPurify;
      else delete (globalThis as any).DOMPurify;
    });

    it("uses marked + DOMPurify when available, sanitizing XSS", () => {
      (globalThis as any).marked = {
        parse: (text: string) => text.replace(/`([^`]+)`/g, "<code>$1</code>"),
      };
      (globalThis as any).DOMPurify = {
        sanitize: (html: string) => html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ""),
      };

      const html = markdownToHtml("Use `code` here");
      expect(html).toContain("<code>code</code>");
    });

    it("DOMPurify strips script tags (F4 XSS mitigation)", () => {
      (globalThis as any).marked = {
        parse: (text: string) => text,
      };
      (globalThis as any).DOMPurify = {
        sanitize: (html: string) => html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ""),
      };

      const html = markdownToHtml("<script>alert('xss')</script>");
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("alert");
    });

    it("renders markdown tables via marked", () => {
      const tableMd = "| Col1 | Col2 |\n|------|------|\n| a | b |";
      (globalThis as any).marked = {
        parse: (text: string) => {
          if (text.includes("|")) return "<table><tr><td>a</td><td>b</td></tr></table>";
          return text;
        },
      };
      (globalThis as any).DOMPurify = {
        sanitize: (html: string) => html,
      };

      const html = markdownToHtml(tableMd);
      expect(html).toContain("<table>");
      expect(html).toContain("<td>a</td>");
    });

    it("falls back to minimal renderer when marked throws", () => {
      (globalThis as any).marked = {
        parse: () => {
          throw new Error("parse error");
        },
      };
      (globalThis as any).DOMPurify = {
        sanitize: (html: string) => html,
      };

      const html = markdownToHtml("# Title");
      expect(html).toContain("<h1>");
    });
  });
});

describe("write mode gating", () => {
  const originalWriteMode = (globalThis as any).MASSA_AI_WEB_WRITE_MODE;

  afterEach(() => {
    if (originalWriteMode !== undefined) {
      (globalThis as any).MASSA_AI_WEB_WRITE_MODE = originalWriteMode;
    } else {
      delete (globalThis as any).MASSA_AI_WEB_WRITE_MODE;
    }
  });

  it("isWriteModeEnabled returns false by default", () => {
    delete (globalThis as any).MASSA_AI_WEB_WRITE_MODE;
    expect(isWriteModeEnabled()).toBe(false);
  });

  it("isWriteModeEnabled returns true when MASSA_AI_WEB_WRITE_MODE=true", () => {
    (globalThis as any).MASSA_AI_WEB_WRITE_MODE = true;
    expect(isWriteModeEnabled()).toBe(true);
  });

  it("renderMemoryBrowser hides edit/delete buttons when write mode off", () => {
    delete (globalThis as any).MASSA_AI_WEB_WRITE_MODE;
    const data = { data: { memories: [{ id: "mem-1", type: "code", level: 1, importance: 0.8, content: "test" }], total: 1, limit: 50, offset: 0 } };
    const html = renderMemoryBrowser(data, { filters: {} });
    expect(html).not.toContain('data-action="memory-edit"');
    expect(html).not.toContain('data-action="memory-delete"');
    expect(html).not.toContain("actions");
  });

  it("renderMemoryBrowser shows edit/delete buttons when write mode on", () => {
    (globalThis as any).MASSA_AI_WEB_WRITE_MODE = true;
    const data = { data: { memories: [{ id: "mem-1", type: "code", level: 1, importance: 0.8, content: "test" }], total: 1, limit: 50, offset: 0 } };
    const html = renderMemoryBrowser(data, { filters: {} });
    expect(html).toContain('data-action="memory-edit"');
    expect(html).toContain('data-action="memory-delete"');
    expect(html).toContain('data-id="mem-1"');
  });

  it("renderProposals shows approve/reject buttons when write mode on", () => {
    (globalThis as any).MASSA_AI_WEB_WRITE_MODE = true;
    const data = { data: { proposals: [{ id: "prop-1", type: "edit", status: "pending", description: "test proposal" }] } };
    const html = renderProposals(data, { project: "test-project" });
    expect(html).toContain('data-action="proposal-approve"');
    expect(html).toContain('data-action="proposal-reject"');
    expect(html).toContain('data-id="prop-1"');
  });

  it("renderProposals hides approve/reject buttons when write mode off", () => {
    delete (globalThis as any).MASSA_AI_WEB_WRITE_MODE;
    const data = { data: { proposals: [{ id: "prop-1", type: "edit", status: "pending", description: "test proposal" }] } };
    const html = renderProposals(data, { project: "test-project" });
    expect(html).not.toContain('data-action="proposal-approve"');
    expect(html).not.toContain('data-action="proposal-reject"');
  });
});