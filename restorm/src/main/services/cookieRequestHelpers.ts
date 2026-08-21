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

/** The jar key = the request's active environment id (per-env isolation). */
export function cookieEnvKeyFor(requestId?: string): string {
  if (requestId === undefined) return ''
  return contextService.getRequestContext(requestId)?.environmentId ?? ''
}

/** Inject the active environment's stored cookies into `headers` as a
 * `Cookie` header (a user-supplied one wins). A jar-injected user cookie's
 * `{{var}}` is resolved against the active environment at send time. */
export function attachSessionCookies(requestId: string | undefined, url: string, headers: Record<string, string>): void {
  const cookieString = cookieJarService.applyCookies(cookieEnvKeyFor(requestId), url, headers)
  if (cookieString !== undefined && requestId !== undefined && cookieString.includes('{{')) {
    headers['Cookie'] = contextService.resolveValue(cookieString, requestId)
  }
}

/** Capture a response's `Set-Cookie` into the active environment's jar. */
export function captureSessionCookies(requestId: string | undefined, url: string, setCookie: string | string[] | undefined): void {
  cookieJarService.storeCookies(cookieEnvKeyFor(requestId), url, setCookie)
}
