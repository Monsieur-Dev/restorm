/** Render an `unknown` design value (example, default, enum member) as
 * the string a field or cell shows — objects go through JSON so they
 * never degrade to `[object Object]`. */
export function displayValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  // JSON.stringify types as `string` but yields undefined for symbols /
  // functions — coalesce through an unknown-typed local.
  const json: unknown = JSON.stringify(value)
  return typeof json === 'string' ? json : ''
}
