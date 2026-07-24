/**
 * SSRF guard — Server-Side Request Forgery defense for `fetch_and_index`.
 *
 * Policy (massa-ai is STRICT BY DEFAULT, unlike context-mode's lenient mode):
 *
 *   HARD BLOCK — no legitimate fetch use case reaches these:
 *     - non-http(s) schemes (file://, gopher://, javascript:, data:, …)
 *     - 169.254.0.0/16 link-local — INCLUDES 169.254.169.254 (AWS/GCP/Azure
 *       IMDS cloud-credential endpoint, the highest-value SSRF target)
 *     - IPv6 link-local fe80::/10
 *     - multicast (224.0.0.0/4 IPv4, ff00::/8 IPv6)
 *     - unspecified / current-network (0.0.0.0/8, ::)
 *     - loopback (127.0.0.0/8, ::1) — local dev servers are out of scope here
 *     - RFC1918 private (10/8, 172.16/12, 192.168/16) and IPv6 ULA (fc00::/7)
 *     - malformed / non-IP strings
 *
 * The massa-ai trust model treats fetch targets as OPEN WORLD (arbitrary
 * URLs the agent fetched at the user's request), so a private/loopback hit is
 * treated as a rebinding attack probe, not a local-dev convenience. This is the
 * conservative default; there is no lenient escape hatch (unlike context-mode's
 * `CTX_FETCH_STRICT` toggle) — if a future task needs to fetch localhost it can
 * add an explicit allowlist.
 *
 * DNS-rebinding defense (TOCTOU-safe):
 *   1. Resolve the hostname ONCE and classify EACH resolved address.
 *   2. PIN the connection to the already-classified resolved IP by rewriting
 *      the fetch URL to the literal IP and setting the `Host` header to the
 *      original hostname. This closes the TOCTOU: the fetch's own connect-time
 *      DNS re-resolution is bypassed entirely because the URL host is now a
 *      literal IP (no lookup occurs). An attacker cannot serve a public IP at
 *      check-time and a private IP at connect-time for the SAME request — the
 *      connect-time resolution never happens.
 *      (The alternative — a custom undici `connect.lookup` hook — does NOT work
 *      under bun: bun's native fetch ignores the undici Dispatcher entirely,
 *      and even the bundled undici shim does not invoke `connect.lookup`. The
 *      literal-IP + Host-header approach is the only one that works under bun
 *      and is also portable to node/undici.)
 *   3. On fetch, walk redirects MANUALLY (do not let fetch auto-follow) and
 *      re-resolve + re-classify + re-PIN the hostname of every hop. An attacker
 *      can return a public IP for the first request, then 302 to an internal
 *      host whose DNS now resolves to 169.254.169.254. Manual redirect walking
 *      with per-hop resolution+pinning defeats this.
 *
 * Exported seams:
 *   - classifyIp(ip) — pure IP classifier (tested directly with literals).
 *   - assertUrlSafe(url) — resolve + classify, returns pinned IP(s); throws on
 *     any blocked IP.
 *   - fetchWithSsrfGuard(url, opts) — fetch with DNS-pinned connect + manual
 *     redirect walk that re-runs assertUrlSafe (and re-pins) at every hop.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { logger } from "@massa-ai/shared";

export type IpClass = "block" | "public";

/** Hard cap on redirect hops we will walk before giving up (loop defense). */
export const MAX_REDIRECTS = 8;

/**
 * Injectable DNS resolver seam. Defaults to node:dns/promises `lookup`. Tests
 * swap this (via `setDnsResolver`) to simulate DNS rebinding / IMDS aliases
 * WITHOUT patching the read-only module namespace. Production code never calls
 * the setter.
 */
export type DnsResolver = (
  hostname: string,
) => Promise<{ address: string }[]>;
let dnsResolver: DnsResolver = async (hostname) => {
  // node:dns/promises `lookup` with `all: true` returns {address,family}[].
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address }));
};

/** Test seam: override the DNS resolver. Returns a restore function. */
export function setDnsResolver(resolver: DnsResolver): () => void {
  const prev = dnsResolver;
  dnsResolver = resolver;
  return () => {
    dnsResolver = prev;
  };
}

