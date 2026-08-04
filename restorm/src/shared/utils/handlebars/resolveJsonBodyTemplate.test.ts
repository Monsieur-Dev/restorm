import { describe, it, expect, beforeAll } from 'vitest'
import { resolveJsonBodyTemplate, isJsonContentType } from './resolveJsonBodyTemplate'
import { resolveWithContextPriority } from './resolveWithContextPriority'
import { registerHandlebarsHelpers } from './registerAll'

// The resolver evaluates each span through the real helper suite, so the tests
// run against the registered helpers rather than a stub Handlebars.
beforeAll(() => {
  registerHandlebarsHelpers()
})

const r = (tpl: string, ctx: Record<string, unknown>): string => resolveJsonBodyTemplate(tpl, ctx)

describe('isJsonContentType', () => {
  it('accepts the JSON media types and structured suffixes, parameters included', () => {
    expect(isJsonContentType('application/json')).toBe(true)
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(isJsonContentType('APPLICATION/JSON')).toBe(true)
    expect(isJsonContentType(' text/json ')).toBe(true)
    expect(isJsonContentType('application/vnd.api+json')).toBe(true)
  })

  it('rejects everything else, including an absent header', () => {
    expect(isJsonContentType(undefined)).toBe(false)
    expect(isJsonContentType('')).toBe(false)
    expect(isJsonContentType('application/xml')).toBe(false)
    expect(isJsonContentType('text/plain')).toBe(false)
    expect(isJsonContentType('multipart/form-data; boundary=abc')).toBe(false)
    expect(isJsonContentType('application/jsonish')).toBe(false)
  })
})

describe('resolveJsonBodyTemplate — tight braces against JSON syntax', () => {
  it('resolves an unquoted variable that ends an object (the parse-error case)', () => {
    expect(r('{"id":{{petId}}}', { petId: 42 })).toBe('{"id":42}')
  })

  it('resolves it with siblings and inside a nested object', () => {
    expect(r('{"a":1,"id":{{petId}}}', { petId: 42 })).toBe('{"a":1,"id":42}')
    expect(r('{"o":{"id":{{petId}}}}', { petId: 42 })).toBe('{"o":{"id":42}}')
  })

  it('leaves literal JSON braces and nested structure untouched', () => {
    const out = r('{"o":{"k":"{{v}}"},"arr":[{"k2":"{{v}}"}]}', { v: 'x' })
    expect(out).toBe('{"o":{"k":"x"},"arr":[{"k2":"x"}]}')
    expect(JSON.parse(out)).toEqual({ o: { k: 'x' }, arr: [{ k2: 'x' }] })
  })

  it('produces parseable JSON where the whole-template compile threw', () => {
    expect(() => resolveWithContextPriority('{"id":{{petId}}}', { petId: 42 })).toThrow()
    expect(JSON.parse(r('{"id":{{petId}}}', { petId: 42 }))).toEqual({ id: 42 })
  })
})

describe('resolveJsonBodyTemplate — escaping inside JSON strings', () => {
  it('escapes a value carrying a quote, a backslash, a newline and a control char', () => {
    const value = 'a"b\\c\nde\te'
    const out = r('{"name":"{{name}}"}', { name: value })
    expect(JSON.parse(out)).toEqual({ name: value })
  })

  it('escapes each occurrence independently, including after an escaped quote', () => {
    const out = r('{"a":"x\\"y{{v}}","b":"{{v}}"}', { v: 'q"q' })
    expect(JSON.parse(out)).toEqual({ a: 'x"yq"q', b: 'q"q' })
  })

  it('escapes a value that itself looks like JSON', () => {
    const out = r('{"payload":"{{blob}}"}', { blob: '{"nested":true}' })
    expect(JSON.parse(out)).toEqual({ payload: '{"nested":true}' })
  })

  it('does not escape a span sitting in a bare value position', () => {
    expect(r('{"n":{{count}}}', { count: 3 })).toBe('{"n":3}')
    const parsed = JSON.parse(r('{"n":{{count}}}', { count: 3 })) as { n: number }
    expect(parsed.n).toBe(3)
    expect(r('{"flag":{{on}},"obj":{{obj}}}', { on: 'true', obj: '{"k":1}' })).toBe(
      '{"flag":true,"obj":{"k":1}}'
    )
  })
})

