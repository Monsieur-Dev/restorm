/**
 * AuthenticationCacheService
 *
 * Holds per-auth-request resolved headers in main-process memory.
 * Never touches disk: a restart forces every downstream request to
 * re-authenticate. The service knows how to refresh an expired /
 * missing entry by invoking the underlying HTTP pipeline and
 * evaluating the auth request's `producedHeaders` + `expirationExpression`
 * against the response body.
 */

import { BrowserWindow } from 'electron'
import Handlebars from 'handlebars'
import { eventBusService, logger, type Subscription } from 'electron-core-ui/main'
import type { AuthenticationRequest } from '../../shared/models/requests/AuthenticationRequest'
import { DocumentEvents, type DocumentDeletedPayload } from './DocumentEvents'
import type { HTTPExecutionResult } from './HTTPExecutionService'

/** Phase values emitted on `auth:running`. */
export type AuthPhase = 'started' | 'succeeded' | 'failed'

interface CacheEntry {
  /** Resolved header map, keyed case-insensitively by the caller. */
  headers: Record<string, string>
  /** Monotonic timestamp of when the entry was stored. */
  storedAt: number
  /** Optional TTL in ms. When undefined, the entry never expires. */
  ttlMs?: number
  /** Raw response body from the last successful auth run — kept so
   * later refresh attempts can surface token-bearing fields in
   * diagnostics / redaction. */
  lastResponseBody?: string
  /** Source auth route id. Lets the REQUEST_DELETED handler drop
   * every entry for a deleted auth request — even though the cache
   * key is shape-based, we still want a route-id back-reference so
   * "user just deleted this auth route" wipes its derived caches
   * across all envs. */
  authRequestId: string
}

/** Callback the cache uses to actually fire the resolved auth
 * request on the wire. The shape is pre-resolved by the caller so
 * the executor doesn't have to consult the env again — the cache
 * uses the same shape to derive its key, and the executor uses it
 * to assemble the HTTP request. */
export type AuthRequestExecutor = (
  shape: ResolvedAuthShape
) => Promise<HTTPExecutionResult>

/**
 * Env-resolved snapshot of an auth request, ready to go on the
 * wire. Captures everything that varies with the active environment
 * (URL after `{{baseUrl}}` expansion, body after `{{client_id}}`
 * expansion, request headers after substitution). The cache key is
 * derived from this shape PLUS the auth route's `producedHeaders`
 * templates, so two routes that resolve to identical bytes but
 * differ in which headers they produce don't share an entry.
 */
export interface ResolvedAuthShape {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

class AuthenticationCacheService {
  private entries = new Map<string, CacheEntry>()
  /** In-flight refresh promises keyed by the resolved-shape cache
   * key (same key the entries Map uses).
   *
   * Coalesces concurrent `getHeaders` / `refresh` calls for the same
   * resolved shape so the token endpoint is hit exactly once per
   * burst. Without this, a batch OData `$batch`, a mass sidebar
   * send, or N parallel requests catching a shared 401 each fire
   * their own refresh, overwrite each other in `entries`, and emit
   * N `started` events.
   *
   * The promise is cleared in a `finally` on both success and failure
   * so subsequent callers get a clean slot — including after a
   * credential error that'll be retried later. */
  private inflight = new Map<string, Promise<Record<string, string>>>()
  private subscriptions: Subscription[] = []
  private initialized = false

  /**
   * Wire up event subscriptions. Idempotent — safe to call repeatedly;
   * the main process invokes it once during service bootstrap.
   *
   * We drop every cached entry that was minted from a deleted auth
   * request so a recreated id (or an id reused after an import)
   * starts from a clean slate, and so long-running sessions don't
   * accumulate dead entries for auth routes the user removed.
   */
  initialize(): void {
    if (this.initialized) return
    this.subscriptions.push(
      eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.REQUEST_DELETED, (payload) => {
        this.invalidateByAuthRequestId(payload.id)
      })
    )
    this.initialized = true
  }

  /** Tear down subscriptions. Test-only. */
  destroy(): void {
    for (const sub of this.subscriptions) sub.unsubscribe()
    this.subscriptions = []
    this.initialized = false
  }

