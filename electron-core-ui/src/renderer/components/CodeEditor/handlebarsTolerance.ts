/**
 * Handlebars tolerance for Monaco markers.
 *
 * A document can legitimately be BOTH a template and a structured payload:
 * `{"id": {{petId}}, "raw": "{{{name}}}"}` is a valid Handlebars template that a
 * request body editor must accept. Monaco's structural validation runs in a web
 * worker that knows nothing about `{{ … }}`, so it reports the template as
 * broken and the editor paints the whole payload red. The worker cannot be
 * taught the template grammar — but its OUTPUT can be post-processed, which is
 * what this module decides:
 *
 *  1. locate every Handlebars construct in the text ({@link findHandlebarsSpans});
 *  2. drop the markers whose range OVERLAPS one of those constructs — the
 *     squiggle sits on the template syntax itself;
 *  3. for JSON, additionally mask every construct with a same-width JSON literal
 *     and re-parse ({@link isJsonValidIgnoringHandlebars}). If the masked
 *     document parses, the template is the ONLY thing the validator objected to,
 *     so the markers left over are its knock-on errors and go too.
 *
 * Anything the masked document still rejects is a genuine defect and keeps its
 * marker — at its original position, because the mask is length-preserving.
 *
 * Nothing here touches Monaco: it is pure text/range arithmetic, so the whole
 * decision table is unit-testable without an editor.
 *
 * Known limitation: a block whose `{{#…}}` and `{{/…}}` sit on DIFFERENT lines
 * cannot be masked into a single JSON literal (a JSON string cannot span a
 * newline, and collapsing the newline would shift every marker after it). Such a
 * document keeps step 2 only — the block tags themselves stop squiggling, errors
 * the block induces elsewhere still show.
 */

/** Half-open `[start, end)` offsets of one Handlebars construct in a document. */
export interface HandlebarsSpan {
  /** Offset of the construct's first `{`. */
  start: number
  /** Offset just past the construct's last `}`. */
  end: number
  /**
   * `block` for a whole `{{#each …}} … {{/each}}` covered by one span — such a
   * construct EXPANDS to a repeated fragment, so masking it may need to stand in
   * for "an element and the comma after it". `expression` for everything else,
   * including the lone tags of a block whose two halves span several lines.
   */
  kind: 'expression' | 'block'
}

/**
 * How {@link maskHandlebarsForJson} stands in for a construct that covers a
 * whole block:
 *
 * - `literal` — one JSON value, i.e. what a block emitting a single element
 *   (`{"a": {{#if x}}1{{/if}}}`) needs;
 * - `sequence` — a JSON value FOLLOWED BY A COMMA, i.e. what a block emitting the
 *   leading elements of a list (`[{{#each pets}}1,{{/each}}0]`) needs.
 *
 * Both readings are legitimate and the document decides which one parses, so
 * {@link isJsonValidIgnoringHandlebars} tries each in turn. Expression
 * constructs mask identically under both.
 */
export type HandlebarsMaskVariant = 'literal' | 'sequence'