describe('resolveJsonBodyTemplate — helpers inside a JSON document', () => {
  it('runs a helper call with arguments in a bare value position', () => {
    expect(r('{"s":{{add a b}}}', { a: 1, b: 2 })).toBe('{"s":3}')
  })

  it('runs an argument-less helper inside a string', () => {
    const out = r('{"id":"{{uuid}}"}', {})
    const parsed = JSON.parse(out) as { id: string }
    expect(parsed.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('keeps a context variable winning over a same-named helper', () => {
    expect(r('{"m":{{min}}}', { min: 5 })).toBe('{"m":5}')
  })

  it('does not mistake a quoted helper argument containing braces for the span end', () => {
    // `concat` joins its arguments with a comma; what matters here is that the
    // span closes on its OWN `}}`, not on the one inside the quoted argument.
    expect(r('{"s":"{{concat "a}}b" v}}"}', { v: 'c' })).toBe('{"s":"a}}b,c"}')
  })
})

describe('resolveJsonBodyTemplate — regression: already-resolving bodies are byte-identical', () => {
  const ctx = {
    petId: 42,
    name: 'Rex',
    v: 'x',
    a: 9,
    b: 2,
    items: ['one', 'two'],
    html: '<b>hi</b>'
  }

  // Every form that compiles today must produce the SAME bytes through the new
  // resolver — the fix may only add behaviour where the old path failed.
  const identical = [
    '{"id":"{{petId}}"}',
    '{"id": {{petId}} }',
    '{"name":"{{name}}","id":"{{petId}}"}',
    '{"o":{"k":"{{v}}"}}',
    '{"m":"{{min a b}}"}',
    '{"s":"{{uppercase name}}"}',
    // Constructs the scanner declines to tokenize: they take the legacy path.
    '{"list":[{{#each items}}"{{this}}"{{#unless @last}},{{/unless}}{{/each}}]}',
    '{"raw":"{{{html}}}"}',
    '{"c":"{{! a comment }}ok"}',
    // Non-JSON shapes handed to the same resolver stay identical too.
    '<note><to>{{name}}</to></note>',
    'plain {{name}} text',
    'no mustache at all',
    ''
  ]

  for (const tpl of identical) {
    it(`matches the whole-template compile for ${JSON.stringify(tpl)}`, () => {
      expect(r(tpl, ctx)).toBe(resolveWithContextPriority(tpl, ctx))
    })
  }

  it('preserves a literal `}}` that is not part of a span', () => {
    expect(r('{"s":"a}}b","id":{{petId}}}', ctx)).toBe('{"s":"a}}b","id":42}')
  })

  // Pinned to its literal output, not just to the legacy resolver: a block
  // helper must keep taking the whole-template path. Collapsing that fallback
  // would tokenize `{{#each}}` as a span and break every JSON body using one.
  it('pins the output of a block-helper JSON body', () => {
    expect(r('{"list":[{{#each items}}"{{this}}"{{#unless @last}},{{/unless}}{{/each}}]}', ctx)).toBe(
      '{"list":["one","two"]}'
    )
  })

  it('tracks JSON string boundaries across escaped quotes and backslashes', () => {
    // These pin the string-parity tracking, so the resolved value must be one
    // whose ESCAPED form differs from its raw form — otherwise a mis-tracked
    // boundary would produce identical bytes and the assertion would pass on a
    // broken scanner. `raw` contains a quote: bare position ⇒ verbatim.
    const parity = { ...ctx, raw: 'a"b' }
    // An escaped quote must NOT close the string: with a single one before the
    // span, mistaking it for the delimiter flips the parity and the span comes
    // out escaped (`a\"b`) instead of verbatim.
    expect(r('{"q":"a\\"b","x":{{raw}}}', parity)).toBe('{"q":"a\\"b","x":a"b}')
    // An escaped backslash, however, does NOT protect the quote that follows.
    expect(r('{"p":"c:\\\\","x":{{raw}}}', parity)).toBe('{"p":"c:\\\\","x":a"b}')
    // Braces living inside a JSON string are literal text, not structure.
    expect(r('{"t":"{not a span}","x":{{raw}}}', parity)).toBe('{"t":"{not a span}","x":a"b}')
  })

  it('escapes a span that follows an escaped quote in the same string', () => {
    const out = r('{"s":"pre \\" {{name}}"}', ctx)
    expect(JSON.parse(out)).toEqual({ s: 'pre " Rex' })
  })
})

describe('resolveJsonBodyTemplate — failure modes keep the caller fallback', () => {
  it('throws on an unterminated span, exactly like the whole-template compile', () => {
    expect(() => r('{"id":{{petId}', { petId: 42 })).toThrow()
  })

  it('renders a helper-colliding unknown name like any other unknown variable', () => {
    // `test` is a block helper, so inline with no arguments it throws inside
    // Handlebars — but the resolver retries it as a variable lookup, and an
    // undefined variable renders empty. The name colliding with a helper is
    // not a property of the USER'S template, so it must not decide whether
    // the body resolves: this now matches `{"a":{{unknown}}}` exactly.
    expect(r('{"a":{{test}}}', {})).toBe(r('{"a":{{unknown}}}', {}))
  })

  it('returns the template untouched when it holds no mustache', () => {
    expect(r('{"id":42}', { petId: 1 })).toBe('{"id":42}')
  })
})
