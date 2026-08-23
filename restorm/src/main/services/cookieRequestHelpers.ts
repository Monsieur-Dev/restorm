/**
 * Shared cookie helpers for the HTTP-based execution services that don't
 * ride HTTPExecutionService's undici funnel (GraphQL, SOAP, SSE, …). They
 * key the jar by the request's active environment — exactly like the
 * interactive send and, crucially, like a scenario node (which passes the
 * same real `requestId`), so a scenario's login→protected-route chain
 * shares one jar within the environment. NEVER key by requestId.
 */
import { cookieJarService } from './CookieJarService'
import { contextService } from './ContextService'
import type { CookiePair } from '../../shared/cookies/cookieTypes'

/** The jar key = the request's active environment id (per-env isolation). */
export function cookieEnvKeyFor(requestId?: string): string {
  if (requestId === undefined) return ''
  return contextService.getRequestContext(requestId)?.environmentId ?? ''
}

/** Split a `Cookie` request header (`a=1; b=2`) into name→value pairs. */
export function parseCookiePairs(header: string): CookiePair[] {
  return header
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((pair) => {
      const eq = pair.indexOf('=')
      return eq === -1
        ? { name: pair, value: '' }
        : { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() }
    })
}

/** Extract name→value from one or many `Set-Cookie` header values (the leading
 * `name=value`, before the attributes). */
export function parseSetCookies(setCookie: string | string[] | undefined): CookiePair[] {
  if (setCookie === undefined) return []
  const values = Array.isArray(setCookie) ? setCookie : [setCookie]
  const rows: CookiePair[] = []
  for (const raw of values) {
    const first = raw.split(';')[0]?.trim()
    if (first === undefined || first.length === 0) continue
    const eq = first.indexOf('=')
    rows.push(eq === -1 ? { name: first, value: '' } : { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() })
  }
  return rows
}

/** Inject the active environment's stored cookies into `headers` as a
 * `Cookie` header (a user-supplied one wins). A jar-injected user cookie's
 * `{{var}}` is resolved against the active environment at send time. Returns
 * the effective cookies actually sent (for the response-side Cookies tab). */
export function attachSessionCookies(requestId: string | undefined, url: string, headers: Record<string, string>): CookiePair[] {
  const cookieString = cookieJarService.applyCookies(cookieEnvKeyFor(requestId), url, headers)
  if (cookieString !== undefined && requestId !== undefined && cookieString.includes('{{')) {
    headers['Cookie'] = contextService.resolveValue(cookieString, requestId)
  }
  const sent = Object.entries(headers).find(([k]) => k.toLowerCase() === 'cookie')?.[1]
  return sent ? parseCookiePairs(sent) : []
}

/** Capture a response's `Set-Cookie` into the active environment's jar and
 * return the received cookies (for the response-side Cookies tab). */
export function captureSessionCookies(requestId: string | undefined, url: string, setCookie: string | string[] | undefined): CookiePair[] {
  cookieJarService.storeCookies(cookieEnvKeyFor(requestId), url, setCookie)
  return parseSetCookies(setCookie)
}