/** The slice of a Monaco `IMarker` this module needs — 1-based, like Monaco. */
export interface MarkerRangeLike {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface HandlebarsToleranceOptions {
  /**
   * Monaco language id of the model the markers belong to. `json` / `jsonc`
   * unlock the whole-document mask-and-reparse pass; any other language gets
   * overlap filtering only (there is no generic way to re-validate it here).
   */
  languageId?: string
}

/** Character the mask pads with — JSON-safe inside and outside a string. */
const FILLER = 'x'

type TagKind = 'expression' | 'block-open' | 'block-close'

interface HandlebarsTag {
  /** Offset of the tag's first `{`. */
  start: number
  /** Offset just past the tag's last `}`. */
  end: number
  kind: TagKind
  /** Block name, for pairing `{{#each x}}` with its `{{/each}}`. Empty for an expression. */
  name: string
}

/**
 * Locate every Handlebars construct in `text`.
 *
 * Recognises the double-brace expression (`{{var}}`, `{{helper arg}}`), the
 * triple-brace unescaped form (`{{{var}}}`), and the block tags (`{{#if}}` /
 * `{{^unless}}` / `{{/if}}`). A block that opens and closes on the SAME line is
 * returned as ONE span covering the block and its content, so masking it yields
 * a single JSON literal; a block spanning several lines yields its two tags
 * separately. An unterminated `{{` is not a construct — it is a typo, and the
 * validator is right to complain about it.
 */
export function findHandlebarsSpans(text: string): HandlebarsSpan[] {
  const spans: HandlebarsSpan[] = []
  /** Open blocks awaiting their close tag, with the span count at open time so a
   * same-line close can replace everything it wraps with one merged span. */
  const openBlocks: { name: string; start: number; spanCount: number }[] = []
  let cursor = 0

  while (cursor < text.length) {
    const at = text.indexOf('{{', cursor)
    if (at === -1) break
    const tag = readTag(text, at)
    if (tag === null) {
      cursor = at + 2
      continue
    }
    cursor = tag.end

    if (tag.kind === 'block-open') {
      openBlocks.push({ name: tag.name, start: tag.start, spanCount: spans.length })
      spans.push({ start: tag.start, end: tag.end, kind: 'expression' })
      continue
    }

    if (tag.kind === 'block-close') {
      const openIndex = lastIndexOfBlock(openBlocks, tag.name)
      const open = openIndex === -1 ? undefined : openBlocks[openIndex]
      if (open !== undefined) {
        // Everything up to and including this close tag belongs to the block.
        openBlocks.length = openIndex
        if (!text.slice(open.start, tag.end).includes('\n')) {
          spans.length = open.spanCount
          spans.push({ start: open.start, end: tag.end, kind: 'block' })
          continue
        }
      }
    }

    spans.push({ start: tag.start, end: tag.end, kind: 'expression' })
  }

  return spans
}

/**
 * Rewrite `text` with every Handlebars construct replaced by a JSON-legal
 * placeholder of the SAME width, so a marker reported outside the constructs
 * still points at the same offset in both documents.
 *
 * A construct in a bare value position becomes a quoted string (`"xxxxxxx"`);
 * one already inside a string literal becomes bare filler, since adding quotes
 * there would close the string it lives in. A multi-line construct becomes
 * blanks — invalid, deliberately: see the module's known limitation.
 */
export function maskHandlebarsForJson(
  text: string,
  spans: readonly HandlebarsSpan[] = findHandlebarsSpans(text),
  variant: HandlebarsMaskVariant = 'literal'
): string {
  let out = ''
  let cursor = 0
  let inString = false

  for (const span of spans) {
    const literal = text.slice(cursor, span.start)
    out += literal
    inString = trackJsonString(literal, inString)
    out += maskSpan(text.slice(span.start, span.end), inString, span.kind === 'block' ? variant : 'literal')
    cursor = span.end
  }

  return out + text.slice(cursor)
}

/**
 * Would this text be valid JSON if its Handlebars constructs were plain values?
 * Answered on the masked copy, so a `{{var}}` standing in for a number, a string
 * or a whole property value all read as well-formed. A document containing a
 * block is checked under both mask variants (see {@link HandlebarsMaskVariant}) —
 * either reading parsing is enough to call the document sound.
 */
export function isJsonValidIgnoringHandlebars(
  text: string,
  spans: readonly HandlebarsSpan[] = findHandlebarsSpans(text)
): boolean {
  const variants: HandlebarsMaskVariant[] = spans.some((span) => span.kind === 'block')
    ? ['literal', 'sequence']
    : ['literal']
  return variants.some((variant) => {
    try {
      JSON.parse(maskHandlebarsForJson(text, spans, variant))
      return true
    } catch {
      return false
    }
  })
}

/**
 * Keep only the markers that survive Handlebars tolerance: the ones that neither
 * sit on a Handlebars construct nor exist merely because one is there.
 *
 * Returns a new array; `markers` is never mutated. A document with no Handlebars
 * in it is returned untouched, so the strict behaviour is the default and the
 * tolerance costs nothing when it is not needed.
 */
export function filterHandlebarsMarkers<M extends MarkerRangeLike>(
  text: string,
  markers: readonly M[],
  options: HandlebarsToleranceOptions = {}
): M[] {
  if (markers.length === 0) return []
  const spans = findHandlebarsSpans(text)
  if (spans.length === 0) return [...markers]

  const lineStarts = computeLineStarts(text)
  const kept = markers.filter((marker) => !overlapsAnySpan(marker, spans, lineStarts, text.length))
  if (kept.length === 0) return kept

  // Whatever is left is either a real defect or a knock-on effect of the
  // template. Masking the template away answers which: a document that parses
  // once masked had no defect of its own.
  if (isJsonLanguage(options.languageId) && isJsonValidIgnoringHandlebars(text, spans)) return []
  return kept
}

function isJsonLanguage(languageId: string | undefined): boolean {
  return languageId === 'json' || languageId === 'jsonc'
}

/** Read the construct opening at `start`, or `null` when it never closes. */
function readTag(text: string, start: number): HandlebarsTag | null {
  const isTriple = text.startsWith('{{{', start)
  const openLength = isTriple ? 3 : 2
  const closer = isTriple ? '}}}' : '}}'
  const closeAt = findCloser(text, start + openLength, closer)
  if (closeAt === -1) return null

  const inner = text.slice(start + openLength, closeAt).trim()
  const sigil = inner.charAt(0)
  // Only the double-brace form carries block sigils; `{{{#x}}}` is not a block.
  const kind: TagKind = isTriple
    ? 'expression'
    : sigil === '#' || sigil === '^'
      ? 'block-open'
      : sigil === '/'
        ? 'block-close'
        : 'expression'

  return {
    start,
    end: closeAt + closer.length,
    kind,
    name: kind === 'expression' ? '' : blockName(inner.slice(1))
  }
}

/**
 * Index of `closer` at or after `from`, stepping over quoted helper arguments —
 * between the braces a quote is an argument delimiter by the Handlebars grammar,
 * so `{{concat "a}}b"}}` closes on its real `}}`. Everywhere else the first
 * match wins, which is what makes `{"id":{{petId}}}` stop before the object's
 * own closing brace.
 */
function findCloser(text: string, from: number, closer: string): number {
  let i = from
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i)
      continue
    }
    if (text.startsWith(closer, i)) return i
    i += 1
  }
  return -1
}

