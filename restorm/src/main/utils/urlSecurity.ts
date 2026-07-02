/**
 * SSRF guard for every main-process code path that fetches a
 * user- or spec-supplied URL (spec imports, API-update spec pulls,
 * protocol executors). These run with full host network access and
 * bypass the user-facing firewall prompt, so an attacker-controlled
 * URL could otherwise reach cloud metadata endpoints
 * (169.254.169.254), loopback admin ports, or internal RFC1918
 * services.
 *
 * Policy: http(s) only; by default reject any URL that resolves to a
 * loopback, link-local, unique-local, or RFC1918 private address, plus
 * the obvious literal hostnames (localhost, *.localhost). An EXPLICIT
 * top-level import URL the user/agent typed may opt into loopback/private
 * via `allowPrivateHosts` (importing a spec from a local dev server is a
 * legitimate workflow) — but link-local / cloud-metadata stays blocked even
 * then, and redirect targets + spec-embedded sub-fetches always run strict
 * (the real SSRF vectors). Hostnames that need DNS resolution are NOT
 * resolved here (that would itself be a request and is racy vs. the eventual
 * connect); the literal-IP and literal-name checks below are the cheap,
 * deterministic first line, and the firewall interceptor remains the backstop
 * on the actual socket connect.
 */

/** Strip IPv6 zone id and surrounding brackets from a hostname. */
function normaliseHost(host: string): string {
  let h = host.trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  const zone = h.indexOf('%')
  if (zone !== -1) h = h.slice(0, zone)
  // Strip a trailing root-label dot: WHATWG `new URL` normalises numeric
  // IPs but keeps a trailing dot on a NAME, so `localhost.` /
  // `127.0.0.1.` would otherwise slip the loopback/private checks below
  // yet still resolve to loopback.
  if (h.endsWith('.')) h = h.slice(0, -1)
  return h
}

/** True for an IPv4 dotted-quad literal. */
function isIPv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/**
 * Link-local / cloud-metadata IPv4 — ALWAYS blocked, even for an explicit
 * user-supplied import URL. `169.254.0.0/16` covers the cloud metadata
 * endpoint (169.254.169.254); a fetch to it is never a legitimate import.
 */
function isMetadataIPv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number)
  return a === 169 && b === 254
}

/**
 * Private / loopback IPv4 that is BLOCKED by default but may be allowed for an
 * explicit top-level import (`allowPrivateHosts`). Excludes the link-local
 * metadata range (see {@link isMetadataIPv4}).
 */
function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number)
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 0) return true // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 carrier-grade NAT
  return false
}

/** Resolve an IPv4-mapped IPv6 literal to its dotted-quad, or null. `new URL`
 * may normalise `::ffff:10.0.0.1` to the compressed hex form `::ffff:a00:1`,
 * so accept both. */
function mappedIPv4(host: string): string | null {
  const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host)
  if (mappedDotted && isIPv4(mappedDotted[1])) return mappedDotted[1]
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host)
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16)
    const lo = parseInt(mappedHex[2], 16)
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
  }
  return null
}

/** Link-local IPv6 (fe80::/10) + IPv4-mapped metadata — ALWAYS blocked. */
function isMetadataIPv6(host: string): boolean {
  if (host.startsWith('fe80')) return true // link-local
  const v4 = mappedIPv4(host)
  return v4 !== null && isMetadataIPv4(v4)
}

/** Private / loopback IPv6 — blockable, allowed with `allowPrivateHosts`. */
function isPrivateIPv6(host: string): boolean {
  if (host === '::1' || host === '::') return true // loopback / unspecified
  if (host.startsWith('fc') || host.startsWith('fd')) return true // unique-local fc00::/7
  const v4 = mappedIPv4(host)
  return v4 !== null && isPrivateIPv4(v4)
}

export interface AssertSafeFetchUrlOptions {
  /**
   * Allow loopback + RFC1918/unique-local private hosts. Set ONLY for an
   * EXPLICIT top-level import URL the user/agent typed (importing a spec from
   * a local dev server is legitimate). Link-local / cloud-metadata is blocked
   * regardless. Never set this for a redirect target or a spec-embedded
   * sub-fetch ($ref, server URL) — those are the real SSRF vectors and must
   * stay strict. Defaults to `false`.
   */
  allowPrivateHosts?: boolean
}

