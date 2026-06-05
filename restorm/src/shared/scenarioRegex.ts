/**
 * Pure regular-expression core for the scenario `regex` node — the ONE
 * implementation the RUNTIME (`regexExecutor`) and the INSPECTOR PREVIEW
 * (`scenarioStaticPreview`) both call, so the two can never drift (same pattern
 * as `scenarioComparison` / `scenarioCast`).
 *
 * `applyRegex` THROWS for an invalid pattern/flags (`new RegExp` rejects it),
 * which the runtime routes to the `error` port and the preview catches into "no
 * result". A NON-match is never an error — it resolves to `null` / `[]` / `false`
 * / the unchanged string, per the operation.
 */

/** The operations a `regex` node can run. */
export type RegexOp = 'extract' | 'extractAll' | 'test' | 'replace' | 'split'

export const REGEX_OPS: readonly RegexOp[] = ['extract', 'extractAll', 'test', 'replace', 'split']

export const isRegexOp = (v: unknown): v is RegexOp =>
  typeof v === 'string' && (REGEX_OPS as readonly string[]).includes(v)

/** Build the RegExp, forcing the global flag for the all-matches operations
 * (`extractAll` / `replace`) so they don't stop at the first hit. THROWS on an
 * invalid pattern or flag string — the caller turns that into an `error`. */
function buildRegex(pattern: string, flags: string, forceGlobal: boolean): RegExp {
  const f = forceGlobal && !flags.includes('g') ? `${flags}g` : flags
  return new RegExp(pattern, f)
}

/** Coerce the operand to the string the regex runs over: a string passes through,
 * a number/boolean stringifies, an object/array serialises to JSON (so you can
 * match over a JSON body), null/undefined → empty. */
function toInputString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (typeof v === 'object' && v !== null) {
    try {
      return JSON.stringify(v)
    } catch {
      return ''
    }
  }
  return '' // null / undefined / symbol / function
}

/** Reduce one match to its meaningful value: NAMED groups → a `{ name: value }`
 * object; else the first CAPTURE group; else the whole match. A capture group
 * that didn't participate resolves to `null`. */
function shapeMatch(m: RegExpMatchArray | RegExpExecArray): unknown {
  if (m.groups && Object.keys(m.groups).length > 0) return { ...m.groups }
  if (m.length > 1) return m[1] ?? null
  return m[0]
}

/**
 * Run `op` over `value` (coerced to a string) with the given pattern/flags.
 *
 * - **extract**: first match → named-groups object | first capture group | whole
 *   match; no match → `null`.
 * - **extractAll**: a list of the above for every match (global); no match → `[]`.
 * - **test**: `true`/`false` — does the pattern match anywhere?
 * - **replace**: every match replaced by `replacement` (supports `$1` / `$<name>`);
 *   no match → the original string unchanged.
 * - **split**: the string split on the pattern → a list of pieces.
 *
 * THROWS on an invalid pattern/flags (→ `error` port / dropped preview).
 */
export function applyRegex(value: unknown, op: RegexOp, pattern: string, flags = '', replacement = ''): unknown {
  const input = toInputString(value)
  switch (op) {
    case 'test':
      return buildRegex(pattern, flags, false).test(input)
    case 'extract': {
      const m = buildRegex(pattern, flags, false).exec(input)
      return m ? shapeMatch(m) : null
    }
    case 'extractAll': {
      const out: unknown[] = []
      for (const m of input.matchAll(buildRegex(pattern, flags, true))) out.push(shapeMatch(m))
      return out
    }
    case 'replace':
      return input.replace(buildRegex(pattern, flags, true), replacement)
    case 'split':
      return input.split(buildRegex(pattern, flags, false))
  }
}
