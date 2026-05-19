/**
 * POSIX-shell single-quote escaping. Wraps a value so it survives
 * `bash` / `sh` / `zsh` interpolation verbatim. Single quotes inside
 * the value get the standard `'\''` dance.
 */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * PowerShell single-quoted-string escaping (single-quote literal,
 * `'` doubled inside). Multi-line bodies stay readable; double
 * quotes pass through as-is so JSON inside doesn't double-escape.
 */
export function powershellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
