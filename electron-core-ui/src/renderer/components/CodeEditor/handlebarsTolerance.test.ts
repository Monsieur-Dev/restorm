import { describe, it, expect } from 'vitest'
import {
  findHandlebarsSpans,
  maskHandlebarsForJson,
  isJsonValidIgnoringHandlebars,
  filterHandlebarsMarkers,
  type MarkerRangeLike
} from './handlebarsTolerance'

/** Render the spans back as the substrings they cover — far easier to read in a
 * failure message than a list of offsets. */
function covered(text: string): string[] {
  return findHandlebarsSpans(text).map((span) => text.slice(span.start, span.end))
}

/** Build a Monaco-shaped (1-based) range over `needle` inside `text`, the way a
 * validator would report an error sitting on that substring. */
function markerOn(text: string, needle: string, occurrence = 0): MarkerRangeLike {
  let offset = -1
  for (let i = 0; i <= occurrence; i += 1) offset = text.indexOf(needle, offset + 1)
  if (offset === -1) throw new Error(`"${needle}" not found in the fixture`)
  return { ...position(text, offset), ...endPosition(text, offset + needle.length) }
}

/** Zero-width marker AT `needle`'s first character (Monaco points at a position
 * rather than a range for "value expected"-style diagnostics). */
function markerAt(text: string, needle: string): MarkerRangeLike {
  const offset = text.indexOf(needle)
  if (offset === -1) throw new Error(`"${needle}" not found in the fixture`)
  const { startLineNumber, startColumn } = position(text, offset)
  return { startLineNumber, startColumn, endLineNumber: startLineNumber, endColumn: startColumn }
}

function position(text: string, offset: number): { startLineNumber: number; startColumn: number } {
  const before = text.slice(0, offset).split('\n')
  return {
    startLineNumber: before.length,
    startColumn: (before[before.length - 1] ?? '').length + 1
  }
}

function endPosition(text: string, offset: number): { endLineNumber: number; endColumn: number } {
  const { startLineNumber, startColumn } = position(text, offset)
  return { endLineNumber: startLineNumber, endColumn: startColumn }
}

const JSON_OPTIONS = { languageId: 'json' }

describe('findHandlebarsSpans', () => {
  it('covers a double-brace expression and a helper call', () => {
    expect(covered('{"id": {{petId}}, "at": {{now "iso"}}}')).toEqual(['{{petId}}', '{{now "iso"}}'])
  })

  it('covers a triple-brace expression whole, closing braces included', () => {
    expect(covered('{"raw": {{{payload}}}}')).toEqual(['{{{payload}}}'])
  })

  it('stops a double-brace span before a JSON brace that follows it', () => {
    // `{"id":{{petId}}}` — the object's own `}` must stay outside the span.
    expect(covered('{"id":{{petId}}}')).toEqual(['{{petId}}'])
  })

  it('steps over a quoted helper argument that contains the closing braces', () => {
    expect(covered('{{concat "a}}b"}}')).toEqual(['{{concat "a}}b"}}'])
  })

  it('ignores an unterminated construct', () => {
    expect(covered('{"id": {{petId}')).toEqual([])
  })

  it('merges a block that opens and closes on one line', () => {
    expect(covered('[{{#each pets}}{{this}},{{/each}}]')).toEqual(['{{#each pets}}{{this}},{{/each}}'])
  })

  it('keeps the tags of a multi-line block separate', () => {
    const text = '[\n{{#each pets}}\n{{this}},\n{{/each}}\n]'
    expect(covered(text)).toEqual(['{{#each pets}}', '{{this}}', '{{/each}}'])
  })

  it('merges an inner single-line block inside a multi-line one', () => {
    const text = '{{#each pets}}\n{{#if alive}}{{name}}{{/if}}\n{{/each}}'
    expect(covered(text)).toEqual(['{{#each pets}}', '{{#if alive}}{{name}}{{/if}}', '{{/each}}'])
  })

  it('treats an inverted section as a block', () => {
    expect(covered('{{^empty}}x{{/empty}}')).toEqual(['{{^empty}}x{{/empty}}'])
  })

  it('marks a merged block as a block and everything else as an expression', () => {
    const kinds = (text: string): string[] => findHandlebarsSpans(text).map((span) => span.kind)
    expect(kinds('[{{#each pets}}{{this}},{{/each}}]')).toEqual(['block'])
    expect(kinds('{"id": {{petId}}, "raw": {{{payload}}}}')).toEqual(['expression', 'expression'])
    // Split over two lines the halves stay separate tags, so neither is a block
    // that could be masked as one value.
    expect(kinds('[\n{{#each pets}}\n1,\n{{/each}}\n]')).toEqual(['expression', 'expression'])
  })
})

