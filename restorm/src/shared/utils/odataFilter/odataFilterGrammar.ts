/**
 * A tiny, hand-rolled tokenizer + cursor classifier for OData v4
 * `$filter` expressions. Pure and Monaco-free so it can be unit-tested
 * in isolation and reused by the Monaco language contribution.
 *
 * The grammar we recognise is the common subset of the OData v4 URL
 * Conventions §5.1.1 filter syntax:
 *
 *   filter      := clause ( logical clause )*
 *   clause      := '(' filter ')' | function | comparison | 'not' clause
 *   comparison  := propertyPath operator value
 *   function    := name '(' args ')'
 *   operator    := 'eq'|'ne'|'gt'|'ge'|'lt'|'le'|'has'|'in'
 *   logical     := 'and'|'or'
 *   propertyPath:= name ( '/' name )*
 *   value       := string | number | boolean | null | guid | datetime
 *
 * `{{env.var}}` Handlebars spans are tokenised as opaque `template`
 * tokens — the classifier and validation treat them as a literal value
 * so env templating keeps working inside `$filter` and the editor never
 * flags the contents of a template span.
 */

/** Comparison operators (binary, property → value). */
export const COMPARISON_OPERATORS = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'has', 'in'] as const

/** Boolean connectors between clauses. */
export const LOGICAL_OPERATORS = ['and', 'or'] as const

/** Unary negation. */
export const UNARY_OPERATORS = ['not'] as const

/** Built-in canonical filter functions recognised for completion +
 * highlighting. The string-only subset is gated by property type in
 * the metadata layer; this list is the lexical universe. */
export const FILTER_FUNCTIONS = [
  'contains',
  'endswith',
  'startswith',
  'length',
  'indexof',
  'substring',
  'tolower',
  'toupper',
  'trim',
  'concat',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'date',
  'time',
  'now',
  'round',
  'floor',
  'ceiling'
] as const

/** Literal keywords recognised as values. */
export const VALUE_KEYWORDS = ['true', 'false', 'null'] as const

export type FilterTokenType =
  | 'identifier' // a name segment / property / function name (context decides)
  | 'operator' // comparison operator (eq, ne, …)
  | 'logical' // and / or
  | 'unary' // not
  | 'function' // a recognised function name immediately followed by '('
  | 'string' // 'quoted literal'
  | 'number' // 42 / 3.14 / -1
  | 'keyword' // true / false / null
  | 'guid' // 12345678-1234-1234-1234-123456789abc
  | 'datetime' // ISO-ish date / datetime literal
  | 'template' // {{env.var}} opaque span
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'slash' // navigation path separator
  | 'whitespace'
  | 'unknown'

export interface FilterToken {
  type: FilterTokenType
  /** Raw source text of the token. */
  value: string
  /** 0-based inclusive start offset in the source string. */
  start: number
  /** 0-based exclusive end offset in the source string. */
  end: number
}

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

const COMPARISON_SET: ReadonlySet<string> = new Set(COMPARISON_OPERATORS)
const LOGICAL_SET: ReadonlySet<string> = new Set(LOGICAL_OPERATORS)
const UNARY_SET: ReadonlySet<string> = new Set(UNARY_OPERATORS)
const FUNCTION_SET: ReadonlySet<string> = new Set(FILTER_FUNCTIONS)
const KEYWORD_SET: ReadonlySet<string> = new Set(VALUE_KEYWORDS)

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch)
}

function isIdentifierPart(ch: string): boolean {
  return /[A-Za-z0-9_.]/.test(ch)
}

/**
 * Tokenise a `$filter` string into a flat token stream with source
 * positions. Whitespace tokens are included so the classifier can
 * reason about "the cursor sits in the gap after an operator".
 *
 * The tokenizer never throws on malformed input — an unrecognised
 * character becomes an `unknown` token so a half-typed expression
 * still classifies.
 */
