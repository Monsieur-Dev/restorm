export type ValueKind = 'datetime' | 'numeric' | 'color' | 'string'

export interface DateTimeCast {
  kind: 'datetime'
  date: Date
  format: string
}

export interface NumericCast {
  kind: 'numeric'
  number: number
  format: string
}

export interface ColorCast {
  kind: 'color'
  color: string
}

export interface StringCast {
  kind: 'string'
  value: string
}

export type ValueCastResult = DateTimeCast | NumericCast | ColorCast | StringCast

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
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
