/**
 * Derive 1–2 uppercase initials from a name or email. Names split on
 * whitespace; emails use the local part (before the first `@`) split on `.`,
 * `_`, `-` and `+`. The first and last meaningful tokens contribute one letter
 * each, so "Yoann Diguet" and "yoann.diguet@x.io" both yield "YD".
 */
export function deriveInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  // For an email, work from the local part (before the first `@`).
  const base = trimmed.includes('@') ? trimmed.slice(0, trimmed.indexOf('@')) : trimmed
  const tokens = base.split(/[\s._\-+]+/u).filter(Boolean)
  if (tokens.length === 0) return '?'
  const first = tokens[0] ?? ''
  const last = tokens[tokens.length - 1] ?? ''
  const initials = tokens.length === 1 ? first.slice(0, 1) : first.slice(0, 1) + last.slice(0, 1)
  return initials.toUpperCase()
}
