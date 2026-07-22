/**
 * Deep-clone a document tree for cross-process delivery (eventBus →
 * main, IPC payloads) while preserving `SecretValue` plaintext.
 *
 * Why not `JSON.parse(JSON.stringify(...))`: that path runs
 * `SecretValue.toJSON()` which intentionally strips the secret —
 * great for disk writes (the canonical on-disk shape is
 * `{ type: 'secret', source, params }`) but breaks `ContextService` substitution,
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
  return walk(value, new WeakMap<object, unknown>()) as T
}

/**
 * `seen` maps each already-visited object/array to its clone. A cyclic
 * reference (an item that, directly or indirectly, points back at an
 * ancestor) would otherwise recurse forever and overflow the stack —
 * fatal on the hot `broadcastTreeReplace` path that every MCP write
 * tool triggers. Returning the in-progress clone on revisit both
 * breaks the cycle and preserves shared-reference identity in the
 * output.
 */
function walk(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || value === undefined) return value
  const typeOf = typeof value
  // Functions and symbols are exactly what `structuredClone` refuses, and
  // the whole point of this helper is to hand IPC something it can ferry.
  // Passing them through unchanged defeats it: the caller gets a
  // "DataCloneError: An object could not be cloned" from deep inside
  // `ipcRenderer.invoke`, with no clue which field carried the function.
  // Reactive-proxy-wrapped documents can expose them (a getter returning a
  // bound helper, a class method surfaced as an own property).
  if (typeOf === 'function' || typeOf === 'symbol') return undefined
  if (typeOf !== 'object') return value
  if (value instanceof Date) return new Date(value.getTime())

  const asObject = value as object
  const existing = seen.get(asObject)
  if (existing !== undefined) return existing

  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length)
    seen.set(asObject, out)
    for (let i = 0; i < value.length; i++) {
      out[i] = walk(value[i], seen)
    }
    return out
  }
  const out: Record<string, unknown> = {}
  seen.set(asObject, out)
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = walk((value as Record<string, unknown>)[key], seen)
  }
  return out
}
