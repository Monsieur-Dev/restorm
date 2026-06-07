/**
 * Pure assertion core for the scenario `assert` node — the richer, "chai-style"
 * operator set layered ON TOP of the shared comparator operators (eq/ne/lt/…
 * from scenarioComparison, reused by if/comparator/filter/while). These extra
 * operators are ASSERT-ONLY (they never leak into the if/comparator palettes):
 * type checks, presence/emptiness, regex match, membership, deep equality and
 * length comparisons. `evalAssert` returns the pass/fail boolean the executor
 * routes to `then`/`else`.
 */

/** The operators an `assert` node can run (shared comparators + assert-only). */
export type AssertOp =
  | 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'
  | 'isString' | 'isNumber' | 'isBoolean' | 'isArray' | 'isObject' | 'isNull'
  | 'exists' | 'isEmpty'
  | 'matchesRegex' | 'isOneOf' | 'deepEquals'
  | 'lengthEq' | 'lengthGt' | 'lengthLt'

/** Operators that read ONLY the actual operand (`expected` is hidden in the box). */
export const ASSERT_UNARY_OPS: readonly AssertOp[] = ['isString', 'isNumber', 'isBoolean', 'isArray', 'isObject', 'isNull', 'exists', 'isEmpty']

/** The shared comparators (delegated to scenarioComparison.compareValues). */
export const ASSERT_SHARED_OPS: readonly AssertOp[] = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains']

/** The assert-only extensions (in box display order). */
export const ASSERT_EXTRA_OPS: readonly AssertOp[] = [
  ...ASSERT_UNARY_OPS, 'matchesRegex', 'isOneOf', 'deepEquals', 'lengthEq', 'lengthGt', 'lengthLt'
]

/** Every operator, in the order shown in the box. */
export const ASSERT_OPS: readonly AssertOp[] = [...ASSERT_SHARED_OPS, ...ASSERT_EXTRA_OPS]

export const isAssertOp = (v: unknown): v is AssertOp =>
  typeof v === 'string' && (ASSERT_OPS as readonly string[]).includes(v)

export const isAssertUnaryOp = (op: string): boolean => (ASSERT_UNARY_OPS as readonly string[]).includes(op)

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Structural deep equality (order-insensitive for object keys). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]))
  }
  return false
}

/** Length of a string / array / object (key count); null for everything else. */
function lengthOf(v: unknown): number | null {
  if (typeof v === 'string' || Array.isArray(v)) return v.length
  if (isPlainObject(v)) return Object.keys(v).length
  return null
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string' || Array.isArray(v)) return v.length === 0
  if (isPlainObject(v)) return Object.keys(v).length === 0
  return false
}

/**
 * Evaluate `op` over the `actual` (and `expected`) operands → pass/fail. A
 * shared comparator falls through to `compareValues` (so the type-aware rules
 * stay one implementation); the assert-only operators are handled here.
 */
export function evalAssert(
  op: string,
  actual: unknown,
  expected: unknown,
  compareValues: (op: string | undefined, l: unknown, r: unknown, lHint?: unknown, rHint?: unknown) => boolean,
  hints?: { a?: unknown; b?: unknown }
): boolean {
  switch (op) {
    case 'isString': return typeof actual === 'string'
    case 'isNumber': return typeof actual === 'number' && Number.isFinite(actual)
    case 'isBoolean': return typeof actual === 'boolean'
    case 'isArray': return Array.isArray(actual)
    case 'isObject': return isPlainObject(actual)
    case 'isNull': return actual === null
    case 'exists': return actual !== null && actual !== undefined
    case 'isEmpty': return isEmptyValue(actual)
    case 'matchesRegex': {
      if (typeof actual !== 'string') return false
      const pattern = typeof expected === 'string' ? expected : ''
      try { return new RegExp(pattern).test(actual) } catch { return false }
    }
    case 'isOneOf': return Array.isArray(expected) && expected.some((x) => deepEqual(x, actual))
    case 'deepEquals': return deepEqual(actual, expected)
    case 'lengthEq': case 'lengthGt': case 'lengthLt': {
      const len = lengthOf(actual)
      const n = typeof expected === 'number' ? expected : Number(typeof expected === 'string' ? expected : NaN)
      if (len === null || !Number.isFinite(n)) return false
      return op === 'lengthEq' ? len === n : op === 'lengthGt' ? len > n : len < n
    }
    default:
      return compareValues(op, actual, expected, hints?.a, hints?.b)
  }
}
