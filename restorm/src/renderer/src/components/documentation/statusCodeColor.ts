/**
 * Map an HTTP status code (or OpenAPI status pattern) to the CSS
 * variable that represents its outcome category in the project's
 * theme. Mirrors the green/orange/red palette `outcomeDotColor`
 * uses in `ResponseHistoryTab` so the documentation viewer agrees
 * with the runtime history dots.
 */
export function statusCodeColor(statusCode: string): string {
  const numeric = parseStatusCode(statusCode)
  if (numeric === null) return 'var(--description-foreground, rgba(127, 127, 127, 0.8))'
  if (numeric >= 200 && numeric < 300) return 'var(--testing-iconPassed)'
  if (numeric >= 300 && numeric < 400) return 'var(--editorWarning-foreground)'
  return 'var(--testing-iconFailed)'
}

/**
 * OpenAPI responses can use literal status codes (`"200"`, `"404"`),
 * status patterns (`"2XX"`, `"4XX"`), or the special `"default"`
 * key. This helper folds all three into a representative numeric
 * code for colour-mapping purposes.
 *
 * - Plain code → that code.
 * - `"2XX"` / `"4XX"` → mid-range of the class (`250`, `450`, …).
 * - `"default"` and anything else → `null` (caller falls back to
 *   the neutral colour).
 */
function parseStatusCode(statusCode: string): number | null {
  const trimmed = statusCode.trim().toLowerCase()
  if (/^\d{3}$/.test(trimmed)) return Number.parseInt(trimmed, 10)
  if (/^\dxx$/.test(trimmed)) return Number.parseInt(trimmed[0] ?? '0', 10) * 100 + 50
  return null
}
