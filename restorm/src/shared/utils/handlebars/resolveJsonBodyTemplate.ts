import Handlebars from 'handlebars'
import { resolveWithContextPriority } from './resolveWithContextPriority'

/**
 * Does this Content-Type designate a JSON payload? Matches `application/json`,
 * `text/json` and every structured suffix (`application/vnd.api+json`, …),
 * ignoring parameters (`; charset=utf-8`). Anything else — XML, plain text, an
 * absent header — is NOT JSON, and its body keeps the raw whole-template
 * substitution it has always had.
 */
export function isJsonContentType(contentType: string | undefined): boolean {
  if (contentType === undefined || contentType === '') return false
  const mime = (contentType.split(';')[0] ?? '').trim().toLowerCase()
  return mime === 'application/json' || mime === 'text/json' || mime.endsWith('+json')
}

/** Mustache prefixes this resolver deliberately does not tokenize. */
const UNSUPPORTED_SIGILS = ['#', '/', '^', '!', '>', '&']

interface Span {
  /** Index of the opening `{{`. */
  start: number
  /** Index just past the closing `}}`. */
  end: number
  /** Whether the span sits inside a JSON string literal. */
  inString: boolean
}

/**
 * Resolve a Handlebars template that is also a JSON document, without letting
 * the two brace syntaxes corrupt each other.
 *
 * Compiling a JSON body as ONE template has two failure modes:
 *
 *  1. **Tight-brace collision.** `{"id":{{petId}}}` — an unquoted variable as
 *     the last value of an object — reads to Handlebars as `{{petId}}}`, a
 *     parse error. The caller catches it and ships the body with `{{petId}}`
 *     unresolved: the "variables don't work in bodies" symptom.
 *  2. **No JSON escaping.** `{"name":"{{name}}"}` with a value containing `"`,
 *     `\`, a newline or a control char produces syntactically invalid JSON.
 *
 * So instead of compiling the document, this scans it for `{{ … }}` spans and
 * evaluates each span on its own through `resolveWithContextPriority` (which
 * keeps the full helper suite and the variable-wins-over-helper rewrite). The
 * JSON braces around a span are never handed to the parser, and each resolved
 * value is injected according to its position:
 *
 *  - **inside a JSON string** → JSON-escaped, so the document stays valid;
 *  - **in a bare value position** → injected verbatim, so types survive
 *    (`{"n":{{count}}}` with `count` = 3 yields `{"n":3}`, not `{"n":"3"}`).
 *
 * Scope is inline mustaches and helper calls. A construct this scanner does not
 * tokenize — triple-stache, block/inverse/partial/comment sigils, an
 * unterminated `{{` — makes the whole call fall back to the plain whole-body
 * compile, i.e. exactly the behaviour such a body has today (no escaping).
 * A span that fails to evaluate throws, which likewise leaves the caller with
 * its existing raw-value fallback: the output of every body form that resolves
 * today is byte-for-byte unchanged. A span naming an unknown variable stays
 * empty, exactly as the whole-template compile leaves it — even where that
 * empties a bare value position.
 */
export function resolveJsonBodyTemplate(
  template: string,
  context: Record<string, unknown>,
  hb: typeof Handlebars = Handlebars
): string {
  if (!template.includes('{{')) return template

  const spans = scanSpans(template)
  if (spans === null) {
    // Unsupported construct: hand the whole document to the legacy path.
    return resolveWithContextPriority(template, context, hb)
  }
  if (spans.length === 0) return template

  let out = ''
  let cursor = 0
  for (const span of spans) {
    out += template.slice(cursor, span.start)
    const resolved = resolveWithContextPriority(template.slice(span.start, span.end), context, hb)
    out += span.inString ? escapeJsonStringContent(resolved) : resolved
    cursor = span.end
  }
  return out + template.slice(cursor)
}

/**
 * JSON-escape a value for injection INSIDE an existing pair of quotes: stringify
 * it, then drop the quotes `JSON.stringify` added. A value with no special
 * character comes back unchanged, which is what keeps already-working bodies
 * byte-identical.
 */
function escapeJsonStringContent(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

/**
 * Locate every `{{ … }}` span and record whether it sits inside a JSON string.
 * Returns `null` when the document contains a construct this scanner refuses to
 * tokenize, signalling the caller to fall back to a whole-document compile.
 */
function scanSpans(template: string): Span[] | null {
  const spans: Span[] = []
  let inString = false
  let i = 0

  while (i < template.length) {
    const ch = template[i]

    if (ch === '{' && template[i + 1] === '{') {
      const end = findSpanEnd(template, i)
      if (end === null) return null
      spans.push({ start: i, end, inString })
      i = end
      continue
    }

    if (inString) {
      // A backslash escapes the next character — including the `"` that would
      // otherwise close the string.
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i += 1
      continue
    }

    if (ch === '"') inString = true
    i += 1
  }

  return spans
}

/**
 * Find the index just past the `}}` closing the span that opens at `start`, or
 * `null` for a construct left to the legacy path (triple-stache, block / inverse
 * / partial / comment sigil, unterminated span).
 *
 * The search steps over quoted helper arguments — between `{{` and `}}` a quote
 * is an argument delimiter by the Handlebars grammar — so `{{concat "a}}b"}}`
 * closes on its real `}}`. Everywhere else the first `}}` wins, which is what
 * makes `{"id":{{petId}}}` stop before the object's own closing brace.
 */
function findSpanEnd(template: string, start: number): number | null {
  if (template[start + 2] === '{') return null

  let i = start + 2
  while (i < template.length && /\s/.test(template[i] ?? '')) i += 1
  const sigil = template[i]
  if (sigil !== undefined && UNSUPPORTED_SIGILS.includes(sigil)) return null

  i = start + 2
  while (i < template.length) {
    const ch = template[i]
    if (ch === '"' || ch === "'") {
      i = skipQuotedArgument(template, i)
      continue
    }
    if (ch === '}' && template[i + 1] === '}') return i + 2
    i += 1
  }
  return null
}

/** Step over a quoted helper argument starting at `start`, honouring backslash
 * escapes. Returns the index just past the closing quote (or the end of the
 * string when it is unterminated). */
function skipQuotedArgument(template: string, start: number): number {
  const quote = template[start]
  let i = start + 1
  while (i < template.length) {
    const ch = template[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i += 1
  }
  return i
}
