// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// `logger` reaches into the real Electron `app` (unavailable outside a
// running main process) — stub it so the unresolved-include warning path
// doesn't crash under a plain node test environment.
vi.mock('electron-core-ui', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { importThrift, importThriftFromString } from '../../src/main/services/import/ThriftImportService'
import { detectFormat } from '../../src/main/services/import/ImportManager'
import type { Folder } from '../../src/shared/models'

const FIXTURES = join(__dirname, 'fixtures/thrift')
const PETSTORE_PATH = join(FIXTURES, 'petstore.thrift')
const petstoreContent = readFileSync(PETSTORE_PATH, 'utf-8')

describe('ThriftImportService — petstore fixture', () => {
  it('produces an EnvironmentFolder rooted at the namespace, documentation-only', () => {
    const folder = importThrift(petstoreContent, { filePath: PETSTORE_PATH })
    expect(folder.folderType).toBe('environment')
    expect(folder.name).toBe('com.example.petstore')
    expect(folder.importSource).toBe('thrift')
    // No baseUrl / execution context — Thrift's binary wire protocol has no
    // execution service in v1, so there is nothing for an environment to hold.
    expect(folder.environments).toEqual([])
  })

  it('creates one documentation-only folder per service, with no executable requests', () => {
    const folder = importThrift(petstoreContent, { filePath: PETSTORE_PATH })
    const serviceFolder = folder.items.find((item) => (item as Folder).name === 'PetService') as Folder | undefined
    expect(serviceFolder).toBeDefined()
    expect(serviceFolder?.items).toEqual([])
  })

  it('parses structs into apiDocumentation.models with resolved typedef types', () => {
    const folder = importThrift(petstoreContent, { filePath: PETSTORE_PATH })
    const models = folder.apiDocumentation?.models ?? {}

    expect(models.Pet).toBeDefined()
    const idField = models.Pet?.properties.find((p) => p.name === 'id')
    expect(idField?.type).toBe('i64') // `PetId` typedef resolved to its base type
    expect(idField?.required).toBe(true)

    const tagsField = models.Pet?.properties.find((p) => p.name === 'tags')
    expect(tagsField?.type).toBe('list<Tag>')
    expect(tagsField?.required).toBe(false) // marked `optional`

    // Exceptions are struct-like (name + fields) and map the same way.
    expect(models.PetNotFoundException).toBeDefined()
  })

  it('exposes services + methods as documentation-only operations (no execution)', () => {
    const folder = importThrift(petstoreContent, { filePath: PETSTORE_PATH })
    const operations = folder.apiDocumentation?.operations ?? []

    const getPetById = operations.find((op) => op.operationId === 'getPetById')
    expect(getPetById?.match.serviceName).toBe('PetService')
    expect(getPetById?.extra?.documentationOnly).toBe(true)
    expect(getPetById?.parameters?.[0]?.type).toBe('i64')
    expect(getPetById?.referencedModels).toContain('Pet')

    const logAccess = operations.find((op) => op.operationId === 'logAccess')
    expect(logAccess?.extra?.oneway).toBe(true)
  })

  it('extracts enums — including ones merged in from a same-directory include — as EnumDefinition', () => {
    const folder = importThrift(petstoreContent, { filePath: PETSTORE_PATH })
    const statusEnum = folder.enumDefinitions?.find((e) => e.name === 'PetStatus')
    expect(statusEnum).toBeDefined()
    expect(statusEnum?.values).toEqual(['AVAILABLE', 'PENDING', 'SOLD'])
    expect(statusEnum?.matchingRules).toEqual([])
  })

  it('is idempotent — re-parsing the same content yields the same ids and structure', () => {
    const first = importThrift(petstoreContent, { filePath: PETSTORE_PATH })
    const second = importThrift(petstoreContent, { filePath: PETSTORE_PATH })

    expect(second.id).toBe(first.id)
    expect(second.items.map((item) => (item as Folder).id)).toEqual(first.items.map((item) => (item as Folder).id))
    expect(JSON.stringify(second.apiDocumentation)).toBe(JSON.stringify(first.apiDocumentation))
    expect(JSON.stringify(second.enumDefinitions)).toBe(JSON.stringify(first.enumDefinitions))
  })

  it('skips an unresolvable include with a warning instead of throwing', () => {
    const content = 'namespace java x\ninclude "does-not-exist.thrift"\nstruct Empty {}\n'
    expect(() => importThrift(content, { filePath: join(FIXTURES, 'inline.thrift') })).not.toThrow()
  })

  it('does not read a `../` include that escapes the source file directory', () => {
    const content = 'namespace java x\ninclude "../secret-outside-thrift-dir.thrift"\nstruct Empty {}\n'
    const folder = importThrift(content, { filePath: join(FIXTURES, 'inline.thrift') })
    expect(folder.apiDocumentation?.models.Secret).toBeUndefined()
  })

  it('does not read an absolute-path include (regardless of `../` segments)', () => {
    const absoluteSecretPath = join(FIXTURES, '..', 'secret-outside-thrift-dir.thrift')
    const content = `namespace java x\ninclude "${absoluteSecretPath}"\nstruct Empty {}\n`
    const folder = importThrift(content, { filePath: join(FIXTURES, 'inline.thrift') })
    expect(folder.apiDocumentation?.models.Secret).toBeUndefined()
  })
})

describe('ThriftImportService — canImport / auto-detection', () => {
  it('detects Thrift from the .thrift extension', () => {
    expect(detectFormat('struct Anything {}', 'spec.thrift')).toBe('thrift')
  })

  it('detects Thrift from a leading namespace declaration', () => {
    expect(detectFormat('namespace java com.example\nstruct Foo {}')).toBe('thrift')
  })

  it('detects Thrift from a leading service declaration', () => {
    expect(detectFormat('service Foo {\n  void bar()\n}')).toBe('thrift')
  })

  it('does not mis-detect an unrelated text file as Thrift', () => {
    expect(detectFormat('just some plain text, nothing IDL-like here')).not.toBe('thrift')
  })
})

describe('importThriftFromString', () => {
  it('is a thin wrapper around importThrift', () => {
    const folder = importThriftFromString(petstoreContent)
    expect(folder.importSource).toBe('thrift')
    expect(folder.name).toBe('com.example.petstore')
  })
})
