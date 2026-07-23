/**
 * User-facing date formatting, driven by the `behavior:dateTimeFormat`
 * setting ('us' | 'iso'). Every place that renders a date/time TO THE USER
 * (as opposed to a scenario value, a template output, or an internal
 * timing/id) should format through this helper so the setting is honoured
 * consistently across the app.
 */

export type DateTimeFormat = 'us' | 'iso'

export interface FormatUserDateOptions {
  /** Render only the time part (used for streamed event timestamps). */
  timeOnly?: boolean
}

/**
 * Formats `date` for display according to `dateTimeFormat`:
 * - `'iso'`: `YYYY-MM-DD HH:mm:ss` (or `HH:mm:ss` alone for `timeOnly`), 24h.
 * - `'us'`: `Intl.DateTimeFormat(locale, …)`, 12h/24h per the locale's convention.
 */
export function formatUserDate(
  date: Date,
  dateTimeFormat: DateTimeFormat,
  locale: string,
  opts?: FormatUserDateOptions
): string {
  const timeOnly = opts?.timeOnly ?? false

  if (dateTimeFormat === 'iso') {
    const h = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    const time = `${h}:${min}:${s}`
    if (timeOnly) return time
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${String(y)}-${m}-${d} ${time}`
  }

  if (timeOnly) {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date)
  }

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}
