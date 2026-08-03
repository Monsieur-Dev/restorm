import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'
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

  it('refuses a flow-style root', () => {
    expect(setTopLevelKey('{ name: My project }\n', KEY, UUID, 'yaml')).toBeNull()
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
