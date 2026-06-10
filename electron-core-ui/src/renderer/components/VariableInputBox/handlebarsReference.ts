/**
 * Build the `{{ … }}` reference an autocomplete suggestion inserts for a
 * variable named `name`.
 *
 * A bare Handlebars path cannot contain whitespace — `{{Answer to the universe}}`
 * parses as the helper call `Answer` with the args `to`/`the`/`universe`
 * ("Missing helper: Answer"), so the value never resolves. Wrapping the name in
 * single quotes makes Handlebars treat it as one quoted path segment
 * (`{{'Answer to the universe'}}`), which resolves the context key verbatim.
 * Names without whitespace stay bare so the common case reads cleanly.
 */
export function handlebarsReference(name: string): string {
  return /\s/.test(name) ? `{{'${name}'}}` : `{{${name}}}`
}

/**
 * The variable name inside a `{{ … }}` span, for hover lookup — the inverse of
 * {@link handlebarsReference}. A quoted segment (`'a b'` / `"a b"`) is one
 * whitespace-bearing name; otherwise the name is the first whitespace-delimited
 * token (any helper args / sub-expressions after it are ignored).
 */
export function extractVariableName(innerContent: string): string {
  const trimmed = innerContent.trim()
  const quoted = /^'([^']*)'/.exec(trimmed) ?? /^"([^"]*)"/.exec(trimmed)
  if (quoted) return quoted[1] ?? ''
  return trimmed.split(/\s+/)[0] ?? ''
}