describe('maskHandlebarsForJson', () => {
  it('preserves the document length so outside positions still line up', () => {
    const text = '{"id": {{petId}}, "name": "{{{raw}}}", "n": 1}'
    expect(maskHandlebarsForJson(text)).toHaveLength(text.length)
  })

  it('quotes a construct in a bare value position', () => {
    expect(maskHandlebarsForJson('{"id": {{petId}}}')).toBe('{"id": "xxxxxxx"}')
  })

  it('leaves a construct inside a string unquoted', () => {
    expect(maskHandlebarsForJson('{"name": "{{first}} {{last}}"}')).toBe('{"name": "xxxxxxxxx xxxxxxxx"}')
  })

  it('does not let a quote inside a construct open a string', () => {
    // `{{concat "a"}}` sits in a bare value position: its own quotes must be
    // masked away, otherwise the tracker would think a string stayed open.
    expect(maskHandlebarsForJson('{"a": {{concat "x"}}, "b": 1}')).toBe('{"a": "xxxxxxxxxxxx", "b": 1}')
  })

  it('blanks a multi-line construct but keeps its newlines', () => {
    // `{{helper` is 8 characters, `  arg}}` is 7 — each line keeps its width so
    // every position after the construct still resolves to the same line.
    const masked = maskHandlebarsForJson('{"a": {{helper\n  arg}}}')
    expect(masked).toBe(`{"a": ${' '.repeat(8)}\n${' '.repeat(7)}}`)
    expect(masked.split('\n')).toHaveLength(2)
  })

  it('closes a block mask with a comma under the sequence variant', () => {
    const text = '[{{#each pets}}1,{{/each}}0]'
    const spans = findHandlebarsSpans(text)
    // The block covers 25 characters; both masks are exactly that wide, the
    // sequence one spending its last on the comma.
    expect(maskHandlebarsForJson(text, spans, 'sequence')).toBe(`["${'x'.repeat(22)}",0]`)
    expect(maskHandlebarsForJson(text, spans, 'literal')).toBe(`["${'x'.repeat(23)}"0]`)
  })

  it('leaves an expression mask alone under the sequence variant', () => {
    const text = '{"id": {{petId}}}'
    expect(maskHandlebarsForJson(text, findHandlebarsSpans(text), 'sequence')).toBe('{"id": "xxxxxxx"}')
  })
})

describe('isJsonValidIgnoringHandlebars', () => {
  it.each([
    ['a bare value', '{"id": {{petId}}}'],
    ['a tight brace collision', '{"id":{{petId}}}'],
    ['a triple-brace value', '{"raw": {{{payload}}}}'],
    ['a construct inside a string', '{"name": "Hello {{first}}"}'],
    ['a whole property list', '{{{everything}}}'],
    ['a single-line block emitting one element', '{"n": {{#if alive}}1{{/if}}}'],
    ['a single-line block emitting a list prefix', '[{{#each pets}}1,{{/each}}0]']
  ])('accepts %s', (_label, text) => {
    expect(isJsonValidIgnoringHandlebars(text)).toBe(true)
  })

  it.each([
    ['a missing value', '{"id": {{petId}}, "name": }'],
    ['a trailing comma', '{"id": {{petId}},}'],
    ['an unquoted key', '{id: {{petId}}}'],
    ['a multi-line block', '[\n{{#each pets}}\n1,\n{{/each}}\n]']
  ])('rejects %s', (_label, text) => {
    expect(isJsonValidIgnoringHandlebars(text)).toBe(false)
  })
})