/**
 * Classify a single IP literal.
 *
 * Returns "block" for link-local / loopback / private / multicast / unspecified
 * / malformed. Returns "public" only for genuinely routable addresses.
 *
 * IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is routed through the IPv4 classifier so
 * loopback mapped into the v6 space is still caught.
 *
 * RFC 6874 zone identifiers (`fe80::1%eth0`, URL-encoded `%25eth0`) are stripped
 * BEFORE classification — without the strip, `::1%eth0` no longer matches
 * `=== "::1"` and would fall through to "public", silently bypassing the guard.
 */
export function classifyIp(rawIp: string): IpClass {
  // Strip RFC 6874 zone id first (e.g. `fe80::1%eth0` or `%25eth0`).
  const pctIdx = rawIp.indexOf("%");
  const ip = pctIdx === -1 ? rawIp : rawIp.slice(0, pctIdx);
  const lower = ip.toLowerCase();

  // IPv6 (detected by presence of `:` so IPv4-mapped addresses route correctly).
  if (lower.includes(":")) {
    // IPv4-mapped IPv6 (`::ffff:127.0.0.1`) — recurse through IPv4 classifier.
    // Node's URL normalizes these to hex (`::ffff:7f00:1`), so handle BOTH the
    // dotted-decimal and the hex-compressed forms. Without the hex form, an
    // attacker could reach IMDS via `http://[::ffff:169.254.169.254]/` because
    // URL.hostname yields `[::ffff:a9fe:a9fe]` which the decimal-only regex missed.
    const v4MappedDecimal = lower.match(/^::ffff:([\d.]+)$/);
    if (v4MappedDecimal) return classifyIp(v4MappedDecimal[1]);
    const v4MappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (v4MappedHex) {
      const hi = parseInt(v4MappedHex[1], 16);
      const lo = parseInt(v4MappedHex[2], 16);
      const a = (hi >> 8) & 0xff;
      const b = hi & 0xff;
      const c = (lo >> 8) & 0xff;
      const d = lo & 0xff;
      return classifyIp(`${a}.${b}.${c}.${d}`);
    }
    if (lower === "::") return "block"; // unspecified
    // fe80::/10 link-local — match the high-nibble range fe8..feb.
    if (
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    ) {
      return "block";
    }
    if (lower.startsWith("ff")) return "block"; // ff00::/8 multicast
    if (lower === "::1") return "block"; // loopback
    // fc00::/7 unique-local (fc.. or fd..)
    if (lower.startsWith("fc") || lower.startsWith("fd")) return "block";
    return "public";
  }

  // IPv4 — or a non-IP string (malformed = block).
  if (!ip.includes(".")) return "block";
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return "block";
  }
  const [a, b] = parts;
  if (a === 169 && b === 254) return "block"; // link-local incl. 169.254.169.254 (IMDS)
  if (a === 0) return "block"; // 0.0.0.0/8 current network
  if (a >= 224) return "block"; // 224.0.0.0/4 multicast + 240+ reserved
  if (a === 127) return "block"; // 127.0.0.0/8 loopback
  if (a === 10) return "block"; // 10.0.0.0/8 RFC1918
  if (a === 172 && b >= 16 && b <= 31) return "block"; // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 168) return "block"; // 192.168.0.0/16 RFC1918
  if (a === 100 && b >= 64 && b <= 127) return "block"; // 100.64.0.0/10 CGNAT
  return "public";
}

/** Error thrown when a URL or one of its redirect hops is blocked by SSRF. */
export class SsrfBlockedError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly resolvedIp?: string,
  ) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/**
 * Result of `assertUrlSafe`: the connection-pin parameters the caller must use
 * when issuing the fetch so the TOCTOU gap between check-time and connect-time
 * DNS resolution is closed.
 *
 *   - `pinnedIp`: the already-classified IP literal to connect to (replaces the
 *     hostname in the fetch URL). For a URL that already names a literal IP,
 *     this is that same IP. For a hostname, this is the first public resolved
 *     address.
 *   - `originalHost`: the hostname to send in the `Host` header so virtual
 *     hosting + TLS SNI still work. Equals the URL's hostname (brackets stripped
 *     for IPv6). When the URL already names a literal IP, this equals pinnedIp
 *     and no Host header rewrite is needed.
 *   - `isLiteralIpUrl`: true when the original URL host was already an IP
 *     literal (no DNS resolution occurred). Lets the caller skip the rewrite.
 */
