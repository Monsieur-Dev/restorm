import { DateTime } from 'luxon'

interface DateTimeCast {
  kind: 'datetime'
  date: Date
  format: string
}

interface NumericCast {
  kind: 'numeric'
  number: number
  format: string
}

interface ColorCast {
  kind: 'color'
  color: string
}

interface StringCast {
  kind: 'string'
  value: string
}

export type ValueCastResult = DateTimeCast | NumericCast | ColorCast | StringCast

/** Matches `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` hex colour strings — the format
 * documented on every persisted `color` field (e.g. `Environment.color`). */
export const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const NUMBER_REGEX = /^[-+]?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][-+]?\d+)?$/

function looksLikeIsoDate(value: string): boolean {
  if (value.includes('://')) return false

  // Strict-ish checks to avoid false positives (e.g. URLs with ":" or random strings).
  // Supported examples:
  // - 2026-01-13
  // - 2026-01-13T12:34
  // - 2026-01-13T12:34:56Z
  // - 2026-01-13 12:34:56
  const isoLike =
    /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
      value
    )

  const slashLike =
    /^\d{4}\/\d{2}\/\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/.test(value)

  return isoLike || slashLike
}

export function tryParseDateString(value: string): Date | null {
  if (!looksLikeIsoDate(value)) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

export function tryParseNumberString(value: string): number | null {
  if (!NUMBER_REGEX.test(value)) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n
}

/** Interpret a finite number as an epoch instant. A magnitude ≥ 1e12 is read as
 * milliseconds (JS `Date.getTime()` ≈ 1.7e12 today); anything smaller is read as
 * Unix SECONDS (≈ 1.7e9 today). One heuristic covers both common epoch flavours
 * for any realistic timestamp. Parsing is delegated to luxon (the same library
 * the DateTimePicker uses), so epoch + ISO handling stays consistent app-wide.
 * `null` when the number isn't finite / overflows the Date range. */
export function epochToDate(value: number): Date | null {
  if (!Number.isFinite(value)) return null
  const dt = Math.abs(value) >= 1e12 ? DateTime.fromMillis(value) : DateTime.fromSeconds(value)
  return dt.isValid ? dt.toJSDate() : null
}

/** Parse a string into a Date from EITHER a bare epoch number (seconds or ms,
 * via {@link epochToDate}) OR a date string parsed by luxon — ISO 8601, or the
 * SQL-ish `YYYY-MM-DD HH:mm:ss` form (a space between date and time is
 * normalised to `T`). `null` when it is neither — so callers can reject / fall
 * through. Uses luxon rather than a hand-rolled regex so the cast and the
 * DateTimePicker share one battle-tested parser. */
export function tryParseDateOrEpoch(value: string): Date | null {
  const trimmed = value.trim()
  if (/^[-+]?\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    return Number.isFinite(n) ? epochToDate(n) : null
  }
  const dt = DateTime.fromISO(trimmed.replace(' ', 'T'))
  return dt.isValid ? dt.toJSDate() : null
}

export function isHexColorString(value: string): boolean {
  return HEX_COLOR_REGEX.test(value)
}

export function inferValueFromString(rawValue: string): ValueCastResult {
  const trimmed = rawValue.trim()

  const date = tryParseDateString(trimmed)
  if (date) {
    const hasTime = trimmed.includes('T') || trimmed.includes(':')
    const format = hasTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'
    return { kind: 'datetime', date, format }
  }

  const num = tryParseNumberString(trimmed)
  if (num !== null) {
    return { kind: 'numeric', number: num, format: 'decimal' }
  }

  if (isHexColorString(trimmed)) {
    return { kind: 'color', color: trimmed }
  }

  return { kind: 'string', value: rawValue }
}
