import { SecretValue } from '../../../shared/types/valueTypes/SecretValue'

/**
 * Deep-walk an arbitrary scenario-node config and collect every persisted
 * `SecretValue` reference as a hydratable {@link SecretValue} instance.
 *
 * A scenario loads from disk as plain JSON, so a secret operand is a bare
 * `{ type: 'secret', source, params }` object, NOT an instantiated
 * `SecretValue` — `concreteValue`'s `'secret'` case reads those fields and
 * defers to the injected `secretPreviewResolver`. The scenario engine hydrates
 * the cache for these BEFORE an executor runs (so the synchronous resolver hits
 * a populated cache), mirroring how the request-execution path collects a
 * request's KeyValue secrets via `collectRequestSecrets`.
 *
 * Returns throwaway `SecretValue` instances (their `.resolved` is irrelevant —
 * `SecretHydrationService.hydrate` only needs `source` + `params` to populate
 * its per-scope cache, which the engine then reads back via `peekResolved`).
 * Duplicate (source, params) pairs are kept; the hydration cache dedupes them.
 */
export function collectConfigSecrets(config: unknown): SecretValue[] {
  const out: SecretValue[] = []
  const seen = new Set<unknown>()
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    const obj = node as Record<string, unknown>
    if (obj.type === 'secret' && typeof obj.source === 'string') {
      const params = obj.params !== null && typeof obj.params === 'object' ? (obj.params as Record<string, unknown>) : {}
      out.push(new SecretValue(obj.source, params))
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    for (const value of Object.values(obj)) walk(value)
  }
  walk(config)
  return out
}
