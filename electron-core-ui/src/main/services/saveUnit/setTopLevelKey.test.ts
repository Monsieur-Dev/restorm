import { describe, it, expect } from 'vitest'
import * as yaml from 'js-yaml'
import JSON5 from 'json5'
import { setTopLevelKey } from './setTopLevelKey'

const KEY = '_projectUuid'
const UUID = '1f0a5b6c-7d8e-4f90-a1b2-c3d4e5f60718'

/**
 * Apply the edit and assert it was accepted, narrowing the result to a
 * string for the assertions that follow. The refusal cases call
 * `setTopLevelKey` directly and expect `null`.
 */
function applied(raw: string, format: 'yaml' | 'json' | 'json5' = 'yaml'): string {
  const out = setTopLevelKey(raw, KEY, UUID, format)
  if (out === null) throw new Error('expected the key to be set, but the edit was refused')
  return out
}

describe('setTopLevelKey — YAML', () => {
  it('adds the key without disturbing anything else', () => {
    const out = applied('name: My project\nversion: 3\n')
    expect(out).toContain('name: My project')
    expect(out).toContain(`${KEY}: ${UUID}`)
    expect(yaml.load(out)).toEqual({ name: 'My project', version: 3, [KEY]: UUID })
  })

  it('PRESERVES COMMENTS', () => {
    // The reason this module exists. A parse/serialise round-trip through
    // js-yaml discards every one of these lines.
    const raw = [
      '# Shared configuration for the team.',
      '# Do not reorder — the deploy script reads the first entry.',
      'name: My project  # human-facing label',
      '',
      '# Staging only.',
      'timeout: 30',
      ''
    ].join('\n')

    const out = applied(raw)
    expect(out).toContain('# Shared configuration for the team.')
    expect(out).toContain('# Do not reorder — the deploy script reads the first entry.')
    expect(out).toContain('# human-facing label')
    expect(out).toContain('# Staging only.')
    expect(yaml.load(out)).toEqual({ name: 'My project', timeout: 30, [KEY]: UUID })
  })

  it('PRESERVES ANCHORS AND ALIASES instead of expanding them', () => {
    // `noRefs: true` on the round-trip path flattens these into
    // duplicated literal blocks — irreversibly, since the intent to share
    // is gone once the text is duplicated.
    const raw = [
      'defaults: &defaults',
      '  retries: 3',
      '  timeout: 30',
      'staging:',
      '  <<: *defaults',
      '  host: stg.example.com',
      ''
    ].join('\n')

    const out = applied(raw)
    expect(out).toContain('&defaults')
    expect(out).toContain('*defaults')
    // The anchor appears exactly once — it was not expanded into a copy.
    expect(out.match(/retries: 3/g)).toHaveLength(1)
  })

  it('preserves quoting and indentation style', () => {
    const out = applied("name: 'single quoted'\nnested:\n    deeply: true\n")
    expect(out).toContain("name: 'single quoted'")
    expect(out).toContain('    deeply: true')
  })

  it('accepts a document with a single leading marker', () => {
    const out = applied('---\nname: My project\n')
    expect(yaml.load(out)).toEqual({ name: 'My project', [KEY]: UUID })
  })

  it('refuses a multi-document stream', () => {
    // The key would silently join the LAST document, not the caller's.
    expect(setTopLevelKey('---\nname: first\n---\nname: second\n', KEY, UUID, 'yaml')).toBeNull()
  })

  it('refuses an explicit end-of-document marker', () => {
    expect(setTopLevelKey('name: only\n...\n', KEY, UUID, 'yaml')).toBeNull()
  })

  it('refuses a sequence root', () => {
    expect(setTopLevelKey('- one\n- two\n', KEY, UUID, 'yaml')).toBeNull()
  })

  // A flow-style root is now STAMPED rather than refused (see the dedicated
  // describe below). Refusing it meant a freshly created, still-empty project
  // — serialised as `{}` — was the one document that could never carry an
  // identity, which is precisely the document where nothing is at risk.
  it('stamps a flow-style root in place', () => {
    const out = applied('{ name: My project }\n')
    expect(yaml.load(out)).toEqual({ name: 'My project', [KEY]: UUID })
  })

  it('refuses a scalar root', () => {
    expect(setTopLevelKey('just a string\n', KEY, UUID, 'yaml')).toBeNull()
  })

  it('refuses to overwrite a key that already holds a real value', () => {
    // Filling a blank is repair; replacing a real identity is data loss.
    expect(setTopLevelKey(`${KEY}: existing\nname: x\n`, KEY, UUID, 'yaml')).toBeNull()
  })

  it('fills a blank value in place, keeping the comments around it', () => {
    // A document whose identity was blanked would otherwise never get
    // one, since the key cannot be inserted twice.
    const out = applied(['# keep me', `${KEY}: ''`, 'name: My project  # and me', ''].join('\n'))
    expect(out).toContain('# keep me')
    expect(out).toContain('# and me')
    expect(yaml.load(out)).toEqual({ [KEY]: UUID, name: 'My project' })
  })

  it('fills a bare empty value in place', () => {
    const out = applied(`${KEY}:\nname: x\n`)
    expect(yaml.load(out)).toEqual({ [KEY]: UUID, name: 'x' })
  })

  it('does not mistake a nested key of the same name for the top-level one', () => {
    // The top-level key really is absent here, so it gets inserted — and
    // the identically-named nested slot must be left exactly as it was.
    const out = applied(`nested:\n  ${KEY}: ''\nname: x\n`)
    expect(yaml.load(out)).toEqual({
      nested: { [KEY]: '' },
      name: 'x',
      [KEY]: UUID
    })
  })

  it('starts a mapping in an empty document', () => {
    expect(yaml.load(applied(''))).toEqual({ [KEY]: UUID })
  })

  it('refuses unparsable input rather than replacing it', () => {
    expect(setTopLevelKey('name: [unclosed\n', KEY, UUID, 'yaml')).toBeNull()
  })
})

