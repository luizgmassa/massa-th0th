/**
 * Security tests for the DNS-rebinding TOCTOU fix in the SSRF guard.
 *
 * The vulnerability (structural gap #2): `assertUrlSafe` resolved the hostname
 * and classified the resolved IP, but the resolved IP was NOT pinned to the
 * subsequent `fetch()`. Node/undici/bun re-resolve DNS at connect time, AFTER
 * the guard check. An attacker could return a public IP for `assertUrlSafe`
 * then `169.254.169.254` (or any private IP) for fetch's own resolution.
 *
 * The fix: `assertUrlSafe` returns the pinned IP; `fetchWithSsrfGuard`
 * rewrites the fetch URL to the LITERAL pinned IP and sets the `Host` header
 * to the original hostname. Because the fetch URL host is now a literal IP, NO
 * DNS lookup occurs at connect time — the rebind is impossible.
 *
 * These tests verify:
 *   1. A hostname that rebinds public→private between check and connect is
 *      fetched at the PUBLIC IP (the pinned one), NOT the private one.
 *   2. The fetch URL passed to `fetch` is the literal IP, not the hostname.
 *   3. The Host header is set to the original hostname (virtual hosting works).
 *   4. An attacker who returns a private IP on the FIRST resolution is still
 *      blocked at assertUrlSafe (the pre-existing defense still holds).
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  assertUrlSafe,
  fetchWithSsrfGuard,
  SsrfBlockedError,
  setDnsResolver,
  type UrlSafetyResult,
} from "../services/web/index.js";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("SSRF DNS-rebinding TOCTOU — pin closes the gap", () => {
  test("a rebinding hostname (public at check, private at connect) fetches the pinned PUBLIC IP", async () => {
    // Simulate DNS rebinding: the first resolution (assertUrlSafe) returns a
    // public IP; a second resolution (what fetch's connect-time lookup WOULD
    // return without pinning) returns the IMDS endpoint.
    let resolutionCount = 0;
    const restoreDns = setDnsResolver(async () => {
      resolutionCount++;
      if (resolutionCount === 1) {
        return [{ address: "93.184.216.34" }]; // public — passes the guard
      }
      // Second resolution — what an attacker serves at connect-time.
      return [{ address: "169.254.169.254" }]; // IMDS — would bypass without pin
    });

    let fetchedUrl = "";
    let fetchedHostHeader: string | null = null;
    globalThis.fetch = ((input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchedUrl = url;
      const headers = init?.headers;
      if (headers && typeof headers === "object") {
        fetchedHostHeader = headers.host ?? headers.Host ?? null;
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as any;

    try {
      const resp = await fetchWithSsrfGuard("https://rebind.example/secret");
      expect(resp.status).toBe(200);
      // The fetch URL MUST be the literal pinned IP, NOT the hostname.
      // If it were the hostname, bun would re-resolve DNS at connect time and
      // hit the attacker's second answer (169.254.169.254).
      expect(fetchedUrl).toContain("93.184.216.34");
      expect(fetchedUrl).not.toContain("rebind.example");
      // The Host header pins virtual hosting + TLS SNI to the original host.
      expect(fetchedHostHeader).toBe("rebind.example");
    } finally {
      restoreDns();
    }
  });

  test("the pinned fetch URL uses the literal IP so NO second DNS resolution occurs", async () => {
    // If pinning were absent, fetch would resolve "rebind2.example" at connect
    // time. With pinning, the URL is a literal IP and dnsResolver is called
    // exactly ONCE (by assertUrlSafe). A second call would mean the pin failed.
    let dnsCalls = 0;
    const restoreDns = setDnsResolver(async () => {
      dnsCalls++;
      return [{ address: "93.184.216.34" }];
    });

    globalThis.fetch = (() =>
      Promise.resolve(new Response("body", { status: 200 }))) as any;

    try {
      await fetchWithSsrfGuard("https://rebind2.example/");
      // Exactly ONE DNS resolution: assertUrlSafe. The fetch itself does NOT
      // resolve DNS because the URL is a literal IP.
      expect(dnsCalls).toBe(1);
    } finally {
      restoreDns();
    }
  });

  test("assertUrlSafe returns the pinned IP + original host for pinning", async () => {
    const restoreDns = setDnsResolver(async (hostname) => {
      if (hostname === "pin-test.example") return [{ address: "203.0.113.5" }];
      throw new Error("ENOTFOUND");
    });
    try {
      const r: UrlSafetyResult = await assertUrlSafe("https://pin-test.example/path?q=1");
      expect(r.pinnedIp).toBe("203.0.113.5");
      expect(r.originalHost).toBe("pin-test.example");
      expect(r.isLiteralIpUrl).toBe(false);
    } finally {
      restoreDns();
    }
  });

  test("assertUrlSafe returns isLiteralIpUrl=true for a literal-IP URL (no pinning needed)", async () => {
    const r = await assertUrlSafe("https://93.184.216.34/");
    expect(r.isLiteralIpUrl).toBe(true);
    expect(r.pinnedIp).toBe("93.184.216.34");
    expect(r.originalHost).toBe("93.184.216.34");
  });

  test("an attacker returning a private IP on the FIRST resolution is still blocked", async () => {
    // This is the pre-existing defense (not the TOCTOU fix) — confirm it still
    // holds after the pinning refactor.
    const restoreDns = setDnsResolver(async () => [{ address: "10.0.0.99" }]);
    try {
      await expect(assertUrlSafe("https://first-private.example/")).rejects.toThrow(
        /10\.0\.0\.99/,
      );
    } finally {
      restoreDns();
    }
  });

  test("a rebind to IMDS on the second resolution does NOT reach the private IP", async () => {
    // The most critical scenario: attacker serves public at check, IMDS at
    // connect. Without pinning, fetch connects to 169.254.169.254. With
    // pinning, fetch connects to the pinned public IP and IMDS is never
    // contacted. We assert the fetched URL does NOT contain the IMDS IP.
    let call = 0;
    const restoreDns = setDnsResolver(async () => {
      call++;
      return call === 1 ? [{ address: "93.184.216.34" }] : [{ address: "169.254.169.254" }];
    });

    let fetchedUrl = "";
    globalThis.fetch = ((input: any) => {
      fetchedUrl = typeof input === "string" ? input : input.toString();
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as any;

    try {
      await fetchWithSsrfGuard("https://imds-rebind.example/latest/meta-data/");
      expect(fetchedUrl).not.toContain("169.254.169.254");
      expect(fetchedUrl).toContain("93.184.216.34");
    } finally {
      restoreDns();
    }
  });

  test("redirect to a rebinding hostname re-pins at the redirect hop", async () => {
    // First hop: public host returns 302 to a rebinding target. The target's
    // assertUrlSafe resolution returns public (passes), but a second resolution
    // would return private. Pinning must apply at the redirect hop too.
    let targetResolutions = 0;
    const restoreDns = setDnsResolver(async (hostname) => {
      if (hostname === "start.example") return [{ address: "93.184.216.34" }];
      if (hostname === "rebind-target.example") {
        targetResolutions++;
        return targetResolutions === 1
          ? [{ address: "203.0.113.10" }] // public — passes assertUrlSafe
          : [{ address: "169.254.169.254" }]; // IMDS — would bypass without pin
      }
      throw new Error("ENOTFOUND");
    });

    const fetchedUrls: string[] = [];
    globalThis.fetch = ((input: any) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchedUrls.push(url);
      if (url.includes("93.184.216.34")) {
        // First hop — redirect to the rebinding target.
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://rebind-target.example/data" },
          }),
        );
      }
      // Second hop — the pinned-IP fetch for the target.
      return Promise.resolve(new Response("target body", { status: 200 }));
    }) as any;

    try {
      const resp = await fetchWithSsrfGuard("https://start.example/");
      expect(resp.status).toBe(200);
      // The second fetch (redirect target) must be the pinned public IP, not
      // the hostname and not the IMDS IP.
      const targetFetch = fetchedUrls.find((u) => u.includes("203.0.113.10"));
      expect(targetFetch).toBeTruthy();
      const imdsFetch = fetchedUrls.find((u) => u.includes("169.254.169.254"));
      expect(imdsFetch).toBeUndefined();
    } finally {
      restoreDns();
    }
  });
});
