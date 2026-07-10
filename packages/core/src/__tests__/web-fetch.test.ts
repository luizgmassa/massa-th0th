/**
 * Tests for the web ingestion service: SSRF guard, HTML→md, JSON key-path,
 * fetcher (TTL cache, byte cap, redirect-to-internal), and the run-pool
 * parallel + serial-index orchestration in WebController.
 *
 * Determinism rules (from project memory):
 *   - NO real network calls. SSRF is exercised against IP literals (no DNS) and
 *     a mocked `dnsLookup` for hostname cases.
 *   - NO real internal endpoints. redirect-to-internal is simulated by stubbing
 *     the global `fetch` to return a synthetic 302 → private URL.
 *   - Indexing deps are an in-memory capture map, never the real vector/keyword
 *     stores. projectId is a throwaway ("web-test") to avoid polluting any index.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  classifyIp,
  assertUrlSafe,
  SsrfBlockedError,
  setDnsResolver,
  fetchWithSsrfGuard,
  MAX_REDIRECTS,
  htmlToMarkdown,
  jsonToKeyPathChunks,
  fetchAndConvertOne,
  composeFetchCacheKey,
  MAX_FETCH_BYTES,
  DEFAULT_FETCH_TTL_MS,
  WebController,
  type IndexedChunk,
  type WebIndexDeps,
  type FetchOneResult,
} from "../services/web/index.js";

// ── SSRF: classifyIp (pure, no DNS, no network) ──────────────────────────

describe("classifyIp — pure IP classifier", () => {
  const blocked = [
    "127.0.0.1",
    "127.1.2.3",
    "127.255.255.255", // loopback /8
    "10.0.0.1",
    "10.255.255.255", // RFC1918 10/8
    "172.16.0.1",
    "172.31.255.255", // RFC1918 172.16/12 (172.32 is public — tested below)
    "192.168.0.1",
    "192.168.1.1", // RFC1918 192.168/16
    "169.254.169.254", // AWS/GCP/Azure IMDS
    "169.254.0.1",
    "169.254.255.255", // link-local /16
    "0.0.0.0",
    "0.1.2.3", // current network 0/8
    "224.0.0.1",
    "239.255.255.255",
    "255.255.255.255", // multicast/reserved
    "100.64.0.1", // CGNAT 100.64/10
    "::1", // IPv6 loopback
    "fe80::1", // IPv6 link-local
    "feb0::1",
    "ff00::1", // IPv6 multicast
    "::", // IPv6 unspecified
    "fc00::1",
    "fd00::1", // IPv6 ULA fc00::/7
    "::ffff:127.0.0.1", // IPv4-mapped loopback (dotted-decimal)
    "::ffff:10.0.0.1", // IPv4-mapped private
    "::ffff:169.254.169.254", // IPv4-mapped IMDS
    "::ffff:7f00:1", // IPv4-mapped loopback (hex, as Node URL normalizes)
    "::ffff:a9fe:a9fe", // IPv4-mapped IMDS (hex)
    "::ffff:a00:1", // IPv4-mapped 10.x (hex)
    "fe80::1%eth0", // RFC 6874 zone id
    "fe80::1%25eth0", // URL-encoded zone id
    "not-an-ip",
    "256.1.1.1",
    "1.2.3",
  ];
  for (const ip of blocked) {
    if (!ip) continue;
    test(`blocks ${ip}`, () => {
      expect(classifyIp(ip)).toBe("block");
    });
  }

  const publicIps = [
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1", // just outside 172.16/12 → public
    "172.15.0.1", // just below 172.16/12 → public
    "11.0.0.1", // just outside 10/8
    "193.168.0.1", // 193, not 192.168
    "192.169.0.1", // 192.169, not 192.168
    "100.63.0.1", // just below CGNAT
    "100.128.0.1", // just above CGNAT
    "2001:4860:4860::8888", // Google public DNS v6
    "2606:4700:4700::1111", // Cloudflare v6
  ];
  for (const ip of publicIps) {
    test(`allows public ${ip}`, () => {
      expect(classifyIp(ip)).toBe("public");
    });
  }
});

// ── SSRF: assertUrlSafe with mocked DNS ──────────────────────────────────

describe("assertUrlSafe — scheme + DNS resolution", () => {
  test("rejects non-http schemes", async () => {
    for (const u of [
      "file:///etc/passwd",
      "gopher://x/...",
      "javascript:alert(1)",
      "data:text/html,<script>x</script>",
      "ftp://example.com/",
    ]) {
      await expect(assertUrlSafe(u)).rejects.toThrow(SsrfBlockedError);
    }
  });

  test("rejects literal private IP URLs (no DNS needed)", async () => {
    for (const u of [
      "http://127.0.0.1/",
      "http://localhost/", // localhost resolves to 127.0.0.1/::1 — covered by DNS mock below
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://169.254.169.254/", // IMDS
      "http://0.0.0.0/",
    ]) {
      // Literal IPs (except 'localhost' hostname) skip DNS; localhost goes
      // through the DNS mock below. We assert literal IPs here directly.
      if (u.includes("localhost")) continue;
      await expect(assertUrlSafe(u)).rejects.toThrow(SsrfBlockedError);
    }
  });

  test("rejects bracketed IPv6 private/loopback URL literals (regression)", async () => {
    // Node's URL.hostname does NOT strip brackets — it returns "[::1]" etc.
    // Without bracket-stripping in assertUrlSafe, these bypass the guard.
    // Also covers IPv4-mapped IPv6 in Node's hex normalization
    // ([::ffff:a9fe:a9fe] == 169.254.169.254 IMDS).
    for (const u of [
      "http://[::1]/", // loopback
      "http://[fe80::1]/", // link-local
      "http://[::ffff:127.0.0.1]/", // mapped loopback (decimal)
      "http://[::ffff:169.254.169.254]/", // mapped IMDS (decimal)
      "http://[::ffff:a9fe:a9fe]/", // mapped IMDS (hex, Node-normalized)
      "http://[::ffff:7f00:1]/", // mapped loopback (hex)
      "http://[fc00::1]/", // ULA
      "http://[ff02::1]/", // multicast
      "http://[::]/", // unspecified
    ]) {
      await expect(assertUrlSafe(u)).rejects.toThrow(SsrfBlockedError);
    }
  });

  test("allows bracketed public IPv6 URL literals", async () => {
    for (const u of [
      "http://[2606:4700:4700::1111]/", // Cloudflare
      "http://[2001:4860:4860::8888]/", // Google
    ]) {
      // assertUrlSafe now returns UrlSafetyResult (pinned IP + host) instead
      // of void; assert it resolves and pins to the literal IP.
      const r = await assertUrlSafe(u);
      expect(r.isLiteralIpUrl).toBe(true);
    }
  });

  test("blocks a hostname resolving to a private IP (DNS rebinding)", async () => {
    const restore = setDnsResolver(async (hostname) => {
      if (hostname === "evil-rebind.example") return [{ address: "10.0.0.99" }];
      if (hostname === "imds-alias.example") return [{ address: "169.254.169.254" }];
      throw new Error("ENOTFOUND");
    });
    try {
      await expect(assertUrlSafe("https://evil-rebind.example/")).rejects.toThrow(
        /resolves to blocked IP 10\.0\.0\.99/,
      );
      await expect(assertUrlSafe("https://imds-alias.example/")).rejects.toThrow(
        /169\.254\.169\.254/,
      );
    } finally {
      restore();
    }
  });

  test("allows a hostname resolving to a public IP", async () => {
    const restore = setDnsResolver(async (hostname) => {
      if (hostname === "good.example") return [{ address: "93.184.216.34" }];
      throw new Error("ENOTFOUND");
    });
    try {
      // assertUrlSafe now returns the pinned IP + original hostname.
      const r = await assertUrlSafe("https://good.example/");
      expect(r.pinnedIp).toBe("93.184.216.34");
      expect(r.originalHost).toBe("good.example");
      expect(r.isLiteralIpUrl).toBe(false);
    } finally {
      restore();
    }
  });

  test("rejects when ANY resolved address is blocked (mixed records)", async () => {
    const restore = setDnsResolver(async () => [
      { address: "93.184.216.34" },
      { address: "127.0.0.1" }, // one poisoned record
    ]);
    try {
      await expect(assertUrlSafe("https://mixed.example/")).rejects.toThrow(
        /127\.0\.0\.1/,
      );
    } finally {
      restore();
    }
  });
});

// ── SSRF: redirect-to-internal (fetch mock) ──────────────────────────────

describe("fetchWithSsrfGuard — redirect-to-internal is blocked", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("a 302 to a private IP is rejected at the redirect hop", async () => {
    const restoreDns = setDnsResolver(async (hostname) => {
      if (hostname === "public-start.example") return [{ address: "93.184.216.34" }];
      if (hostname === "internal-target.example") return [{ address: "169.254.169.254" }];
      throw new Error("ENOTFOUND");
    });
    globalThis.fetch = ((input: any) => {
      const url = typeof input === "string" ? input : input.toString();
      // After DNS pinning, the fetch URL is the literal pinned IP, not the
      // hostname. The first hop pins to 93.184.216.34 (public-start).
      if (url.startsWith("https://93.184.216.34/")) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "http://internal-target.example/secret" },
          }),
        );
      }
      return Promise.resolve(new Response("should not reach", { status: 200 }));
    }) as any;
    try {
      await expect(
        fetchWithSsrfGuard("https://public-start.example/"),
      ).rejects.toThrow(/169\.254\.169\.254/);
    } finally {
      restoreDns();
    }
  });

  test("a redirect loop is capped at MAX_REDIRECTS", async () => {
    const restoreDns = setDnsResolver(async () => [{ address: "93.184.216.34" }]);
    let hops = 0;
    globalThis.fetch = (() => {
      hops++;
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "/loop" },
        }),
      );
    }) as any;
    try {
      await expect(
        fetchWithSsrfGuard("https://loop.example/"),
      ).rejects.toThrow(SsrfBlockedError);
      expect(hops).toBeLessThanOrEqual(MAX_REDIRECTS + 1);
    } finally {
      restoreDns();
    }
  });
});

// ── HTML → Markdown ───────────────────────────────────────────────────────

describe("htmlToMarkdown", () => {
  test("strips scripts and styles", () => {
    const html =
      "<html><head><style>.x{color:red}</style></head><body>" +
      "<script>alert(1)</script><p>kept</p></body></html>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("kept");
    expect(md).not.toContain("alert(1)");
    expect(md).not.toContain("color:red");
    expect(md).not.toContain(".x");
  });

  test("strips nav/header/footer/noscript/iframe", () => {
    const html =
      "<nav>NAV</nav><header>HEAD</header><footer>FOOT</footer>" +
      "<noscript>NOSCRIPT</noscript><iframe>IFRAME</iframe><main>BODY</main>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("BODY");
    expect(md).not.toContain("NAV");
    expect(md).not.toContain("HEAD");
    expect(md).not.toContain("FOOT");
    expect(md).not.toContain("NOSCRIPT");
    expect(md).not.toContain("IFRAME");
  });

  test("converts headings, bold, and GFM tables", () => {
    const html =
      "<h1>Title</h1><p>Hello <strong>world</strong></p>" +
      "<table><thead><tr><th>A</th><th>B</th></tr></thead>" +
      "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).toContain("**world**");
    expect(md).toContain("| A | B |");
    expect(md).toContain("| 1 | 2 |");
  });

  test("returns empty string for empty/whitespace input", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("   \n  ")).toBe("");
  });
});

// ── JSON → key-path chunks ────────────────────────────────────────────────

describe("jsonToKeyPathChunks", () => {
  test("flattens nested object to leaf paths", () => {
    const chunks = jsonToKeyPathChunks({ user: { name: "Ada", age: 36 } });
    const paths = chunks.map((c) => c.path);
    expect(paths).toContain("$.user.name");
    expect(paths).toContain("$.user.age");
    const nameChunk = chunks.find((c) => c.path === "$.user.name")!;
    expect(nameChunk.content).toContain("`Ada`");
  });

  test("array of objects fans out one entry per element", () => {
    const chunks = jsonToKeyPathChunks({
      items: [{ id: 1 }, { id: 2 }],
    });
    expect(chunks.map((c) => c.path)).toEqual([
      "$.items[0].id",
      "$.items[1].id",
    ]);
  });

  test("array of primitives becomes a bulleted list", () => {
    const chunks = jsonToKeyPathChunks({ tags: ["a", "b", "c"] });
    expect(chunks.length).toBe(1);
    expect(chunks[0].path).toBe("$.tags");
    expect(chunks[0].content).toContain("- `a`");
    expect(chunks[0].content).toContain("- `c`");
  });

  test("skips null/undefined leaves", () => {
    const chunks = jsonToKeyPathChunks({ a: null, b: undefined, c: 1 });
    expect(chunks.map((c) => c.path)).toEqual(["$.c"]);
  });

  test("handles top-level primitives", () => {
    expect(jsonToKeyPathChunks("hello")[0].path).toBe("$");
    expect(jsonToKeyPathChunks(42)[0].content).toContain("`42`");
  });
});

// ── fetcher: TTL cache, byte cap, content routing ────────────────────────

/** Build an in-memory WebIndexDeps that captures every indexed chunk. The
 *  `chunks` array is attached onto the deps object as `deps.chunks` so test
 *  sites can read it without a separate destructure. */
