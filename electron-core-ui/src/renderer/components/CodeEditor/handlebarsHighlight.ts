/**
 * Handlebars colouring for a template-aware editor.
 *
 * Monaco colours text through the tokenizer of the model's language, and no such
 * tokenizer can help here: to the JSON grammar `"{{petId}}"` is a string and the
 * construct inside it is ordinary string text, while to a Handlebars grammar the
 * surrounding JSON stops being validated. Teaching either one about the other
 * means replacing a whole language.
 *
 * A decoration overlay side-steps the choice: it is applied by RANGE, so it is
 * language-agnostic. The construct spans this module turns into ranges come from
 * {@link findHandlebarsSpans} — the same finder the marker tolerance uses — so a
 * construct is coloured in exactly the places it is excused from validation, in
 * a JSON body and an XML envelope alike, whether it sits in a value position or
 * inside a quoted string.
 *
 * Blocks are asked for UNMERGED: `{{#each pets}}"{{this}}",{{/each}}` colours
 * its three tags, not the `","` between them — that text is payload, not
 * template syntax.
 *
 * Pure range arithmetic, so the mapping is unit-testable without an editor.
 */

import { findHandlebarsSpans, computeLineStarts } from './handlebarsTolerance'

/**
 * CSS class Monaco stamps on the text of every Handlebars construct. Coloured in
 * `codeEditor.css`; exported so a test (or a host with its own stylesheet) can
 * name the class instead of duplicating the string.
 */
export const HANDLEBARS_INLINE_CLASS = 'ecui-handlebars-construct'

/** A range in Monaco's coordinates: 1-based line, 1-based column, end-exclusive. */
export interface HandlebarsHighlightRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/**
 * Every Handlebars construct in `text`, as an editor range ready to decorate.
 *
 * Returns an empty array for a document without Handlebars in it, so an editor
 * showing a plain payload pays nothing but the scan.
 */
export function findHandlebarsHighlightRanges(text: string): HandlebarsHighlightRange[] {
  const spans = findHandlebarsSpans(text, { mergeSameLineBlocks: false })
  if (spans.length === 0) return []

  const lineStarts = computeLineStarts(text)
  return spans.map((span) => {
    const start = positionAt(lineStarts, span.start)
    const end = positionAt(lineStarts, span.end)
    return {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column
    }
  })
}

/**
 * Offset → 1-based line/column. Binary search rather than a scan: a body editor
 * repaints on every keystroke, and a large document has many constructs.
 */
function positionAt(
  lineStarts: readonly number[],
  offset: number
): { lineNumber: number; column: number } {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if ((lineStarts[mid] ?? 0) <= offset) low = mid
    else high = mid - 1
  }
  return { lineNumber: low + 1, column: offset - (lineStarts[low] ?? 0) + 1 }
}