describe('filterHandlebarsMarkers', () => {
  it('returns every marker untouched when the document has no Handlebars', () => {
    const text = '{"id": }'
    const markers = [markerOn(text, '}', 0)]
    expect(filterHandlebarsMarkers(text, markers, JSON_OPTIONS)).toEqual(markers)
  })

  it('drops a marker sitting on a double-brace construct', () => {
    const text = '{"id": {{petId}}}'
    expect(filterHandlebarsMarkers(text, [markerOn(text, '{{petId}}')], JSON_OPTIONS)).toEqual([])
  })

  it('drops a marker sitting on a triple-brace construct', () => {
    const text = '{"raw": {{{payload}}}}'
    expect(filterHandlebarsMarkers(text, [markerOn(text, '{{{payload}}}')], JSON_OPTIONS)).toEqual([])
  })

  it('drops a zero-width marker pointing at the opening braces', () => {
    const text = '{"id": {{petId}}}'
    expect(filterHandlebarsMarkers(text, [markerAt(text, '{{')], JSON_OPTIONS)).toEqual([])
  })

  it('drops a knock-on marker reported outside the construct it stems from', () => {
    // Monaco frequently reports the CONSEQUENCE of the unexpected `{` further
    // along, e.g. on the object's own closing brace. Masking the construct away
    // makes the document parse, which proves the marker was collateral.
    const text = '{"id": {{petId}}}'
    const kept = filterHandlebarsMarkers(text, [markerOn(text, '}', 2)], JSON_OPTIONS)
    expect(kept).toEqual([])
  })

  it('keeps a genuine error reported outside any construct', () => {
    const text = '{"id": {{petId}}, "name": }'
    const genuine = markerOn(text, '}', text.split('}').length - 2)
    expect(filterHandlebarsMarkers(text, [genuine], JSON_OPTIONS)).toEqual([genuine])
  })

  it('keeps a genuine error even when a construct sits on the same line', () => {
    const text = '{"id": {{petId}}, "oops": 0x1}'
    const genuine = markerOn(text, '0x1')
    const onConstruct = markerOn(text, '{{petId}}')
    expect(filterHandlebarsMarkers(text, [genuine, onConstruct], JSON_OPTIONS)).toEqual([genuine])
  })

  it('keeps a genuine error on another line of a multi-line document', () => {
    const text = '{\n  "id": {{petId}},\n  "name": ,\n  "ok": true\n}'
    const genuine = markerOn(text, '"name": ,')
    expect(filterHandlebarsMarkers(text, [genuine], JSON_OPTIONS)).toEqual([genuine])
  })

  it('drops a marker inside a construct, tolerance over strictness', () => {
    // The validator sees `helper` as a stray identifier; inside `{{ … }}` it is
    // an argument list, and the editor must not second-guess it.
    const text = '{"at": {{formatDate now "iso"}}}'
    expect(filterHandlebarsMarkers(text, [markerOn(text, 'now')], JSON_OPTIONS)).toEqual([])
  })

  it('keeps a knock-on marker for a non-JSON language, overlap filtering only', () => {
    // Without a validator to re-run, there is no way to tell collateral from
    // genuine — so only the markers ON the construct are dropped.
    const text = '<pet><id>{{petId}}</id><n>'
    const onConstruct = markerOn(text, '{{petId}}')
    const elsewhere = markerOn(text, '<n>')
    expect(filterHandlebarsMarkers(text, [onConstruct, elsewhere], { languageId: 'xml' })).toEqual([elsewhere])
  })

  it('applies overlap filtering when no language is declared', () => {
    const text = 'id = {{petId}} !'
    const onConstruct = markerOn(text, '{{petId}}')
    const elsewhere = markerOn(text, '!')
    expect(filterHandlebarsMarkers(text, [onConstruct, elsewhere])).toEqual([elsewhere])
  })

  it('does not mutate the markers it was given', () => {
    const text = '{"id": {{petId}}, "name": }'
    const markers = [markerOn(text, '{{petId}}'), markerOn(text, '"name": }')]
    const snapshot = JSON.parse(JSON.stringify(markers)) as MarkerRangeLike[]
    filterHandlebarsMarkers(text, markers, JSON_OPTIONS)
    expect(markers).toEqual(snapshot)
  })

  it('returns an empty array for an empty marker set', () => {
    expect(filterHandlebarsMarkers('{{a}}', [], JSON_OPTIONS)).toEqual([])
  })
})
