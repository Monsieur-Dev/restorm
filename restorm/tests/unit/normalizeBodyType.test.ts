import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { normalizeBodyTypes } from '../../src/shared/config/normalizeBodyType'

/** Recursively collect every `.restorm` file under a directory. */
function findRestormFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.restorm')) {
      out.push(join(entry.parentPath, entry.name))
    }
  }
  return out
}

describe('normalizeBodyTypes', () => {
  it('rewrites legacy camelCase form-data spelling to kebab-case', () => {
    const root = { id: 'r', body: { type: 'formData', fields: [] } }
    normalizeBodyTypes(root)
    expect(root.body.type).toBe('form-data')
  })

  it('rewrites legacy camelCase x-www-form-urlencoded spelling to kebab-case', () => {
    const root = { id: 'r', body: { type: 'xWwwFormUrlEncoded', fields: [] } }
    normalizeBodyTypes(root)
    expect(root.body.type).toBe('x-www-form-urlencoded')
  })

  it('leaves canonical kebab-case body types untouched', () => {
    const root = { id: 'r', body: { type: 'form-data', fields: [] } }
    const snapshot = JSON.parse(JSON.stringify(root))
    normalizeBodyTypes(root)
    expect(root).toEqual(snapshot)
  })

  it('leaves text / file body types untouched', () => {
    const text = { body: { type: 'text', content: 'hi' } }
    const file = { body: { type: 'file', path: '/tmp/x' } }
    normalizeBodyTypes(text)
    normalizeBodyTypes(file)
    expect(text.body.type).toBe('text')
    expect(file.body.type).toBe('file')
  })

  it('recurses into nested folders / items and migrates each body', () => {
    const topRequest = { id: 'a', body: { type: 'formData', fields: [] } }
    const nestedRequest = { id: 'b', body: { type: 'xWwwFormUrlEncoded', fields: [] } }
    const root = {
      folderType: 'environment',
      items: [topRequest, { id: 'folder', items: [nestedRequest] }]
    }
    normalizeBodyTypes(root)
    expect(topRequest.body.type).toBe('form-data')
    expect(nestedRequest.body.type).toBe('x-www-form-urlencoded')
  })

  it('ignores a string-valued body that is not an object', () => {
    const root = { id: 'soap', body: '<xml/>' }
    expect(() => { normalizeBodyTypes(root) }).not.toThrow()
    expect(root.body).toBe('<xml/>')
  })

  it('is a no-op on null / primitive / array inputs', () => {
    expect(() => { normalizeBodyTypes(null) }).not.toThrow()
    expect(() => { normalizeBodyTypes(42) }).not.toThrow()
    expect(() => { normalizeBodyTypes('s') }).not.toThrow()
    expect(() => { normalizeBodyTypes([]) }).not.toThrow()
  })
})

describe('committed sample fixtures are canonical kebab-case (grep gate)', () => {
  it('no .restorm fixture carries a legacy camelCase body.type', () => {
    const repoRoot = join(__dirname, '..', '..')
    const fixtures = [
      ...findRestormFiles(join(repoRoot, 'Samples')),
      ...findRestormFiles(join(repoRoot, 'tests', 'e2e', 'samples'))
    ]
      // The legacy-spelling fixture is intentional input for the
      // on-load migration e2e — it MUST keep its camelCase body types.
      .filter((f) => !f.endsWith('body-type-legacy-sample.restorm'))
    expect(fixtures.length).toBeGreaterThan(0)

    // A persisted body type is a YAML mapping value, e.g. `type: form-data`
    // directly under a `body:` key. Legacy camelCase spellings would show
    // up as `type: formData` / `type: xWwwFormUrlEncoded`. (Bare
    // `formData` strings inside OpenAPI documentation markdown — the
    // Swagger parameter `location` — are unrelated and must stay.)
    const legacyBodyType = /^\s*type:\s*(formData|xWwwFormUrlEncoded)\s*$/m
    const offenders = fixtures.filter((f) => legacyBodyType.test(readFileSync(f, 'utf-8')))
    expect(offenders).toEqual([])
  })
})
