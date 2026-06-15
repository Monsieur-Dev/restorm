import type { ValueSourceResolver } from '../../../shared/secrets/ValueSource'
import { extractSubKey } from '../../../shared/secrets/ValueSource'
import { SecretValue } from '../../../shared/types/valueTypes/SecretValue'
import { getResolver as defaultGetResolver } from './mainSourceRegistry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Stringify a value with object keys recursively sorted at every level, so
 * structurally-equal values produce byte-identical strings regardless of key
 * insertion order. Arrays keep their order (it is significant); primitives go
 * through `JSON.stringify` untouched.
 */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']'
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const body = Object.keys(obj)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonicalStringify(obj[key]))
      .join(',')
    return '{' + body + '}'
  }
  return JSON.stringify(value)
}

/**
 * Deterministic hash for a (source, params) pair. Params are canonicalised so
 * `{b:1, a:2}` and `{a:2, b:1}` collide, while params differing in any nested
 * field — at any depth — produce distinct hashes.
 */
function stableHash(source: string, params: Record<string, unknown>): string {
  return source + '::' + canonicalStringify(params)
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Resolves SecretValues at run time by delegating to the appropriate
 * ValueSourceResolver.  Results are cached per (scopeId, source+params) pair
 * so a resolver is never called more than once for the same credential within
 * the same scope.
 */
export class SecretHydrationService {
  /** cache[scopeId][hash] = resolved payload */
  private readonly cache = new Map<string, Map<string, unknown>>()

  /**
   * In-flight resolver calls, keyed by `(source, params)` hash — scope-INDEPENDENT.
   * Two concurrent resolutions of the SAME credential under different scopes (e.g.
   * the env-folder hydration under the env id AND the cell preview under
   * `'preview'`) share ONE provider call instead of fetching twice. Ref-counted so
   * the shared call is aborted only when EVERY waiter has aborted — a single
   * waiter cancelling (env supersede / one closed tab) never strands the others.
   */
  private readonly inFlight = new Map<string, { promise: Promise<unknown>; controller: AbortController; refs: number }>()

  constructor(private readonly getResolver: (id: string) => ValueSourceResolver | undefined) {}

  /**
   * Resolve `(source, params)` through the shared in-flight registry: the first
   * caller starts the provider fetch (under its own merged AbortController), later
   * callers await the same promise. Each caller's `signal` decrements the ref on
   * abort; the shared fetch is aborted only when the count reaches zero.
   */
  private resolveDeduped(
    source: string,
    params: Record<string, unknown>,
    hash: string,
    scopeId: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    let entry = this.inFlight.get(hash)
    if (!entry) {
      const resolver = this.getResolver(source)
      if (!resolver) return Promise.reject(new Error(`unknown secret source: ${source}`))
      const controller = new AbortController()
      const promise = Promise.resolve(resolver.read(params, { scopeId, signal: controller.signal }))
      entry = { promise, controller, refs: 0 }
      this.inFlight.set(hash, entry)
      // Drop the entry once settled so the next resolution re-fetches fresh.
      void promise.catch(() => undefined).finally(() => {
        if (this.inFlight.get(hash) === entry) this.inFlight.delete(hash)
      })
    }
    const e = entry
    e.refs += 1
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      e.refs -= 1
      if (e.refs <= 0) e.controller.abort()
    }
    if (signal) {
      if (signal.aborted) release()
      else signal.addEventListener('abort', release, { once: true })
    }
    return e.promise.finally(() => {
      if (signal) signal.removeEventListener('abort', release)
    })
  }

  /**
   * Populate `value.resolved` for every entry in `values`.
   * Hits are served from the per-scope cache; misses call the resolver and
   * populate the cache before continuing.
   */
  async hydrate(scopeId: string, values: SecretValue[], signal?: AbortSignal): Promise<void> {
    let scopeCache = this.cache.get(scopeId)
    if (!scopeCache) {
      scopeCache = new Map()
      this.cache.set(scopeId, scopeCache)
    }

    for (const sv of values) {
      const hash = stableHash(sv.source, sv.params)
      let payload: unknown

      if (scopeCache.has(hash)) {
        payload = scopeCache.get(hash)
      } else {
        // Share a concurrent fetch of the SAME credential (any scope) so a slow
        // secret shown in both the env table AND its cell preview resolves once.
        payload = await this.resolveDeduped(sv.source, sv.params, hash, scopeId, signal)
        scopeCache.set(hash, payload)
      }

      const path = typeof sv.params.path === 'string' ? sv.params.path : undefined
      sv.resolved = extractSubKey(payload, path)
    }
  }

  /**
   * Resolve a single (source, params) pair on demand and return its plaintext.
   * Hydrates a throwaway `SecretValue` so the same per-scope cache + sub-key
   * extraction as a run apply. Used by the renderer's resolve-on-demand preview
   * (the user's own secret — they're allowed to read it back to confirm
   * retrieval works); the value is still never written into the document.
   */
  async resolveOne(
    scopeId: string,
    source: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const sv = new SecretValue(source, params)
    await this.hydrate(scopeId, [sv], signal)
    return sv.resolved ?? ''
  }

  /**
   * SYNCHRONOUS cache lookup for an ALREADY-hydrated (source, params) pair —
   * returns its plaintext (sub-key applied) or `undefined` on a miss. Scans
   * EVERY scope's cache: a `(source, params)` pair resolves to the same secret
   * regardless of which run scope first fetched it, so any cached payload is a
   * valid hit. Backs the main-process scenario-engine `secretPreviewResolver`,
   * which (unlike `hydrate`) must resolve synchronously inside an executor's
   * operand resolution — the engine calls `hydrate` for a node's secrets just
   * before the executor runs, so by the time this peek fires the payload is in
   * the cache. The resolved plaintext lives only in memory, never persisted.
   */
  peekResolved(source: string, params: Record<string, unknown>): string | undefined {
    const hash = stableHash(source, params)
    for (const scopeCache of this.cache.values()) {
      if (scopeCache.has(hash)) {
        const payload = scopeCache.get(hash)
        const path = typeof params.path === 'string' ? params.path : undefined
        return extractSubKey(payload, path)
      }
    }
    return undefined
  }

  /**
   * Remove a single cache entry.  The next `hydrate` call for the same
   * (scopeId, source, params) will re-fetch from the resolver.
   */
  invalidate(scopeId: string, source: string, params: Record<string, unknown>): void {
    const scopeCache = this.cache.get(scopeId)
    if (scopeCache) {
      scopeCache.delete(stableHash(source, params))
    }
  }

  /**
   * Remove the cache entry for a (source, params) pair in EVERY scope. Used by
   * the renderer's per-secret "refresh" action, which doesn't know (or care)
   * which run scope last resolved the credential — it just wants the next
   * resolution to re-fetch from the provider everywhere.
   */
  invalidateAll(source: string, params: Record<string, unknown>): void {
    const hash = stableHash(source, params)
    for (const scopeCache of this.cache.values()) {
      scopeCache.delete(hash)
    }
  }

  /** Drop all cached entries for one scope. */
  clearScope(scopeId: string): void {
    this.cache.delete(scopeId)
  }

  /** Drop every cached entry across all scopes. */
  clearAll(): void {
    this.cache.clear()
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Production singleton wired to the real main-process resolver registry. */
export const secretHydrationService = new SecretHydrationService(defaultGetResolver)
