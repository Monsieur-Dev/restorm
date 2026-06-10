/**
 * Pure value-cast core for the scenario `cast` node — the ONE implementation the
 * RUNTIME (`castExecutor`) and the INSPECTOR PREVIEW (`scenarioStaticPreview`)
 * both call, so the two can never drift (same pattern as `scenarioComparison`).
 *
 * Comparisons and aggregates are STRICT (no coercion: `"5" = 5` → false, a
 * boolean isn't summable, ordering mixed types throws), so `cast` is the
 * explicit escape hatch when a user genuinely wants cross-type behaviour.
 *
 * `castValue` THROWS for any conversion with no meaningful answer — casting a
 * null/empty value, or a pair the matrix doesn't define (e.g. a list → number).
 * The runtime lets that surface on the `error` port; the preview catches it and
 * shows no result. No silent null — an impossible cast is a user mistake to see.
 */
import { tryParseNumberString, epochToDate, tryParseDateOrEpoch } from './utils/valueCasting'

/** The target types a `cast` node can convert TO. A deliberately small set —
 * `list` wraps, the four scalars convert per the matrix below. */
export type ScenarioCastType = 'number' | 'string' | 'boolean' | 'date' | 'list'

export const SCENARIO_CAST_TYPES: readonly ScenarioCastType[] = ['number', 'string', 'boolean', 'date', 'list']

export const isScenarioCastType = (v: unknown): v is ScenarioCastType =>
  typeof v === 'string' && (SCENARIO_CAST_TYPES as readonly string[]).includes(v)

/** The accepted string spellings of a boolean, case-insensitive. Anything else
 * is a real mistake (`"maybe"` → throw), not silently false. */
const TRUE_WORDS = new Set(['true', '1', 'yes', 'on'])
const FALSE_WORDS = new Set(['false', '0', 'no', 'off'])

type SourceKind = 'number' | 'string' | 'boolean' | 'date' | 'list' | 'object'

/** The structural kind of a runtime value. A `Date` instance is `date`; a date
 * that arrived as an ISO STRING stays `string` (the TARGET drives parsing, so
 * `cast(<iso string>, 'date')` parses while `cast(<iso string>, 'number')`
 * rejects). */
function sourceKind(v: unknown): SourceKind {
  if (Array.isArray(v)) return 'list'
  if (v instanceof Date) return 'date'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'string') return 'string'
  return 'object'
}

/** A short, safe label for the source value in a cast error message. */
function label(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'empty'
  if (typeof v === 'string') return `"${v.length > 32 ? `${v.slice(0, 32)}…` : v}"`
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return `a list (${v.length})`
  return 'an object'
}

function fail(value: unknown, target: ScenarioCastType): never {
  throw new Error(`Cannot cast ${label(value)} (${sourceKind(value)}) to ${target}`)
}

/**
 * Convert `value` to `target`, or THROW when the conversion has no meaning.
 *
 * Matrix (source → target):
 * - **any → list**: WRAP into a single-element list `[value]` (no split, even a
 *   list nests into `[list]`).
 * - **→ string**: number / boolean → `String(v)`; date → ISO; string → itself;
 *   list / object → throw.
 * - **→ number**: number → itself; boolean → `1`/`0`; string → parsed (throws if
 *   not numeric); date / list / object → throw.
 * - **→ boolean**: boolean → itself; number → truthiness (`0` → false); string →
 *   `true/false/1/0/yes/no/on/off` (case-insensitive, else throw); date / list /
 *   object → throw.
 * - **→ date**: date → itself; string → parsed `Date` (throws if unparseable);
 *   number → epoch instant (Unix seconds or milliseconds, by magnitude);
 *   boolean / list / object → throw.
 *
 * A null / undefined source ALWAYS throws — casting an empty value is meaningless.
 */
export function castValue(value: unknown, target: ScenarioCastType): unknown {
  if (value === null || value === undefined) {
    throw new Error(`Cannot cast ${label(value)} value`)
  }
  // Anything → list is an unconditional wrap.
  if (target === 'list') return [value]

  const sk = sourceKind(value)
  switch (target) {
    case 'string':
      if (sk === 'string') return value
      if (sk === 'number' || sk === 'boolean') return String(value as number | boolean)
      if (sk === 'date') return (value as Date).toISOString()
      return fail(value, target)

    case 'number': {
      if (sk === 'number') {
        if (!Number.isFinite(value)) fail(value, target)
        return value
      }
      if (sk === 'boolean') return (value as boolean) ? 1 : 0
      if (sk === 'string') {
        const n = tryParseNumberString((value as string).trim())
        if (n === null) throw new Error(`Cannot cast ${label(value)} to number — not a numeric value`)
        return n
      }
      return fail(value, target)
    }

    case 'boolean': {
      if (sk === 'boolean') return value
      if (sk === 'number') return value !== 0 && Number.isFinite(value)
      if (sk === 'string') {
        const w = (value as string).trim().toLowerCase()
        if (TRUE_WORDS.has(w)) return true
        if (FALSE_WORDS.has(w)) return false
        throw new Error(`Cannot cast ${label(value)} to boolean — expected true/false/1/0/yes/no/on/off`)
      }
      return fail(value, target)
    }

    case 'date': {
      if (sk === 'date') return value
      // A number is an epoch instant (Unix seconds or JS milliseconds, by
      // magnitude); a string is either a date string OR a bare epoch number.
      if (sk === 'number') {
        const d = epochToDate(value as number)
        if (d === null) throw new Error(`Cannot cast ${label(value)} to date — not a valid epoch`)
        return d
      }
      if (sk === 'string') {
        const d = tryParseDateOrEpoch(value as string)
        if (d === null) throw new Error(`Cannot cast ${label(value)} to date — not a recognizable date or epoch`)
        return d
      }
      return fail(value, target)
    }
  }
}
