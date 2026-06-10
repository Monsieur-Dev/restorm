/**
 * Pure JSON parse/stringify core for the scenario `json` node — the ONE
 * implementation the RUNTIME (`jsonExecutor`) and the INSPECTOR PREVIEW
 * (`scenarioStaticPreview`) both call, so the two can never drift (same pattern
 * as `scenarioComparison` / `scenarioCast` / `scenarioRegex`).
 *
 * `applyJson` THROWS on invalid input — a malformed JSON string (`parse`) or a
 * non-serialisable value such as a circular structure (`stringify`). The runtime
 * routes that to the `error` port; the preview catches it into "no result".
 */

/** The operations a `json` node can run. */
export type JsonOp = 'parse' | 'stringify'

export const JSON_OPS: readonly JsonOp[] = ['parse', 'stringify']

export const isJsonOp = (v: unknown): v is JsonOp =>
  typeof v === 'string' && (JSON_OPS as readonly string[]).includes(v)

/**
 * Run `op` over `value`.
 *
 * - **parse**: a JSON **string** → its parsed value (object / array / number /
 *   boolean / null). Malformed JSON THROWS. A value that is ALREADY structured
 *   (not a string) is returned as-is, so `parse` is idempotent.
 * - **stringify**: ANY value → a JSON string. `indent > 0` pretty-prints with
 *   that many spaces (capped at 10); `0` is compact. A non-serialisable value
 *   (`undefined` / function / symbol at the top level, or a circular structure)
 *   THROWS.
 */
export function applyJson(value: unknown, op: JsonOp, indent = 0): unknown {
  if (op === 'parse') {
    return typeof value === 'string' ? JSON.parse(value) : value
  }
  // A top-level undefined / function / symbol makes `JSON.stringify` return
  // `undefined` (not a string) — reject those explicitly so the result is always
  // a JSON string. A circular structure makes `JSON.stringify` THROW (propagated).
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('Cannot JSON-stringify this value (undefined / function / symbol)')
  }
  const space = typeof indent === 'number' && indent > 0 ? Math.min(Math.floor(indent), 10) : undefined
  return JSON.stringify(value, null, space)
}
