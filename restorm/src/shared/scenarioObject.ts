/**
 * Pure object-operations core for the scenario `objectOp` node — the ONE
 * implementation the RUNTIME (`objectOpExecutor`) and the INSPECTOR PREVIEW
 * (`scenarioStaticPreview`) both call, so the two can never drift (same pattern
 * as `scenarioJson` / `scenarioCrypto`).
 *
 * Distinct from the `object` BUILDER node (which assembles an object from named
 * property inputs): this RESHAPES an existing object — read/write a dot-path,
 * merge, pick/omit keys, or list its keys/values. `applyObjectOp` THROWS when
 * the operand isn't an object (where the op needs one); the runtime routes that
 * to the `error` port and the preview catches it into "no result".
 */

/** The operations an `objectOp` node can run. */
export type ObjectOp = 'get' | 'set' | 'merge' | 'pick' | 'omit' | 'keys' | 'values'

export const OBJECT_OPS: readonly ObjectOp[] = ['get', 'set', 'merge', 'pick', 'omit', 'keys', 'values']

export const isObjectOp = (v: unknown): v is ObjectOp =>
  typeof v === 'string' && (OBJECT_OPS as readonly string[]).includes(v)

type Obj = Record<string, unknown>

const isPlainObject = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)

function requireObject(v: unknown, op: ObjectOp): Obj {
  if (!isPlainObject(v)) throw new Error(`objectOp "${op}" expects an object`)
  return v
}

/** Read `obj.a.b.c` by dot-path; missing segment → undefined. */
function getByPath(obj: unknown, path: string): unknown {
  if (path === '') return obj
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (!isPlainObject(cur) && !Array.isArray(cur)) return undefined
    cur = (cur as Obj)[seg]
  }
  return cur
}

/** Immutable set: returns a shallow-cloned object with `obj.a.b.c = value`
 * (intermediate objects created as needed). */
function setByPath(obj: Obj, path: string, value: unknown): Obj {
  const segs = path.split('.').filter((s) => s !== '')
  const root: Obj = { ...obj }
  if (segs.length === 0) return root
  const lastIdx = segs.length - 1
  let cur: Obj = root
  let i = 0
  // for-of yields `string` (not `string | undefined`), so no index assertion.
  for (const seg of segs) {
    if (i === lastIdx) {
      cur[seg] = value
    } else {
      const next = cur[seg]
      const cloned: Obj = isPlainObject(next) ? { ...next } : {}
      cur[seg] = cloned
      cur = cloned
    }
    i++
  }
  return root
}

export interface ObjectOpOptions {
  path?: string
  keys?: string[]
  other?: unknown
}

/**
 * Run `op` over `value`.
 *
 * - **get**: the value at dot-`path` (missing → null).
 * - **set**: a clone of the object with dot-`path` set to `other`.
 * - **merge**: a shallow merge of the object with the `other` object (`other`
 *   wins).
 * - **pick / omit**: a copy keeping / dropping the listed `keys`.
 * - **keys / values**: the object's own keys / values as a list.
 */
export function applyObjectOp(value: unknown, op: ObjectOp, opts: ObjectOpOptions = {}): unknown {
  switch (op) {
    case 'get': {
      const got = getByPath(value, opts.path ?? '')
      return got === undefined ? null : got
    }
    case 'set':
      return setByPath(requireObject(value, op), opts.path ?? '', opts.other)
    case 'merge': {
      const base = requireObject(value, op)
      const other = isPlainObject(opts.other) ? opts.other : {}
      return { ...base, ...other }
    }
    case 'pick': {
      const obj = requireObject(value, op)
      const out: Obj = {}
      for (const k of opts.keys ?? []) if (k in obj) out[k] = obj[k]
      return out
    }
    case 'omit': {
      const obj = requireObject(value, op)
      const drop = new Set(opts.keys ?? [])
      const out: Obj = {}
      for (const [k, v] of Object.entries(obj)) if (!drop.has(k)) out[k] = v
      return out
    }
    case 'keys':
      return Object.keys(requireObject(value, op))
    case 'values':
      return Object.values(requireObject(value, op))
  }
}
