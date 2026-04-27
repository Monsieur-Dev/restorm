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

  it('treats an unknown major (4.x) as undetected', () => {
    const content = JSON.stringify({ openapi: '4.0.0', info: { title: 'future' }, paths: {} })
    expect(detectFormat(content)).toBeNull()
  })

  it('treats junk swagger / openapi values as undetected', () => {
    expect(detectFormat(JSON.stringify({ swagger: 'banana' }))).toBeNull()
    expect(detectFormat(JSON.stringify({ openapi: 42 }))).toBeNull()
  })
})