export interface UrlSafetyResult {
  pinnedIp: string;
  originalHost: string;
  isLiteralIpUrl: boolean;
}

/**
 * Resolve `hostname` and assert every resolved IP is public. Throws
 * `SsrfBlockedError` on the first blocked address. A hostname that resolves to
 * a MIX of public + private is still rejected (TOCTOU-safe: we re-resolve on
 * fetch, so even if the resolver rotates answers, every hop is checked).
 *
 * Returns the `UrlSafetyResult` (pinned IP + original hostname) so the caller
 * can pin the fetch connection to the already-classified IP and close the
 * TOCTOU between check-time and connect-time DNS resolution.
 */
export async function assertUrlSafe(rawUrl: string): Promise<UrlSafetyResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`invalid URL: ${rawUrl}`, rawUrl);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(
      `URL scheme "${parsed.protocol}" not allowed (only http: and https:)`,
      rawUrl,
    );
  }

  // Bracketed IPv6 host literal (`[::1]`) — Node's `URL.hostname` does NOT
  // strip the brackets (it returns `"[::1]"`, `"[fe80::1]"`, etc.); the old
  // comment claiming otherwise was wrong and caused a CRITICAL SSRF bypass
  // where `http://[::1]/` and `http://[fe80::1]/` fell through to "public".
  // Strip brackets so classifyIp sees the bare IPv6 literal.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // Literal IP in the URL (no DNS needed): URL parses `http://127.0.0.1/`
  // with hostname === "127.0.0.1". classifyIp handles it directly. A hostname
  // that is NOT an IP literal goes through DNS resolution below.
  if (looksLikeIpLiteral(hostname)) {
    if (classifyIp(hostname) === "block") {
      throw new SsrfBlockedError(
        `URL host ${hostname} is a blocked IP range`,
        rawUrl,
        hostname,
      );
    }
    return { pinnedIp: hostname, originalHost: hostname, isLiteralIpUrl: true };
  }

  let records: { address: string }[];
  try {
    records = await dnsResolver(hostname);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code ?? "";
    const msg = err instanceof Error ? err.message : String(err);
    // Surface transient DNS codes so the caller can distinguish "blocked" from
    // "resolver hiccup" and retry sensibly.
    throw new SsrfBlockedError(
      `DNS lookup failed for "${hostname}" (${code}): ${msg}`,
      rawUrl,
    );
  }

  if (records.length === 0) {
    throw new SsrfBlockedError(`DNS returned no records for "${hostname}"`, rawUrl);
  }

  for (const rec of records) {
    if (classifyIp(rec.address) === "block") {
      throw new SsrfBlockedError(
        `"${hostname}" resolves to blocked IP ${rec.address} (loopback / private / link-local / multicast)`,
        rawUrl,
        rec.address,
      );
    }
  }

  // Pin to the first classified-public IP. Every record was checked above, so
  // the first is safe to connect to. (We do not round-robin across resolved
  // IPs because only the one we pin is guaranteed classified; a later answer
  // could be attacker-rotated between assert and connect.)
  return {
    pinnedIp: records[0].address,
    originalHost: hostname,
    isLiteralIpUrl: false,
  };
}

/**
 * Heuristic: does `hostname` parse as an IP literal (v4 or v6)? Used to skip
 * DNS when the URL already names an IP directly. IPv6 zone ids are tolerated.
 */
