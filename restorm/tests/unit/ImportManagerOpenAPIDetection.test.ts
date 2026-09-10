import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectFormat } from '../../src/main/services/import/ImportManager'

const FIXTURES = join(__dirname, 'fixtures/openapi')

describe('ImportManager OpenAPI detection', () => {
  it('routes a 3.0 spec to openapi-3.0', () => {
    const content = readFileSync(join(FIXTURES, 'petstore-3.0.json'), 'utf-8')
    expect(detectFormat(content)).toBe('openapi-3.0')
  })

  it('routes a 3.1 spec to openapi-3.1', () => {
    const content = readFileSync(join(FIXTURES, 'petstore-3.1.json'), 'utf-8')
    expect(detectFormat(content)).toBe('openapi-3.1')
  })

  it('routes a 2.0 spec to swagger', () => {
    const content = JSON.stringify({ swagger: '2.0', info: { title: 'x' }, paths: {} })
    expect(detectFormat(content)).toBe('swagger')
  })

  it('detects an unknown major (4.x) as an unsupported OpenAPI version', () => {
    // It IS an OpenAPI document, just a version no provider handles — the
    // catch-all `openapi-unsupported` provider claims it so the importer can
    // show an actionable "unsupported version" message instead of a generic
    // "format not recognised".
    const content = JSON.stringify({ openapi: '4.0.0', info: { title: 'future' }, paths: {} })
    expect(detectFormat(content)).toBe('openapi-unsupported')
  })

  it('treats junk swagger / openapi values as undetected', () => {
    expect(detectFormat(JSON.stringify({ swagger: 'banana' }))).toBeNull()
    expect(detectFormat(JSON.stringify({ openapi: 42 }))).toBeNull()
  })
})

describe('detectFormat — YAML content, no filePath (the URL-import condition)', () => {
  // `importFrom` never passes a `filePath` for a URL-sourced fetch (it's
  // `undefined` — see `ImportManager.ts`'s `importFrom`), so every case here
  // omits the second argument on purpose: this is exactly what `detectFormat`
  // sees for `import_from_url` against a YAML spec.
  it('routes a YAML 3.0 spec to openapi-3.0', () => {
    const content = readFileSync(join(FIXTURES, 'petstore-3.0.yaml'), 'utf-8')
    expect(detectFormat(content)).toBe('openapi-3.0')
  })

  it('routes a YAML 3.1 spec to openapi-3.1', () => {
    const content = readFileSync(join(FIXTURES, 'petstore-3.1.yaml'), 'utf-8')
    expect(detectFormat(content)).toBe('openapi-3.1')
  })

  it('routes a hand-authored spec with comments, block scalars, and anchors to openapi-3.0', () => {
    // Not derived from a JSON twin — real-world YAML idioms (comments,
    // literal/folded block scalars, an anchor/alias pair) must not confuse
    // the JSON.parse-then-yaml.parse fallback.
    const content = readFileSync(join(FIXTURES, 'petstore-3.0-handwritten.yaml'), 'utf-8')
    expect(detectFormat(content)).toBe('openapi-3.0')
  })

  it('routes a YAML 2.0 spec to swagger', () => {
    const content = 'swagger: "2.0"\ninfo:\n  title: Petstore\n  version: "1.0"\npaths: {}\n'
    expect(detectFormat(content)).toBe('swagger')
  })

  it('detects a YAML unknown major (4.x) as an unsupported OpenAPI version', () => {
    const content = 'openapi: 4.0.0\ninfo:\n  title: future\npaths: {}\n'
    expect(detectFormat(content)).toBe('openapi-unsupported')
  })

  it('treats junk YAML swagger / openapi values as undetected', () => {
    expect(detectFormat('swagger: banana\n')).toBeNull()
    expect(detectFormat('openapi: 42\n')).toBeNull()
  })

  it('does not mis-detect unrelated YAML-parseable text as OpenAPI/Swagger', () => {
    // A bare scalar and a plain mapping without either discriminator key are
    // both valid YAML — neither should be claimed.
    expect(detectFormat('just a plain sentence, not a spec')).toBeNull()
    expect(detectFormat('title: Some Doc\ndescription: not a spec\n')).toBeNull()
  })
})