/**
 * Validate that `rawUrl` is a safe http(s) target. Returns the parsed
 * URL on success; throws an `Error` with a human-readable reason
 * otherwise. Callers should surface the message to the user / agent.
 *
 * With `allowPrivateHosts` (explicit top-level import only), loopback +
 * private hosts are permitted but link-local / cloud-metadata is STILL
 * blocked. The default (false) is the strict policy for redirects + embedded
 * sub-fetches.
 */
export function assertSafeFetchUrl(rawUrl: string, options: AssertSafeFetchUrlOptions = {}): URL {
  const { allowPrivateHosts = false } = options
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: "${rawUrl}"`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only http(s) is allowed`)
  }

  const host = normaliseHost(parsed.hostname)
  if (host.length === 0) {
    throw new Error(`Blocked URL with empty host: "${rawUrl}"`)
  }

  // Link-local / cloud-metadata is ALWAYS blocked — never a legitimate target,
  // even for an explicit import.
  if (isIPv4(host) && isMetadataIPv4(host)) {
    throw new Error(`Blocked request to link-local/metadata address "${host}"`)
  }
  if (host.includes(':') && isMetadataIPv6(host)) {
    throw new Error(`Blocked request to link-local/metadata address "${host}"`)
  }

  // Loopback + private/RFC1918 — blocked unless the caller explicitly opts in
  // for a top-level import URL.
  if (!allowPrivateHosts) {
    if (host === 'localhost' || host.endsWith('.localhost')) {
      throw new Error(`Blocked request to loopback host "${host}"`)
    }
    if (isIPv4(host) && isPrivateIPv4(host)) {
      throw new Error(`Blocked request to private/loopback address "${host}"`)
    }
    if (host.includes(':') && isPrivateIPv6(host)) {
      throw new Error(`Blocked request to private/loopback address "${host}"`)
    }
  }

  return parsed
}

/** Non-throwing variant: true when the URL is a safe http(s) target. */
export function isSafeFetchUrl(rawUrl: string, options: AssertSafeFetchUrlOptions = {}): boolean {
  try {
    assertSafeFetchUrl(rawUrl, options)
    return true
  } catch {
    return false
  }
}

/** Hard cap on redirect hops for a safe-following fetch. */
const MAX_SAFE_REDIRECTS = 5

/**
 * SSRF-safe `fetch` that follows redirects MANUALLY, re-validating every hop's
 * `Location` with {@link assertSafeFetchUrl} (STRICT — no `allowPrivateHosts`)
 * before following it. Use this for any main-process fetch that runs
 * firewall-BYPASSED (spec imports, code-node dependency downloads, …): the
 * firewall socket-interceptor backstop is off, and a plain `fetch(url, {
 * redirect: 'follow' })` would let a 3xx bounce to a loopback / RFC1918 /
 * link-local / cloud-metadata host. The caller must have already validated the
 * INITIAL `url` (the initial validation is the caller's choice of
 * `allowPrivateHosts`; every subsequent hop is forced strict here).
 */
export async function fetchFollowingSafeRedirects(url: string, init: RequestInit): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_SAFE_REDIRECTS; hop++) {
    const response = await fetch(current, { ...init, redirect: 'manual' })
    // 3xx with a Location → a redirect we must re-validate before following.
    const location = response.status >= 300 && response.status < 400
      ? response.headers.get('location')
      : null
    if (location === null) return response
    // Resolve relative redirects against the current URL, then re-assert
    // STRICTLY (no allowPrivateHosts) so the hop can't reach loopback/private/
    // metadata even though the original explicit URL was allowed to.
    const next = new URL(location, current).toString()
    assertSafeFetchUrl(next)
    current = next
  }
  throw new Error(`Too many redirects following the URL (>${MAX_SAFE_REDIRECTS})`)
}