function looksLikeIpLiteral(hostname: string): boolean {
  const h = hostname.split("%")[0]; // tolerate zone id
  if (h.includes(":")) return true; // IPv6
  // IPv4 = four dot-separated 0-255 octets.
  const parts = h.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

export interface FetchGuardOptions {
  /** Per-request timeout (ms). Default 30_000. */
  timeoutMs?: number;
  /** AbortSignal from the caller (e.g. for test cancellation). */
  signal?: AbortSignal;
  /** Composed AbortSignal: combines the timeout timer and the caller's signal. */
  _compose?: (signals: AbortSignal[]) => AbortSignal;
}

/**
 * Fetch a URL with the SSRF DNS-pin + redirect-walk defense.
 *
 * TWO-LAYER DEFENSE (TOCTOU-safe):
 *   1. DNS PIN: `assertUrlSafe` resolves the hostname once and classifies the
 *      IP. We then rewrite the fetch URL to connect to that LITERAL IP and set
 *      the `Host` header to the original hostname. Because the fetch URL's host
 *      is now a literal IP, NO DNS lookup occurs at connect time — the attacker
 *      cannot serve a different (private) IP at connect. bun's fetch honors the
 *      `Host` header for both HTTP virtual hosting and HTTPS TLS SNI.
 *   2. REDIRECT WALK: does NOT auto-follow. Each 3xx Location header is
 *      re-resolved + re-classified + re-pinned before the next hop. Any blocked
 *      hop throws `SsrfBlockedError`. Capped at MAX_REDIRECTS to defeat loops.
 *
 * Returns the final (non-redirect) Response. The caller reads the body.
 */
export async function fetchWithSsrfGuard(
  rawUrl: string,
  opts: FetchGuardOptions = {},
): Promise<Response> {
  const { timeoutMs = 30_000, signal, _compose } = opts;
  const safety = await assertUrlSafe(rawUrl);

  let url = rawUrl;
  let pin = safety;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const composed =
      _compose && signal
        ? _compose([signal, AbortSignal.timeout(timeoutMs)])
        : (signal
            ? _compose
              ? _compose([signal])
              : signal
            : AbortSignal.timeout(timeoutMs));

    // Build the DNS-pinned fetch URL + Host header. When the URL already names
    // a literal IP (isLiteralIpUrl), no rewrite is needed — the connect-time
    // DNS lookup is already absent. Otherwise, replace the hostname in the URL
    // with the pinned classified IP and send the original hostname as Host.
    const { fetchUrl, hostHeader } = pinConnection(url, pin);

    // `redirect: "manual"` keeps the Response opaque-redirect; we read the
    // Location header ourselves and re-validate the target.
    const resp = await fetch(fetchUrl, {
      redirect: "manual",
      signal: composed,
      // Conservative default headers — identify as a fetcher, not a browser.
      // Host header pins virtual hosting + TLS SNI to the original hostname.
      headers: {
        "user-agent": "massa-ai-fetch/1.0",
        ...(hostHeader ? { host: hostHeader } : {}),
      },
    });

    // 3xx with a Location → walk it.
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      // Drain so the underlying socket can be reused.
      await resp.body?.cancel().catch(() => {});
      if (!location) {
        throw new SsrfBlockedError(
          `redirect ${resp.status} without Location header`,
          url,
        );
      }
      const next = new URL(location, url).toString(); // resolve relative redirects
      if (hop === MAX_REDIRECTS) {
        throw new SsrfBlockedError(
          `exceeded ${MAX_REDIRECTS} redirects (loop?)`,
          next,
        );
      }
      logger.debug?.("ssrf redirect hop", { from: url, to: next, status: resp.status });
      // Re-resolve + re-classify + re-pin the NEXT hop (DNS may now differ).
      pin = await assertUrlSafe(next);
      url = next;
      continue;
    }

    return resp;
  }
  // Unreachable: the loop either returns or throws on the last iteration.
  throw new SsrfBlockedError("redirect walk exhausted", url);
}

/**
 * Build a DNS-pinned fetch URL + Host header from the original URL and the
 * `UrlSafetyResult` (pinned IP + original hostname).
 *
 * When the URL already names a literal IP (`isLiteralIpUrl`), returns the URL
 * unchanged with no Host header (no pinning needed — connect-time DNS is
 * already absent). Otherwise, rewrites the URL's host to the pinned IP literal
 * and returns the original hostname as the Host header value.
 *
 * IPv6 pinned IPs are bracketed in the URL (`http://[2606:4700::1]/`) per
 * RFC 3986. The Host header uses the bare original hostname (no brackets — it
 * was a hostname, not an IP, in the non-literal branch).
 */
function pinConnection(
  url: string,
  pin: UrlSafetyResult,
): { fetchUrl: string; hostHeader: string | null } {
  if (pin.isLiteralIpUrl) {
    return { fetchUrl: url, hostHeader: null };
  }
  const parsed = new URL(url);
  const ipIsV6 = pin.pinnedIp.includes(":");
  parsed.hostname = ipIsV6 ? `[${pin.pinnedIp}]` : pin.pinnedIp;
  return { fetchUrl: parsed.toString(), hostHeader: pin.originalHost };
}
