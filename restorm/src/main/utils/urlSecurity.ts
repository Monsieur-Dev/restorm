/**
 * SSRF guard for every main-process code path that fetches a
 * user- or spec-supplied URL (spec imports, API-update spec pulls,
 * protocol executors). These run with full host network access and
 * bypass the user-facing firewall prompt, so an attacker-controlled
 * URL could otherwise reach cloud metadata endpoints
 * (169.254.169.254), loopback admin ports, or internal RFC1918
 * services.
 *
 * Policy: http(s) only; reject any URL that resolves to a loopback,
 * link-local, unique-local, or RFC1918 private address, plus the
 * obvious literal hostnames (localhost, *.localhost). Hostnames that
 * need DNS resolution are NOT resolved here (that would itself be a
 * request and is racy vs. the eventual connect); the literal-IP and
 * literal-name checks below are the cheap, deterministic first line,
 * and the firewall interceptor remains the backstop on the actual
 * socket connect.
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

function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number)
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 0) return true // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 carrier-grade NAT
  return false
}

function isPrivateIPv6(host: string): boolean {
  const h = host
  if (h === '::1' || h === '::') return true // loopback / unspecified
  if (h.startsWith('fe80')) return true // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true // unique-local fc00::/7
  // IPv4-mapped (::ffff:10.0.0.1) — `new URL` normalises this to the
  // compressed hex form (::ffff:a00:1), so accept both: dotted-quad
  // and two 16-bit hex groups that pack into the four v4 octets.
  const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h)
  if (mappedDotted && isIPv4(mappedDotted[1])) return isPrivateIPv4(mappedDotted[1])
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h)
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16)
    const lo = parseInt(mappedHex[2], 16)
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
    return isPrivateIPv4(v4)
  }
  return false
}

/**
 * Validate that `rawUrl` is a safe http(s) target. Returns the parsed
 * URL on success; throws an `Error` with a human-readable reason
 * otherwise. Callers should surface the message to the user / agent.
 */
export function assertSafeFetchUrl(rawUrl: string): URL {
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
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error(`Blocked request to loopback host "${host}"`)
  }
  if (isIPv4(host) && isPrivateIPv4(host)) {
    throw new Error(`Blocked request to private/loopback address "${host}"`)
  }
  if (host.includes(':') && isPrivateIPv6(host)) {
    throw new Error(`Blocked request to private/loopback address "${host}"`)
  }

  return parsed
}

/** Non-throwing variant: true when the URL is a safe http(s) target. */
export function isSafeFetchUrl(rawUrl: string): boolean {
  try {
    assertSafeFetchUrl(rawUrl)
    return true
  } catch {
    return false
  }
}
