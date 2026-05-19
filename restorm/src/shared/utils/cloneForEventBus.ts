/**
 * Deep-clone a document tree for cross-process delivery (eventBus →
 * main, IPC payloads) while preserving `PasswordValue` plaintext.
 *
 * Why not `JSON.parse(JSON.stringify(...))`: that path runs
 * `PasswordValue.toJSON()` which intentionally strips the secret —
 * great for disk writes (the canonical on-disk shape is
 * `{ type: 'password' }`) but breaks `ContextService` substitution,
 * which needs the plaintext to resolve `{{token}}` headers. Same
 * trap bites `broadcastTreeReplace`: the renderer then receives a
 * password-less tree, calls `setRootItems(reactiveWrap(tree))`, and
 * orphans every plaintext the user had typed in the now-detached
 * previous tree.
 *
 * Why not `structuredClone`: it throws `DataCloneError` on the
 * renderer's reactive Proxies in the Vitest / jsdom environment and
 * on certain class-instance graphs. We can't rely on it cross-env.
 *
 * What this does: recursive copy of own enumerable properties,
 * straight through the Proxy traps (which return the unwrapped data).
 * `toJSON` is never called because we never run JSON serialisation.
 * Class instances arrive on the other side as POJOs with the same
 * `type` + `value` fields — `KeyValue.fromPlain` /
 * `normalizeValueType` re-instantiate them on arrival.
 */
export function cloneForEventBus<T>(value: T): T {
  return walk(value) as T
}

function walk(value: unknown): unknown {
  if (value === null || value === undefined) return value
  const typeOf = typeof value
  if (typeOf !== 'object') return value
  if (value instanceof Date) return new Date(value.getTime())
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length)
    for (let i = 0; i < value.length; i++) {
      out[i] = walk(value[i])
    }
    return out
  }
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = walk((value as Record<string, unknown>)[key])
  }
  return out
}
