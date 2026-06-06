/**
 * Pure scalar-math core for the scenario `math` node — the ONE implementation
 * the RUNTIME (`mathExecutor`) and the INSPECTOR PREVIEW (`scenarioStaticPreview`)
 * both call, so the two can never drift (same pattern as `scenarioObject` /
 * `scenarioUrl`).
 *
 * Complements the `arithmetic` node (which only does `a op b` for + - * / % ^):
 * this covers the unary functions (round/floor/ceil/trunc/abs/sign/sqrt) plus
 * the two-operand `min`/`max` and the three-operand `clamp`. `applyMath` THROWS
 * on a non-finite operand (or a negative `sqrt`); the runtime routes that to the
 * `error` port and the preview catches it into "no result".
 */

/** The operations a `math` node can run. */
export type MathOp = 'round' | 'floor' | 'ceil' | 'trunc' | 'abs' | 'sign' | 'sqrt' | 'min' | 'max' | 'clamp'

export const MATH_OPS: readonly MathOp[] = ['round', 'floor', 'ceil', 'trunc', 'abs', 'sign', 'sqrt', 'min', 'max', 'clamp']

export const isMathOp = (v: unknown): v is MathOp =>
  typeof v === 'string' && (MATH_OPS as readonly string[]).includes(v)

/** Ops that read a second operand `b`. */
export const MATH_BINARY_OPS: readonly MathOp[] = ['min', 'max']
/** The op that reads `min` + `max` bounds. */
export const MATH_CLAMP_OP: MathOp = 'clamp'

function requireNumber(v: unknown, label: string, op: MathOp): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) throw new Error(`math "${op}" expects a finite number for ${label}`)
  return n
}

export interface MathOptions {
  /** Second operand for min / max. */
  b?: unknown
  /** Lower / upper bounds for clamp. */
  min?: unknown
  max?: unknown
  /** Decimal places for round (default 0). */
  precision?: number | undefined
}

/**
 * Run `op` over the operand `a`.
 *
 * - **round**: half-up to `precision` decimals (default 0).
 * - **floor / ceil / trunc**: toward −∞ / +∞ / zero.
 * - **abs / sign / sqrt**: magnitude / −1·0·1 / square root (negative → error).
 * - **min / max**: the smaller / larger of `a` and `b`.
 * - **clamp**: `a` pinned into `[min, max]`.
 */
export function applyMath(a: unknown, op: MathOp, opts: MathOptions = {}): number {
  const x = requireNumber(a, 'a', op)
  switch (op) {
    case 'round': {
      const p = typeof opts.precision === 'number' && Number.isFinite(opts.precision) ? Math.trunc(opts.precision) : 0
      const f = 10 ** p
      return Math.round(x * f) / f
    }
    case 'floor':
      return Math.floor(x)
    case 'ceil':
      return Math.ceil(x)
    case 'trunc':
      return Math.trunc(x)
    case 'abs':
      return Math.abs(x)
    case 'sign':
      return Math.sign(x)
    case 'sqrt':
      if (x < 0) throw new Error('math "sqrt" expects a non-negative number')
      return Math.sqrt(x)
    case 'min':
      return Math.min(x, requireNumber(opts.b, 'b', op))
    case 'max':
      return Math.max(x, requireNumber(opts.b, 'b', op))
    case 'clamp': {
      const lo = requireNumber(opts.min, 'min', op)
      const hi = requireNumber(opts.max, 'max', op)
      if (lo > hi) throw new Error('math "clamp" expects min ≤ max')
      return Math.min(Math.max(x, lo), hi)
    }
  }
}