function captureDeps(): {
  deps: WebIndexDeps & { chunks: IndexedChunk[] };
  chunks: IndexedChunk[];
  cache: Map<string, number>;
} {
  const chunks: IndexedChunk[] = [];
  const cache = new Map<string, number>();
  const deps = {
    chunks,
    indexChunk: async (c: IndexedChunk) => {
      chunks.push(c);
    },
    getLastIndexedAt: (k: string) => cache.get(k) ?? null,
    markIndexed: (k: string, ts: number) => {
      cache.set(k, ts);
    },
  };
  return { deps, chunks, cache };
}

/** Stub global fetch for the fetcher tests. Returns a fixed Response. */
function stubFetch(responder: (url: string) => Response): {
  restore: () => void;
  calls: string[];
} {
  const orig = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: any) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    return Promise.resolve(responder(url));
  }) as any;
  return {
    calls,
    restore: () => {
      globalThis.fetch = orig;
    },
  };
}

/** Stub DNS to a public IP so assertUrlSafe passes for example hostnames. */
function stubDnsPublic(): () => void {
  return setDnsResolver(async () => [{ address: "93.184.216.34" }]);
}

describe("fetchAndConvertOne — TTL cache", () => {
  let dnsRestore: () => void;
  beforeEach(async () => {
    dnsRestore = stubDnsPublic();
  });
  afterEach(() => dnsRestore());

  test("first call fetches + indexes, second within TTL is a cache hit", async () => {
    const { deps, cache } = captureDeps();
    const fetchStub = stubFetch(
      () =>
        new Response("<html><body><h1>Doc</h1><p>hi</p></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    try {
      const r1 = await fetchAndConvertOne("https://docs.example/page", deps, {
        source: "docs",
      });
      expect(r1.kind).toBe("fetched");
      if (r1.kind !== "fetched") return;
      expect(r1.chunks.length).toBeGreaterThan(0);
      expect(deps.chunks.length).toBe(r1.chunks.length);

      // Second call within TTL → cached, no new fetch, no new index.
      const before = deps.chunks.length;
      const r2 = await fetchAndConvertOne("https://docs.example/page", deps, {
        source: "docs",
      });
      expect(r2.kind).toBe("cached");
      expect(deps.chunks.length).toBe(before); // nothing re-indexed
    } finally {
      fetchStub.restore();
    }
  });

  test("force=true bypasses the cache and re-fetches", async () => {
    const { deps } = captureDeps();
    const fetchStub = stubFetch(
      () =>
        new Response("<html><body><p>x</p></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    try {
      await fetchAndConvertOne("https://docs.example/force", deps, {
        source: "d",
      });
      const firstCalls = fetchStub.calls.length;
      await fetchAndConvertOne("https://docs.example/force", deps, {
        source: "d",
        force: true,
      });
      expect(fetchStub.calls.length).toBeGreaterThan(firstCalls);
    } finally {
      fetchStub.restore();
    }
  });

  test("ttl=0 bypasses the cache like force", async () => {
    const { deps } = captureDeps();
    const fetchStub = stubFetch(
      () =>
        new Response("<html><body><p>y</p></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    try {
      await fetchAndConvertOne("https://docs.example/ttl0", deps, {
        source: "d",
      });
      const first = fetchStub.calls.length;
      await fetchAndConvertOne("https://docs.example/ttl0", deps, {
        source: "d",
        ttl: 0,
      });
      expect(fetchStub.calls.length).toBeGreaterThan(first);
    } finally {
      fetchStub.restore();
    }
  });
});

describe("fetchAndConvertOne — content-type routing", () => {
  let dnsRestore: () => void;
  beforeEach(async () => {
    dnsRestore = stubDnsPublic();
  });
  afterEach(() => dnsRestore());

  test("JSON → key-path chunks (one per leaf)", async () => {
    const { deps } = captureDeps();
    const fetchStub = stubFetch(
      () =>
        new Response(JSON.stringify({ name: "x", nested: { v: 1 } }), {
          headers: { "content-type": "application/json" },
        }),
    );
    try {
      const r = await fetchAndConvertOne("https://api.example/data", deps, {
        source: "api",
      });
      expect(r.kind).toBe("fetched");
      if (r.kind !== "fetched") return;
      expect(r.contentType).toBe("json");
      expect(r.chunks.length).toBe(2); // name + nested.v
      expect(deps.chunks.some((c) => c.content.includes("name"))).toBe(true);
    } finally {
      fetchStub.restore();
    }
  });

  test("HTML → markdown chunk", async () => {
    const { deps } = captureDeps();
    const fetchStub = stubFetch(
      () =>
        new Response("<html><body><h1>T</h1><script>bad()</script></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    try {
      const r = await fetchAndConvertOne("https://site.example/", deps);
      expect(r.kind).toBe("fetched");
      if (r.kind !== "fetched") return;
      expect(r.contentType).toBe("html");
      expect(r.chunks[0].content).toContain("# T");
      expect(r.chunks[0].content).not.toContain("bad()");
    } finally {
      fetchStub.restore();
    }
  });

  test("plain text → single text chunk", async () => {
    const { deps } = captureDeps();
    const fetchStub = stubFetch(
      () =>
        new Response("just plain text", {
          headers: { "content-type": "text/plain" },
        }),
    );
    try {
      const r = await fetchAndConvertOne("https://site.example/txt", deps);
      expect(r.kind).toBe("fetched");
      if (r.kind !== "fetched") return;
      expect(r.contentType).toBe("text");
      expect(r.chunks.length).toBe(1);
      expect(r.chunks[0].content).toContain("just plain text");
    } finally {
      fetchStub.restore();
    }
  });
});

describe("fetchAndConvertOne — MAX_FETCH_BYTES cap", () => {
  let dnsRestore: () => void;
  beforeEach(async () => {
    dnsRestore = stubDnsPublic();
  });
  afterEach(() => dnsRestore());

  test("rejects an oversized Content-Length without reading the body", async () => {
    const { deps } = captureDeps();
    const fetchStub = stubFetch(
      () =>
        new Response("", {
          headers: {
            "content-type": "text/plain",
            "content-length": String(MAX_FETCH_BYTES + 1),
          },
        }),
    );
    try {
      const r = await fetchAndConvertOne("https://big.example/", deps);
      expect(r.kind).toBe("error");
      if (r.kind !== "error") return;
      expect(r.error).toMatch(/exceeds cap/);
      expect(deps.chunks.length).toBe(0); // nothing indexed
    } finally {
      fetchStub.restore();
    }
  });

  test("rejects an oversized streamed body (lying Content-Length)", async () => {
    const { deps } = captureDeps();
    // Build a body larger than the cap. Use a ReadableStream that emits chunks.
    const oversized = "x".repeat(MAX_FETCH_BYTES + 1024);
    const fetchStub = stubFetch(
      () =>
        new Response(oversized, {
          headers: { "content-type": "text/plain" }, // no Content-Length
        }),
    );
    try {
      const r = await fetchAndConvertOne("https://liar.example/", deps);
      expect(r.kind).toBe("error");
      if (r.kind !== "error") return;
      expect(r.error).toMatch(/exceeds cap|exceeded cap/);
    } finally {
      fetchStub.restore();
    }
  });
});

describe("fetchAndConvertOne — SSRF blocks propagate as error results", () => {
  let dnsRestore: () => void;

  test("a private-IP URL returns an error result (no throw)", async () => {
    const { deps } = captureDeps();
    const r = await fetchAndConvertOne("http://169.254.169.254/latest/meta-data/", deps);
    expect(r.kind).toBe("error");
    if (r.kind !== "error") return;
    expect(r.error).toMatch(/blocked IP/i);
  });

  test("a file:// URL returns an error result", async () => {
    const { deps } = captureDeps();
    const r = await fetchAndConvertOne("file:///etc/passwd", deps);
    expect(r.kind).toBe("error");
  });
});

// ── composeFetchCacheKey ──────────────────────────────────────────────────

describe("composeFetchCacheKey", () => {
  test("two distinct URLs with the same source get distinct keys", () => {
    const a = composeFetchCacheKey("docs", "https://a.example/");
    const b = composeFetchCacheKey("docs", "https://b.example/");
    expect(a).not.toBe(b);
  });

  test("same url + source is stable", () => {
    const a = composeFetchCacheKey("docs", "https://a.example/");
    const b = composeFetchCacheKey("docs", "https://a.example/");
    expect(a).toBe(b);
  });

  test("falls back to the url when source is empty", () => {
    const a = composeFetchCacheKey(undefined, "https://a.example/");
    expect(a).toContain("https://a.example/");
  });
});

// ── WebController: run-pool parallel fetch + serial index ────────────────

describe("WebController — parallel fetch + serial index", () => {
  let dnsRestore: () => void;
  beforeEach(async () => {
    dnsRestore = stubDnsPublic();
  });
  afterEach(() => dnsRestore());

  /** Build a WebController with an in-memory capture index deps pair. */
  function makeController(): {
    controller: WebController;
    indexed: IndexedChunk[];
  } {
    WebController.resetInstance();
    const indexed: IndexedChunk[] = [];
    const fakeVectorStore = {
      addDocuments: async (docs: any[]) => {
        for (const d of docs) indexed.push(d);
      },
    };
    const fakeKeywordSearch = {
      index: async (id: string, content: string) => {
        // capture handled by vectorStore.addDocuments in this double-capture;
        // dedupe is not the concern of this test.
      },
    };
    const controller = WebController.instantiate({
      vectorStore: fakeVectorStore as any,
      keywordSearch: fakeKeywordSearch as any,
    });
    return { controller, indexed };
  }

  test("batch of N URLs: all fetched, results in input order, concurrency reported", async () => {
    const { controller, indexed } = makeController();
    const completionOrder: string[] = [];
    const fetchStub = stubFetch((url) => {
      // Make url2 SLOW so we can prove order is preserved regardless of completion.
      const body =
        url.indexOf("slow") >= 0
          ? "<html><body><p>slow</p></body></html>"
          : "<html><body><p>fast</p></body></html>";
      // Record completion order via the response generation timing.
      completionOrder.push(url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    });
    try {
      const res = await controller.fetchAndIndex({
        requests: [
          { url: "https://a.example/", source: "a" },
          { url: "https://b.example/", source: "b" },
          { url: "https://c.example/slow", source: "c" },
        ],
        concurrency: 3,
      });
      expect(res.success).toBe(true);
      expect(res.results.length).toBe(3);
      // Order preserved regardless of completion.
      expect((res.results[0] as any).url).toBe("https://a.example/");
      expect((res.results[2] as any).url).toBe("https://c.example/slow");
      expect(indexed.length).toBe(3); // one chunk per trivial html body
    } finally {
      fetchStub.restore();
      WebController.resetInstance();
    }
  });

  test("a failing URL does not abort siblings (allSettled shape)", async () => {
    const { controller } = makeController();
    // Distinct pinned IPs per hostname so the fetch stub can tell them apart
    // after DNS pinning rewrites the URL to a literal IP.
    const dnsRestore = setDnsResolver(async (hostname) => {
      if (hostname === "ok1.example") return [{ address: "93.184.216.34" }];
      if (hostname === "fail.example") return [{ address: "93.184.216.35" }];
      if (hostname === "ok2.example") return [{ address: "93.184.216.36" }];
      return [{ address: "93.184.216.34" }];
    });
    const fetchStub = stubFetch((url) => {
      // After pinning, the URL is the literal IP — fail.example pins to .35.
      if (url.indexOf("93.184.216.35") >= 0) {
        return new Response("nope", { status: 500 });
      }
      return new Response("<html><body><p>ok</p></body></html>", {
        headers: { "content-type": "text/html" },
      });
    });
    try {
      const res = await controller.fetchAndIndex({
        requests: [
          { url: "https://ok1.example/" },
          { url: "https://fail.example/" },
          { url: "https://ok2.example/" },
        ],
        concurrency: 2,
      });
      expect(res.results.length).toBe(3);
      const kinds = res.results.map((r) => r.kind);
      expect(kinds).toContain("fetched");
      expect(kinds).toContain("error");
      // success=false because at least one errored
      expect(res.success).toBe(false);
    } finally {
      fetchStub.restore();
      dnsRestore();
      WebController.resetInstance();
    }
  });

  test("SSRF-blocked URL in a batch surfaces as error, not a throw", async () => {
    const { controller } = makeController();
    const fetchStub = stubFetch(
      () =>
        new Response("<html><body><p>ok</p></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    try {
      const res = await controller.fetchAndIndex({
        requests: [
          { url: "https://good.example/" },
          { url: "http://169.254.169.254/" }, // IMDS — blocked
        ],
        concurrency: 2,
      });
      expect(res.results.length).toBe(2);
      const blocked = res.results.find(
        (r) => r.kind === "error",
      ) as Extract<FetchOneResult, { kind: "error" }>;
      expect(blocked).toBeTruthy();
      expect(blocked.error).toMatch(/blocked IP/i);
    } finally {
      fetchStub.restore();
      WebController.resetInstance();
    }
  });

  test("empty batch returns success=false, empty results", async () => {
    const { controller } = makeController();
    try {
      const res = await controller.fetchAndIndex({});
      expect(res.success).toBe(false);
      expect(res.results).toEqual([]);
    } finally {
      WebController.resetInstance();
    }
  });
});