export function tokenizeFilter(text: string): FilterToken[] {
  const tokens: FilterToken[] = []
  let i = 0
  const n = text.length

  const push = (type: FilterTokenType, start: number, end: number): void => {
    tokens.push({ type, value: text.slice(start, end), start, end })
  }

  while (i < n) {
    const ch = text.charAt(i)

    // Handlebars template span — opaque from '{{' to the next '}}'.
    if (ch === '{' && text[i + 1] === '{') {
      const close = text.indexOf('}}', i + 2)
      const end = close === -1 ? n : close + 2
      push('template', i, end)
      i = end
      continue
    }

    if (/\s/.test(ch)) {
      let j = i + 1
      while (j < n && /\s/.test(text.charAt(j))) j++
      push('whitespace', i, j)
      i = j
      continue
    }

    if (ch === '(') {
      push('lparen', i, i + 1)
      i++
      continue
    }
    if (ch === ')') {
      push('rparen', i, i + 1)
      i++
      continue
    }
    if (ch === ',') {
      push('comma', i, i + 1)
      i++
      continue
    }
    if (ch === '/') {
      push('slash', i, i + 1)
      i++
      continue
    }

    // String literal — single-quoted, '' is an escaped quote.
    if (ch === "'") {
      let j = i + 1
      while (j < n) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            j += 2
            continue
          }
          j++
          break
        }
        j++
      }
      push('string', i, j)
      i = j
      continue
    }

    // GUID literal — checked before the number branch because a GUID
    // starts with hex digits and would otherwise be eaten as a number.
    if (/[0-9a-fA-F]/.test(ch)) {
      const rest = text.slice(i)
      const guidMatch = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.exec(rest)
      if (guidMatch) {
        const end = i + guidMatch[0].length
        push('guid', i, end)
        i = end
        continue
      }
    }

    // Number (optionally signed, decimal, exponent). A leading '-' is
    // only a number sign when followed by a digit; otherwise it falls
    // through to `unknown`.
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(text[i + 1] ?? ''))) {
      let j = i + 1
      while (j < n && /[0-9.eE+-]/.test(text.charAt(j))) j++
      const raw = text.slice(i, j)
      // A bare 8-4-4-4-12 hex run lexes as identifier, not number, so
      // numbers here are plain numerics or ISO date/datetime starts.
      if (DATETIME_RE.test(raw)) push('datetime', i, j)
      else push('number', i, j)
      i = j
      continue
    }

    // Identifier / keyword / operator / function name.
    if (isIdentifierStart(ch)) {
      let j = i + 1
      while (j < n && isIdentifierPart(text.charAt(j))) j++
      const raw = text.slice(i, j)
      const lower = raw.toLowerCase()
      // Look ahead past whitespace for a '(' to detect a function call.
      let k = j
      while (k < n && /\s/.test(text.charAt(k))) k++
      const followedByParen = text.charAt(k) === '('

      if (GUID_RE.test(raw)) push('guid', i, j)
      else if (DATETIME_RE.test(raw)) push('datetime', i, j)
      else if (followedByParen && FUNCTION_SET.has(lower)) push('function', i, j)
      else if (COMPARISON_SET.has(lower)) push('operator', i, j)
      else if (LOGICAL_SET.has(lower)) push('logical', i, j)
      else if (UNARY_SET.has(lower)) push('unary', i, j)
      else if (KEYWORD_SET.has(lower)) push('keyword', i, j)
      else push('identifier', i, j)
      i = j
      continue
    }

    // Anything else (a stray symbol, a half-typed char) — one char of
    // `unknown` so the loop always advances.
    push('unknown', i, i + 1)
    i++
  }

  return tokens
}

/** What the cursor position expects next, used to pick the right
 * completion list. */
export type CursorKind = 'property' | 'operator' | 'value' | 'logical' | 'function' | 'unknown'

export interface CursorContext {
  kind: CursorKind
  /** The property path token to the left when classifying an
   * `operator` or `value` position (e.g. `Status` or `Customer/Name`).
   * Undefined for property / logical positions. */
  propertyPath?: string
  /** The partial word the cursor is currently inside (used to filter
   * the suggestion list). Empty string when the cursor sits in
   * whitespace. */
  prefix: string
  /** True when the cursor sits inside a `{{…}}` template span — the
   * caller skips OData completion + validation there. */
  inTemplate: boolean
}

/** Index of the token whose span contains `offset` (cursor between two
 * tokens attaches to the token on its LEFT so typing at the end of a
 * word keeps that word as the prefix). Returns -1 before any token. */
function tokenAtOffset(tokens: FilterToken[], offset: number): number {
  let idx = -1
  for (const [t, tok] of tokens.entries()) {
    if (tok.start < offset && offset <= tok.end) idx = t
    else if (tok.start >= offset) break
  }
  return idx
}

/** Last non-whitespace, non-template token strictly before `index`
 * (inclusive of `index` when `includeSelf`). */
function prevMeaningful(tokens: FilterToken[], index: number, includeSelf: boolean): FilterToken | undefined {
  const from = includeSelf ? index : index - 1
  for (let t = from; t >= 0; t--) {
    const tok = tokens[t]
    if (!tok) continue
    if (tok.type === 'whitespace') continue
    return tok
  }
  return undefined
}