describe('setTopLevelKey — JSON', () => {
  it('adds the key and keeps existing formatting', () => {
    const out = applied('{\n  "name": "My project",\n  "version": 3\n}\n', 'json')
    expect(JSON.parse(out)).toEqual({ name: 'My project', version: 3, [KEY]: UUID })
    expect(out).toContain('"name": "My project"')
  })

  it('handles an empty object', () => {
    expect(JSON.parse(applied('{}', 'json'))).toEqual({ [KEY]: UUID })
  })

  it('refuses an array root', () => {
    expect(setTopLevelKey('[1, 2, 3]', KEY, UUID, 'json')).toBeNull()
  })

  it('refuses unparsable input', () => {
    expect(setTopLevelKey('{ "name": ', KEY, UUID, 'json')).toBeNull()
  })
})

describe('setTopLevelKey — JSON5', () => {
  it('PRESERVES COMMENTS', () => {
    // JSON5 permits comments and `JSON5.stringify` drops them, so json5
    // documents are exposed to the same loss as YAML ones.
    const raw = [
      '{',
      '  // the team-facing name',
      '  name: "My project",',
      '  /* kept deliberately */',
      '  version: 3,',
      '}',
      ''
    ].join('\n')

    const out = applied(raw, 'json5')
    expect(out).toContain('// the team-facing name')
    expect(out).toContain('/* kept deliberately */')
    expect(out).toContain('name: "My project"')
  })

  it('refuses an array root', () => {
    expect(setTopLevelKey('[1, 2]', KEY, UUID, 'json5')).toBeNull()
  })
})