  /**
   * Public entry point: return cached headers if fresh, otherwise run
   * the auth request + store the result. Throws when the auth call
   * itself fails so downstream dispatchers can abort cleanly.
   *
   * `shape` is the env-resolved request — caller is responsible for
   * expanding handlebars / picking the right env. The cache key is
   * derived from `shape` plus the route's `producedHeaders`
   * templates, so two consecutive calls with the same env produce a
   * cache hit, env-A → env-B → env-A produces hit / miss / hit (no
   * spurious refetch on round-trip), and two routes with identical
   * resolved shapes but different producedHeaders templates don't
   * step on each other's entries.
   */
  async getHeaders(
    request: AuthenticationRequest,
    shape: ResolvedAuthShape,
    executor: AuthRequestExecutor
  ): Promise<Record<string, string>> {
    const key = this.cacheKeyFor(request, shape)
    const existing = this.entries.get(key)
    if (existing && !this.isExpired(existing)) {
      return existing.headers
    }
    return this.refreshAt(key, request, shape, executor)
  }

  /**
   * Force a refresh (used by the auth-error-code retry-once path).
   * Always runs the auth request, regardless of cache freshness.
   *
   * Concurrent callers with the same key share one in-flight run —
   * see `inflight` field docs for the rationale.
   */
  async refresh(
    request: AuthenticationRequest,
    shape: ResolvedAuthShape,
    executor: AuthRequestExecutor
  ): Promise<Record<string, string>> {
    return this.refreshAt(this.cacheKeyFor(request, shape), request, shape, executor)
  }

