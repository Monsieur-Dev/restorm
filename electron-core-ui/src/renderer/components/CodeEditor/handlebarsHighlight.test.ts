import { describe, it, expect } from 'vitest'
import { findHandlebarsHighlightRanges, type HandlebarsHighlightRange } from './handlebarsHighlight'
import { findHandlebarsSpans } from './handlebarsTolerance'

/**
 * Read each range back as the text it covers. Asserting on substrings rather
 * than on line/column numbers is what makes a failure legible AND keeps the
 * assertion honest: an off-by-one in the position mapping shifts the slice.
 */
function coloured(text: string): string[] {
  return findHandlebarsHighlightRanges(text).map((range) => slice(text, range))
}

/** Extract `range`'s text by walking the document the way an editor would. */
function slice(text: string, range: HandlebarsHighlightRange): string {
  const lines = text.split('\n')
  const start = offsetOf(lines, range.startLineNumber, range.startColumn)
  const end = offsetOf(lines, range.endLineNumber, range.endColumn)
  return text.slice(start, end)
}

function offsetOf(lines: readonly string[], lineNumber: number, column: number): number {
  let offset = 0
  for (let i = 0; i < lineNumber - 1; i += 1) offset += (lines[i] ?? '').length + 1
  return offset + column - 1
}

describe('findHandlebarsHighlightRanges', () => {
  it('colours a construct that sits INSIDE a quoted JSON string', () => {
    // The whole point: to Monaco's JSON tokenizer this is string text, so no
    // language grammar would ever colour it.
    expect(coloured('{"petid": "{{petId}}"}')).toEqual(['{{petId}}'])
  })

  it('colours the construct only, not the string text around it', () => {
    // A wider range would show up in the slice as the neighbouring text.
    expect(coloured('{"greeting": "Hello {{first}}!"}')).toEqual(['{{first}}'])
  })

  it('colours a construct in a bare value position', () => {
    expect(coloured('{"id": {{petId}}}')).toEqual(['{{petId}}'])
  })

  it('colours a triple-brace construct whole, closing braces included', () => {
    expect(coloured('{"raw": {{{payload}}}}')).toEqual(['{{{payload}}}'])
  })

  it('colours several constructs on one line, in and out of strings', () => {
    expect(coloured('{"id": {{petId}}, "name": "{{first}} {{last}}"}')).toEqual([
      '{{petId}}',
      '{{first}}',
      '{{last}}'
    ])
  })

  it('colours a helper call including a quoted argument that contains braces', () => {
    expect(coloured('{"at": {{now "}}"}}}')).toEqual(['{{now "}}"}}'])
  })

  it('colours a block\'s TAGS, never the payload they wrap', () => {
    const text = '{"pets": [{{#each pets}}"{{this}}",{{/each}}"last"]}'
    expect(coloured(text)).toEqual(['{{#each pets}}', '{{this}}', '{{/each}}'])
    // The comma and the quotes between the tags are payload; nothing may cover
    // them, which is exactly what the merged-span form used by the marker
    // tolerance would do.
    expect(coloured(text).join('')).not.toContain('"')
  })

  it('colours a construct inside an XML element', () => {
    expect(coloured('<pet><id>{{petId}}</id><name>{{{rawName}}}</name></pet>')).toEqual([
      '{{petId}}',
      '{{{rawName}}}'
    ])
  })

  it('maps a construct on a later line to that line', () => {
    const text = '{\n  "id": 1,\n  "petid": "{{petId}}"\n}'
    expect(findHandlebarsHighlightRanges(text)).toEqual([
      { startLineNumber: 3, startColumn: 13, endLineNumber: 3, endColumn: 22 }
    ])
    expect(coloured(text)).toEqual(['{{petId}}'])
  })

  it('colours a multi-line block\'s two tags separately', () => {
    const text = '[\n{{#each pets}}\n  "{{this}}",\n{{/each}}\n"last"]'
    expect(coloured(text)).toEqual(['{{#each pets}}', '{{this}}', '{{/each}}'])
  })

  it('returns nothing for a document without Handlebars', () => {
    expect(findHandlebarsHighlightRanges('{"id": 1, "name": "Rex"}')).toEqual([])
  })

  it('returns nothing for an unterminated construct — a typo is not syntax', () => {
    expect(findHandlebarsHighlightRanges('{"id": {{petId}')).toEqual([])
  })
})

describe('findHandlebarsSpans block merging', () => {
  const text = '{"pets": [{{#each pets}}"{{this}}",{{/each}}"last"]}'

  it('merges a same-line block by default, so masking gets one JSON value', () => {
    expect(findHandlebarsSpans(text).map((span) => text.slice(span.start, span.end))).toEqual([
      '{{#each pets}}"{{this}}",{{/each}}'
    ])
  })

  it('keeps the tags apart when asked not to merge', () => {
    expect(
      findHandlebarsSpans(text, { mergeSameLineBlocks: false }).map((span) =>
        text.slice(span.start, span.end)
      )
    ).toEqual(['{{#each pets}}', '{{this}}', '{{/each}}'])
  })
})