/** Index just past the quote closing the argument that starts at `start`. */
function skipQuoted(text: string, start: number): number {
  const quote = text[start]
  let i = start + 1
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i += 1
  }
  return i
}

/** First whitespace-delimited token of a block tag's body, i.e. its name. */
function blockName(inner: string): string {
  return inner.trim().split(/\s/)[0] ?? ''
}

function lastIndexOfBlock(
  openBlocks: readonly { name: string }[],
  name: string
): number {
  for (let i = openBlocks.length - 1; i >= 0; i -= 1) {
    if (openBlocks[i]?.name === name) return i
  }
  return -1
}

/** Track whether a JSON string literal is open after reading `literal`. */
function trackJsonString(literal: string, inString: boolean): boolean {
  let state = inString
  for (let i = 0; i < literal.length; i += 1) {
    const ch = literal[i]
    if (state && ch === '\\') {
      i += 1
      continue
    }
    if (ch === '"') state = !state
  }
  return state
}

function maskSpan(raw: string, inString: boolean, variant: HandlebarsMaskVariant): string {
  if (raw.includes('\n')) return raw.replace(/[^\n]/g, ' ')
  if (inString || raw.length < 2) return FILLER.repeat(raw.length)
  if (variant === 'sequence' && raw.length >= 3) return `"${FILLER.repeat(raw.length - 3)}",`
  return `"${FILLER.repeat(raw.length - 2)}"`
}

/** Offset of the first character of each 1-based line. */
function computeLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

function offsetAt(lineStarts: readonly number[], line: number, column: number, max: number): number {
  const clampedLine = Math.min(Math.max(line, 1), lineStarts.length)
  const base = lineStarts[clampedLine - 1] ?? 0
  return Math.min(base + Math.max(column, 1) - 1, max)
}

function overlapsAnySpan(
  marker: MarkerRangeLike,
  spans: readonly HandlebarsSpan[],
  lineStarts: readonly number[],
  max: number
): boolean {
  const start = offsetAt(lineStarts, marker.startLineNumber, marker.startColumn, max)
  const end = Math.max(start, offsetAt(lineStarts, marker.endLineNumber, marker.endColumn, max))
  return spans.some((span) => (
    start === end
      // A zero-width marker (Monaco points at a position rather than a range)
      // counts as overlapping when it lands anywhere on the construct.
      ? start >= span.start && start <= span.end
      : start < span.end && end > span.start
  ))
}
