/**
 * Pure random/faker core for the scenario `random` node — the ONE
 * implementation the RUNTIME (`randomExecutor`) and the INSPECTOR PREVIEW
 * (`scenarioStaticPreview`) both call.
 *
 * A `seed` makes the output DETERMINISTIC (a small mulberry32 PRNG) — used by
 * the demo + golden and by anyone who wants reproducible test data. With no
 * seed it falls back to `Math.random` (genuinely random; the preview then shows
 * a fresh sample each render). `applyRandom` THROWS only for `pick` on an empty
 * list; the runtime routes that to the `error` port.
 */

/** The operations a `random` node can run. */
export type RandomOp = 'int' | 'float' | 'string' | 'boolean' | 'pick'

export const RANDOM_OPS: readonly RandomOp[] = ['int', 'float', 'string', 'boolean', 'pick']

export const isRandomOp = (v: unknown): v is RandomOp =>
  typeof v === 'string' && (RANDOM_OPS as readonly string[]).includes(v)

/** Ops that read the numeric min/max range. */
export const RANDOM_OPS_WITH_RANGE: readonly RandomOp[] = ['int', 'float']

/** Deterministic, well-distributed 32-bit PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a string hash → a 32-bit seed, so a string `seed` is reproducible. */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function makeRng(seed: unknown): () => number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return mulberry32(Math.floor(seed))
  if (typeof seed === 'string' && seed !== '') return mulberry32(hashString(seed))
  return Math.random
}

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export interface RandomOptions {
  min?: number | undefined
  max?: number | undefined
  length?: number | undefined
  seed?: unknown
  items?: unknown[] | undefined
}

/**
 * Run `op`.
 *
 * - **int**: integer in `[min, max]` (inclusive; defaults 0..100).
 * - **float**: real in `[min, max)` (defaults 0..1).
 * - **string**: an alphanumeric string of `length` chars (default 16).
 * - **boolean**: a coin flip.
 * - **pick**: a random element of `items` (THROWS if empty).
 */
export function applyRandom(op: RandomOp, opts: RandomOptions = {}): unknown {
  const rng = makeRng(opts.seed)
  switch (op) {
    case 'int': {
      const lo = Math.floor(typeof opts.min === 'number' ? opts.min : 0)
      const hi = Math.floor(typeof opts.max === 'number' ? opts.max : 100)
      const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
      return a + Math.floor(rng() * (b - a + 1))
    }
    case 'float': {
      const lo = typeof opts.min === 'number' ? opts.min : 0
      const hi = typeof opts.max === 'number' ? opts.max : 1
      return lo + rng() * (hi - lo)
    }
    case 'string': {
      const len = typeof opts.length === 'number' && opts.length > 0 ? Math.floor(opts.length) : 16
      let s = ''
      for (let i = 0; i < len; i++) s += ALPHANUM.charAt(Math.floor(rng() * ALPHANUM.length))
      return s
    }
    case 'boolean':
      return rng() < 0.5
    case 'pick': {
      const items = opts.items ?? []
      if (items.length === 0) throw new Error('random "pick" needs a non-empty list')
      return items[Math.floor(rng() * items.length)]
    }
  }
}