describe('setTopLevelKey — a numeric value', () => {
  // Documents carry more than identities at their top level: an on-disk
  // format version is a number, and writing it as a quoted string would
  // parse back as a string — which the round-trip check catches, so the
  // insertion would be refused outright rather than silently wrong.
  const VERSION_KEY = 'fileFormatVersion'

  it('writes a bare YAML scalar that parses back as a number', () => {
    const out = setTopLevelKey('collections: []\n', VERSION_KEY, 1, 'yaml')
    expect(out).not.toBeNull()
    if (out === null) throw new Error('unreachable — asserted non-null above')
    expect(out).toContain(`${VERSION_KEY}: 1`)
    expect(out).not.toContain(`${VERSION_KEY}: '1'`)
    expect(out).not.toContain(`${VERSION_KEY}: "1"`)
    expect(yaml.load(out)).toEqual({ collections: [], [VERSION_KEY]: 1 })
  })

  it('keeps the comments of the document it is added to', () => {
    const raw = [
      '# Project index — hand-authored.',
      '_projectUuid: 8b1f  # stamped on first open',
      ''
    ].join('\n')

    const out = setTopLevelKey(raw, VERSION_KEY, 1, 'yaml')
    expect(out).not.toBeNull()
    if (out === null) throw new Error('unreachable — asserted non-null above')
    expect(out).toContain('# Project index — hand-authored.')
    expect(out).toContain('# stamped on first open')
    expect(yaml.load(out)).toEqual({ _projectUuid: '8b1f', [VERSION_KEY]: 1 })
  })

  it('writes a JSON number, not a string', () => {
    const out = setTopLevelKey('{"collections": []}', VERSION_KEY, 2, 'json')
    expect(out).not.toBeNull()
    if (out === null) throw new Error('unreachable — asserted non-null above')
    expect(JSON.parse(out)).toEqual({ collections: [], [VERSION_KEY]: 2 })
  })

  it('writes a JSON5 number and keeps the comments around it', () => {
    // Reachable: a folder project can be json5, so its root index takes
    // the same numeric stamp a YAML one does.
    const raw = [
      '{',
      '  // the project identity, stamped on first open',
      '  _projectUuid: "abc",',
      '  /* nothing else belongs at the root */',
      '}',
      ''
    ].join('\n')

    const out = setTopLevelKey(raw, VERSION_KEY, 1, 'json5')
    expect(out).not.toBeNull()
    if (out === null) throw new Error('unreachable — asserted non-null above')
    expect(out).toContain('// the project identity, stamped on first open')
    expect(out).toContain('/* nothing else belongs at the root */')
    const parsed: Record<string, unknown> = JSON5.parse(out)
    expect(parsed[VERSION_KEY]).toBe(1)
    expect(typeof parsed[VERSION_KEY]).toBe('number')
    expect(parsed['_projectUuid']).toBe('abc')
  })

  it('refuses a JSON5 root that declares the key as an explicit null', () => {
    // YAML spells a valueless key as `null` and treats it as a blank slot
    // to fill; JSON5's explicit `null` is a real value, so the insertion
    // is refused and the file is left exactly as it is. Refusal, never
    // repair — the cost is that such a project never acquires a stamp,
    // and only the caller's log line says why.
    expect(setTopLevelKey('{ "fileFormatVersion": null }', VERSION_KEY, 1, 'json5')).toBeNull()
  })

  it('fills a blank slot in place', () => {
    const out = setTopLevelKey(`${VERSION_KEY}:\nname: My project\n`, VERSION_KEY, 1, 'yaml')
    expect(out).not.toBeNull()
    if (out === null) throw new Error('unreachable — asserted non-null above')
    expect(yaml.load(out)).toEqual({ [VERSION_KEY]: 1, name: 'My project' })
  })

  it('never overwrites a version the document already declares', () => {
    // Only a migration may move a format version, and a textual key
    // insertion is not one.
    expect(setTopLevelKey(`${VERSION_KEY}: 1\nname: My project\n`, VERSION_KEY, 2, 'yaml')).toBeNull()
  })

  it('refuses a value that cannot survive the round-trip', () => {
    // NaN has no YAML/JSON spelling that parses back as itself, so the
    // verify step rejects the candidate and the file is left alone.
    expect(setTopLevelKey('name: My project\n', VERSION_KEY, Number.NaN, 'yaml')).toBeNull()
  })
})

describe('setTopLevelKey — a YAML root in flow style', () => {
  // The shape a freshly created, still-empty project has on disk. Appending a
  // column-0 line after `{}` is not valid YAML, so the round-trip check used to
  // refuse it — leaving the one document with nothing to protect as the one
  // document that could never be stamped.
  it('stamps an empty flow mapping', () => {
    const out = applied('{}')
    expect(yaml.load(out)).toEqual({ [KEY]: UUID })
  })

  it('stamps an empty flow mapping with a trailing newline', () => {
    expect(yaml.load(applied('{}\n'))).toEqual({ [KEY]: UUID })
  })

  it('keeps the existing members of a populated flow mapping', () => {
    const out = applied('{name: My project, version: 3}\n')
    expect(yaml.load(out)).toEqual({ name: 'My project', version: 3, [KEY]: UUID })
  })

  it('stamps through a document-start marker', () => {
    expect(yaml.load(applied('---\n{}\n'))).toEqual({ [KEY]: UUID })
  })

  it('preserves a comment sitting above the mapping', () => {
    const out = applied('# my project\n{}\n')
    expect(out).toContain('# my project')
    expect(yaml.load(out)).toEqual({ [KEY]: UUID })
  })

  it('still refuses a multi-document stream', () => {
    expect(setTopLevelKey('{}\n---\n{}\n', KEY, UUID, 'yaml')).toBeNull()
  })
})
