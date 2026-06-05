/**
 * Pure date-math core for the scenario `datetime` node — the ONE implementation
 * the RUNTIME (`dateTimeExecutor`) and the INSPECTOR PREVIEW
 * (`scenarioStaticPreview`) both call, so the two can never drift (same pattern
 * as `scenarioCast` / `scenarioRegex` / `scenarioJson` / `scenarioCrypto`).
 *
 * It TRANSFORMS an existing date wired into `value` — it does NOT read the
 * clock (that is the separate `now` node). Built on luxon (already a restorm
 * dep, shared with the DateTimePicker + the `cast → date` path), reusing the
 * same epoch/ISO tolerance via `tryParseDateOrEpoch` / `epochToDate`.
 *
 * `applyDateTime` THROWS when `value` (or the `other` operand of `diff`) cannot
 * be read as a date. The runtime routes that to the `error` port; the preview
 * catches it into "no result".
 */
import { DateTime } from 'luxon'
import { epochToDate, tryParseDateOrEpoch } from './utils/valueCasting'

/** The operations a `datetime` node can run over a wired date. */
export type DateTimeOp = 'add' | 'subtract' | 'format' | 'diff'

export const DATETIME_OPS: readonly DateTimeOp[] = ['add', 'subtract', 'format', 'diff']

export const isDateTimeOp = (v: unknown): v is DateTimeOp =>
  typeof v === 'string' && (DATETIME_OPS as readonly string[]).includes(v)

/** Duration units for add / subtract / diff (luxon plural keys). */
export type DateTimeUnit =
  | 'milliseconds'
  | 'seconds'
  | 'minutes'
  | 'hours'
  | 'days'
  | 'weeks'
  | 'months'
  | 'years'

export const DATETIME_UNITS: readonly DateTimeUnit[] = [
  'milliseconds',
  'seconds',
  'minutes',
  'hours',
  'days',
  'weeks',
  'months',
  'years'
]

export const isDateTimeUnit = (v: unknown): v is DateTimeUnit =>
  typeof v === 'string' && (DATETIME_UNITS as readonly string[]).includes(v)

/** `add`/`subtract`/`diff` carry an amount + unit; `format` carries a luxon
 * pattern; `diff` carries the second date as `other`. */
export interface DateTimeOptions {
  amount?: number
  unit?: DateTimeUnit
  format?: string
  other?: unknown
}

function label(v: unknown): string {
  if (typeof v === 'string') return `"${v}"`
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v === null || v === undefined) return String(v)
  return 'a value'
}

/** Read any operand as a luxon `DateTime`: a JS `Date`, an epoch number (Unix
 * seconds or ms, by magnitude), or a date string (ISO / SQL-ish / bare epoch).
 * Rendered in UTC so the output ISO ends in `Z` and the result is independent of
 * the host timezone (deterministic in tests + consistent with the `now` node).
 * THROWS if none of those parse. */
function toDateTime(value: unknown): DateTime {
  const opts = { zone: 'utc' } as const
  if (value instanceof Date) return DateTime.fromJSDate(value, opts)
  if (typeof value === 'number') {
    const d = epochToDate(value)
    if (d) return DateTime.fromJSDate(d, opts)
  }
  if (typeof value === 'string') {
    const d = tryParseDateOrEpoch(value.trim())
    if (d) return DateTime.fromJSDate(d, opts)
  }
  throw new Error(`Cannot read ${label(value)} as a date`)
}

/**
 * Run `op` over the `value` date.
 *
 * - **add / subtract**: shift by `amount` of `unit` → an ISO 8601 string.
 * - **format**: render with a luxon `format` pattern (e.g. `yyyy-LL-dd`); an
 *   empty pattern falls back to ISO 8601.
 * - **diff**: `other − value` expressed in `unit` → a number (positive when
 *   `other` is later than `value`).
 */
export function applyDateTime(value: unknown, op: DateTimeOp, opts: DateTimeOptions = {}): string | number {
  const dt = toDateTime(value)
  const unit: DateTimeUnit = isDateTimeUnit(opts.unit) ? opts.unit : 'days'
  const amount = typeof opts.amount === 'number' && Number.isFinite(opts.amount) ? opts.amount : 0

  switch (op) {
    case 'add':
    case 'subtract': {
      const shifted = op === 'add' ? dt.plus({ [unit]: amount }) : dt.minus({ [unit]: amount })
      const iso = shifted.toISO()
      if (iso === null) throw new Error('Date arithmetic produced an invalid date')
      return iso
    }
    case 'format': {
      const pattern = typeof opts.format === 'string' ? opts.format : ''
      if (pattern === '') {
        const iso = dt.toISO()
        if (iso === null) throw new Error('Cannot format an invalid date')
        return iso
      }
      return dt.toFormat(pattern)
    }
    case 'diff': {
      const other = toDateTime(opts.other)
      return other.diff(dt, unit).as(unit)
    }
  }
}