  private async refreshAt(
    key: string,
    request: AuthenticationRequest,
    shape: ResolvedAuthShape,
    executor: AuthRequestExecutor
  ): Promise<Record<string, string>> {
    const pending = this.inflight.get(key)
    if (pending) return pending
    const run = this.refreshInner(key, request, shape, executor)
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, run)
    return run
  }

  /** Actual refresh body — kept separate so `refresh` can coalesce. */
  private async refreshInner(
    key: string,
    request: AuthenticationRequest,
    shape: ResolvedAuthShape,
    executor: AuthRequestExecutor
  ): Promise<Record<string, string>> {
    this.emit('started', request.id)
    let result: HTTPExecutionResult
    try {
      result = await executor(shape)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      this.emit('failed', request.id, reason)
      throw err
    }

    const statusCode = result.statusCode ?? 0
    if (!result.success || statusCode < 200 || statusCode >= 300) {
      const reason = result.error ?? `HTTP ${statusCode}`
      this.emit('failed', request.id, reason)
      throw new Error(`Authentication failed: ${reason}`)
    }

    const body = result.body ?? ''
    let parsedBody: unknown
    try {
      parsedBody = body ? JSON.parse(body) : {}
    } catch {
      // Non-JSON response — still allow handlebars against the raw
      // string (handlebars will just substitute blanks for unknown
      // fields). Users can author `{{this}}` to reference the raw
      // response if they need it.
      parsedBody = { body }
    }

    const headers: Record<string, string> = {}
    for (const kv of request.producedHeaders) {
      if (!kv.key) continue
      if (!kv.enabled) continue
      const template = kv.value.toString()
      const rendered = this.safeRender(template, parsedBody)
      if (rendered !== '') {
        headers[kv.key] = rendered
      }
    }

    const ttlMs = this.evaluateExpiration(request.expirationExpression, parsedBody)
    const entry: CacheEntry = {
      headers,
      storedAt: Date.now(),
      authRequestId: request.id,
      ...(ttlMs !== undefined ? { ttlMs } : {}),
      ...(body ? { lastResponseBody: body } : {})
    }
    this.entries.set(key, entry)
    this.emit('succeeded', request.id)
    return headers
  }

  /**
   * Drop the cached entry that matches the given resolved shape.
   * Used by the auth-error-code retry-once path: when a downstream
   * request gets a status the auth route declared as "your token
   * expired", the caller invalidates with the same shape it just
   * used to fetch headers, then re-runs `refresh` with that shape.
   */
  invalidate(request: AuthenticationRequest, shape: ResolvedAuthShape): void {
    this.entries.delete(this.cacheKeyFor(request, shape))
  }

  /**
   * Drop every cached entry minted from a given auth-request id —
   * regardless of which env produced it. Used when the auth route
   * itself goes away (REQUEST_DELETED). Also drops in-flight refreshes
   * so a retry that was already on its way completes against an empty
   * cache (the executor closure may now be invalid anyway).
   */
  invalidateByAuthRequestId(authRequestId: string): void {
    const toDelete: string[] = []
    for (const [key, entry] of this.entries) {
      if (entry.authRequestId === authRequestId) toDelete.push(key)
    }
    for (const key of toDelete) this.entries.delete(key)
    // The inflight Map is keyed by composite, so we can't easily
    // identify which promises are tied to this auth request id
    // without a back-reference. Clearing the whole map is the
    // simplest correct behaviour — any in-flight refresh for an
    // unrelated route just races to completion and overwrites a
    // never-existed entry.
    this.inflight.clear()
  }

  /** Drop everything — used on workspace close / app restart. */
  clear(): void {
    this.entries.clear()
    this.inflight.clear()
  }

  /** Test-only inspection hook. */
  hasEntry(request: AuthenticationRequest, shape: ResolvedAuthShape): boolean {
    return this.entries.has(this.cacheKeyFor(request, shape))
  }

  /**
   * Stable key for a (request, shape) pair. Includes:
   *
   * - The env-resolved shape (method / url / body / headers) — what
   *   the auth call would put on the wire. Two parallel calls with
   *   identical resolved shapes deserve one cache entry.
   * - The auth route's `producedHeaders` templates — what the cache
   *   actually stores per entry. Two routes that would resolve to
   *   the same wire bytes but compute different downstream headers
   *   (e.g. `Authorization` vs `X-Auth`) must NOT share an entry.
   *
   * The auth-request id is intentionally NOT in the key: when two
   * routes are byte-for-byte identical (same wire shape, same
   * producedHeaders), caching them together is correct — they'd
   * produce the same response and the same headers anyway.
   */
  private cacheKeyFor(request: AuthenticationRequest, shape: ResolvedAuthShape): string {
    const headerEntries = Object.entries(shape.headers)
      .map(([k, v]) => [k.toLowerCase(), v] as const)
      .sort(([a], [b]) => a.localeCompare(b))
    const producedTemplates = request.producedHeaders
      .filter((kv) => kv.enabled && kv.key.length > 0)
      .map((kv) => [kv.key.toLowerCase(), kv.value.toString()] as const)
      .sort(([a], [b]) => a.localeCompare(b))
    return JSON.stringify({
      m: shape.method.toUpperCase(),
      u: shape.url,
      b: shape.body ?? '',
      h: headerEntries,
      p: producedTemplates
    })
  }

  private isExpired(entry: CacheEntry): boolean {
    if (entry.ttlMs === undefined) return false
    return Date.now() - entry.storedAt >= entry.ttlMs
  }

  private evaluateExpiration(
    expression: string | undefined,
    body: unknown
  ): number | undefined {
    if (!expression?.trim()) return undefined
    const rendered = this.safeRender(expression, body)
    if (!rendered) return undefined
    const seconds = Number(rendered)
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined
    return Math.floor(seconds * 1000)
  }

  private safeRender(template: string, context: unknown): string {
    if (!template.includes('{{')) return template
    try {
      const compiled = Handlebars.compile(template, { noEscape: true })
      return compiled(context)
    } catch (err) {
      logger.warn('[AuthenticationCache] handlebars error', {
        template,
        error: String(err)
      })
      return ''
    }
  }

  private emit(phase: AuthPhase, authRequestId: string, reason?: string): void {
    const payload = reason !== undefined
      ? { authRequestId, phase, reason }
      : { authRequestId, phase }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('auth:running', payload)
      if (phase === 'failed') {
        win.webContents.send('auth:failed', { authRequestId, reason })
      }
    }
  }
}

export const authenticationCacheService = new AuthenticationCacheService()