/**
 * Classify the cursor position within a `$filter` string and report
 * which completion list belongs there, the owning property path (for
 * operator / value positions), and the partial word under the cursor.
 *
 * The classifier is deliberately tolerant: a half-typed expression
 * (`Name eq `, `Sta`, `Age gt 2`) classifies to the most useful
 * suggestion bucket rather than erroring.
 */
export function classifyCursor(text: string, offset: number): CursorContext {
  const clamped = Math.max(0, Math.min(offset, text.length))
  const tokens = tokenizeFilter(text)

  // Inside a template span → opaque, no OData completion.
  for (const tok of tokens) {
    if (tok.type === 'template' && tok.start < clamped && clamped < tok.end) {
      return { kind: 'unknown', prefix: '', inTemplate: true }
    }
  }

  const idx = tokenAtOffset(tokens, clamped)
  const current = idx >= 0 ? tokens[idx] : undefined

  // The prefix is the current token's text up to the cursor when the
  // cursor sits inside a word-like token; otherwise empty.
  let prefix = ''
  if (
    current &&
    clamped > current.start &&
    (current.type === 'identifier' ||
      current.type === 'operator' ||
      current.type === 'logical' ||
      current.type === 'unary' ||
      current.type === 'function' ||
      current.type === 'keyword')
  ) {
    prefix = text.slice(current.start, clamped)
  }

  // Reduce to the meaningful token the cursor "follows". When the
  // cursor is inside a word, that word is the anchor; when it's in
  // whitespace, the previous meaningful token is the anchor.
  const cursorInWord = prefix.length > 0
  const anchorIndex = cursorInWord ? idx : idx
  const prev = cursorInWord
    ? prevMeaningful(tokens, anchorIndex, false)
    : prevMeaningful(tokens, anchorIndex, true)

  // Empty / start-of-input or right after a logical / unary / '(' →
  // property position.
  if (!prev) {
    return { kind: 'property', prefix, inTemplate: false }
  }

  // When the cursor word itself is a recognised operator/logical being
  // typed, classify by the token BEFORE it.
  const effectivePrev =
    cursorInWord && current
      ? prevMeaningful(tokens, idx, false)
      : prev

  switch (effectivePrev?.type) {
    case 'logical':
    case 'unary':
    case 'lparen':
    case 'comma':
      return { kind: 'property', prefix, inTemplate: false }
    case 'identifier':
    case 'slash': {
      // After a property path (possibly mid-path via slash) → operator.
      // If the cursor word is itself still part of the path (prev is a
      // slash), stay in property mode.
      if (effectivePrev.type === 'slash') {
        return { kind: 'property', prefix, inTemplate: false }
      }
      const path = collectPropertyPath(tokens, indexOfToken(tokens, effectivePrev))
      return { kind: 'operator', propertyPath: path, prefix, inTemplate: false }
    }
    case 'operator': {
      // After a comparison operator → value position; report the
      // property to the operator's left to drive value suggestions.
      const opIdx = indexOfToken(tokens, effectivePrev)
      const propTok = prevMeaningful(tokens, opIdx, false)
      const path =
        propTok?.type === 'identifier'
          ? collectPropertyPath(tokens, indexOfToken(tokens, propTok))
          : undefined
      return { kind: 'value', ...(path ? { propertyPath: path } : {}), prefix, inTemplate: false }
    }
    case 'string':
    case 'number':
    case 'keyword':
    case 'guid':
    case 'datetime':
    case 'rparen':
    case 'template':
      // After a complete value / closing paren → logical connector.
      return { kind: 'logical', prefix, inTemplate: false }
    case 'function':
      return { kind: 'value', prefix, inTemplate: false }
    default:
      return { kind: 'property', prefix, inTemplate: false }
  }
}

function indexOfToken(tokens: FilterToken[], tok: FilterToken | undefined): number {
  if (!tok) return -1
  return tokens.indexOf(tok)
}

/** Reconstruct the full slash-joined property path ending at the
 * identifier token at `endIdx` (walks left over `ident / ident`). */
function collectPropertyPath(tokens: FilterToken[], endIdx: number): string {
  if (endIdx < 0) return ''
  const parts: string[] = []
  let t = endIdx
  while (t >= 0) {
    const tok = tokens[t]
    if (!tok) break
    if (tok.type === 'identifier') {
      parts.unshift(tok.value)
      // Look left for a slash to continue the path.
      let s = t - 1
      while (s >= 0 && tokens[s]?.type === 'whitespace') s--
      if (tokens[s]?.type === 'slash') {
        t = s - 1
        while (t >= 0 && tokens[t]?.type === 'whitespace') t--
        continue
      }
      break
    }
    break
  }
  return parts.join('/')
}
