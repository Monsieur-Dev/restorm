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
import { logger } from 'electron-core-ui/main'
import type { AuthenticationRequest } from '../../shared/models/requests/AuthenticationRequest'
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
}

/** Callback the cache uses to actually execute an auth request. The
 * HTTP pipeline owns URL composition, headers, body, timeouts, etc.;
 * this service just knows how to call it. */
export type AuthRequestExecutor = (
  request: AuthenticationRequest
) => Promise<HTTPExecutionResult>

class AuthenticationCacheService {
  private entries = new Map<string, CacheEntry>()

  /**
   * Public entry point: return cached headers if fresh, otherwise run
   * the auth request + store the result. Throws when the auth call
   * itself fails so downstream dispatchers can abort cleanly.
   */
  async getHeaders(
    request: AuthenticationRequest,
    executor: AuthRequestExecutor
  ): Promise<Record<string, string>> {
    const existing = this.entries.get(request.id)
    if (existing && !this.isExpired(existing)) {
      return existing.headers
    }
    return this.refresh(request, executor)
  }

  /**
   * Force a refresh (used by the auth-error-code retry-once path).
   * Always runs the auth request, regardless of cache freshness.
   */
  async refresh(
    request: AuthenticationRequest,
    executor: AuthRequestExecutor
  ): Promise<Record<string, string>> {
    this.emit('started', request.id)
    let result: HTTPExecutionResult
    try {
      result = await executor(request)
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
      ...(ttlMs !== undefined ? { ttlMs } : {}),
      ...(body ? { lastResponseBody: body } : {})
    }
    this.entries.set(request.id, entry)
    this.emit('succeeded', request.id)
    return headers
  }

  /** Drop the cached entry for a single request. */
  invalidate(authRequestId: string): void {
    this.entries.delete(authRequestId)
  }

  /** Drop everything — used on workspace close / app restart. */
  clear(): void {
    this.entries.clear()
  }

  /** Test-only inspection hook. */
  hasEntry(authRequestId: string): boolean {
    return this.entries.has(authRequestId)
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
