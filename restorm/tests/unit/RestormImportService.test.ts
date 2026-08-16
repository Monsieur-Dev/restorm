/**
 * Unit tests for `RestormImportService` — the restorm→restorm project merge
 * importer. Parses the committed mini-project fixture (shaped like an
 * app-saved `.restorm`: root `fileFormatVersion` + `collections` +
 * `_projectUuid`) and asserts the wrapper-folder shape, the full
 * re-identification of every id-bearing node, the reference remap, and the
 * file-format gate.
 *
 * DELIBERATE divergence from the import playbook's idempotency rule: this
 * format re-identifies on every parse, so parsing twice yields DIFFERENT
 * ids. For a project merge that is the specification, not a defect —
 * importing a file into itself must produce a clean duplicate set, never a
 * dedupe/overwrite. A test below pins that divergence on purpose.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parse as yamlParse } from 'yaml'
import { detectFormat } from '../../src/main/services/import/ImportManager'
import { importProviders } from '../../src/main/services/import/providers'
import { RESTORM_IMPORT_FORMAT } from '../../src/main/services/import/RestormImportService'
import { parseImportError } from '../../src/shared/config/importErrors'
import { CURRENT_FILE_FORMAT_VERSION } from '../../src/shared/config/fileFormatVersion'

const fixturePath = join(__dirname, 'fixtures/restorm/mini-project.restorm')
const fixture = readFileSync(fixturePath, 'utf-8')

const provider = importProviders.find((p) => p.format === RESTORM_IMPORT_FORMAT)
if (!provider) throw new Error('restorm provider not registered')

/** Every `id` string found anywhere in a JSON-ish tree. */
function collectIds(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const v of node) collectIds(v, out)
    return out
  }
  if (node === null || typeof node !== 'object') return out
  const rec = node as Record<string, unknown>
  if (typeof rec['id'] === 'string' && rec['id'] !== '') out.push(rec['id'])
  for (const v of Object.values(rec)) collectIds(v, out)
  return out
}

function findByName(node: unknown, name: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findByName(v, name)
      if (hit) return hit
    }
    return null
  }
  if (node === null || typeof node !== 'object') return null
  const rec = node as Record<string, unknown>
  if (rec['name'] === name) return rec
  for (const v of Object.values(rec)) {
    const hit = findByName(v, name)
    if (hit) return hit
  }
  return null
}

describe('RestormImportService — detection', () => {
  it('claims a file by its .restorm extension alone (empty-content probe)', () => {
    expect(provider.canImport('', '/some/where/project.restorm')).toBe(true)
    expect(provider.canImport('', '/some/where/spec.har')).toBe(false)
  })

  it('claims pasted content carrying both root keys, and nothing less', () => {
    expect(provider.canImport(fixture)).toBe(true)
    expect(provider.canImport('collections:\n  - id: x\n')).toBe(false)
    expect(provider.canImport('fileFormatVersion: 1\nsomething: else\n')).toBe(false)
    expect(provider.canImport(JSON.stringify({ openapi: '3.0.0' }))).toBe(false)
  })

  it('detectFormat routes the fixture to the restorm provider', () => {
    expect(detectFormat(fixture, '/tmp/mini-project.restorm')).toBe(RESTORM_IMPORT_FORMAT)
    expect(detectFormat(fixture)).toBe(RESTORM_IMPORT_FORMAT)
  })

  it('opts out of the empty-key-value auto-disable (user-authored data)', () => {
    expect(provider.preserveEmptyKeyValues).toBe(true)
  })
})

describe('RestormImportService — parse', () => {
  it('wraps the source collections under one folder named after the file', () => {
    const folder = provider.parse(fixture, { filePath: '/home/user/projects/team-apis.restorm' })
    expect(folder.name).toBe('team-apis')
    expect(folder.items).toHaveLength(2)
    expect((folder as { folderType?: string }).folderType).toBeUndefined()
  })

  it('falls back to a generic wrapper name for pasted content', () => {
    const folder = provider.parse(fixture, {})
    expect(folder.name).toBe('Restorm')
  })

  it('re-identifies EVERY id-bearing node — no source id survives', () => {
    const sourceIds = new Set(collectIds(yamlParse(fixture)))
    const folder = provider.parse(fixture, { filePath: '/x/y.restorm' })
    const importedIds = collectIds(folder)
    expect(importedIds.length).toBeGreaterThanOrEqual(12)
    for (const id of importedIds) expect(sourceIds.has(id)).toBe(false)
    expect(new Set(importedIds).size).toBe(importedIds.length)
  })

  it('remaps every internal reference onto the new ids (scenario binding, edges, auth, quick config, enum)', () => {
    const folder = provider.parse(fixture, { filePath: '/x/y.restorm' })

    const request = findByName(folder, 'GetPets')
    const auth = findByName(folder, 'Login')
    const scenario = findByName(folder, 'FetchFlow')
    expect(request && auth && scenario).toBeTruthy()

    // request → auth route
    expect(request?.['authenticationRequestId']).toBe(auth?.['id'])

    // request's own quick config points back at the re-id'd request
    const quickConfigs = request?.['quickConfigs'] as { requestId: string }[]
    expect(quickConfigs[0]?.requestId).toBe(request?.['id'])

    // scenario node → request binding + edge endpoints follow the new node ids
    const nodes = scenario?.['nodes'] as { id: string; config?: { requestId?: string } }[]
    const edges = scenario?.['edges'] as { from: { nodeId: string; portId: string }; to: { nodeId: string } }[]
    const httpNode = nodes.find((n) => n.config?.requestId !== undefined)
    expect(httpNode?.config?.requestId).toBe(request?.['id'])
    const nodeIds = new Set(nodes.map((n) => n.id))
    const edge = edges[0]
    if (!edge) throw new Error('fixture scenario must carry one edge')
    expect(nodeIds.has(edge.from.nodeId)).toBe(true)
    expect(nodeIds.has(edge.to.nodeId)).toBe(true)
    // port ids are structural labels, never reassigned
    expect(edge.from.portId).toBe('response')

    // enum-typed variable follows its re-id'd definition
    const envFolder = findByName(folder, 'PetAPI')
    const enumDefs = envFolder?.['enumDefinitions'] as { id: string }[]
    const petStatusVar = (findByName(folder, 'Dev')?.['variables'] as { key: string; value: { enumDefinitionId?: string } }[])
      .find((v) => v.key === 'petStatus')
    expect(petStatusVar?.value.enumDefinitionId).toBe(enumDefs[0]?.id)
  })

  it('parses twice with DIFFERENT ids — the specified anti-idempotence of a project merge', () => {
    const first = collectIds(provider.parse(fixture, { filePath: '/x/y.restorm' }))
    const second = new Set(collectIds(provider.parse(fixture, { filePath: '/x/y.restorm' })))
    for (const id of first) expect(second.has(id)).toBe(false)
  })

  it('preserves content verbatim otherwise — names, urls, variable values, empty-but-enabled rows', () => {
    const folder = provider.parse(fixture, { filePath: '/x/y.restorm' })
    const request = findByName(folder, 'GetPets')
    expect(request?.['url']).toBe('{{baseUrl}}/pets')
    const headers = request?.['headers'] as { key: string; enabled: boolean }[]
    expect(headers[0]).toMatchObject({ key: 'Accept', enabled: true })
    const dev = findByName(folder, 'Dev')
    const baseUrl = (dev?.['variables'] as { key: string; value: { value?: string } }[]).find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.value).toBe('http://localhost:8080')
  })
})

describe('RestormImportService — file-format gate (same refusals as opening)', () => {
  it('refuses a document declaring a NEWER format version, as a coded error', () => {
    const tooNew = fixture.replace('fileFormatVersion: 1', 'fileFormatVersion: 99')
    let message = ''
    try {
      provider.parse(tooNew, { filePath: '/x/y.restorm' })
    } catch (e) {
      message = (e as Error).message
    }
    const decoded = parseImportError(message)
    expect(decoded?.code).toBe('projectFormatTooNew')
    expect(decoded?.params).toMatchObject({ found: '99', current: String(CURRENT_FILE_FORMAT_VERSION) })
  })

  it('refuses a document declaring NO format version, as a coded error', () => {
    const versionless = fixture.replace(/^fileFormatVersion: 1\n/, '')
    let message = ''
    try {
      provider.parse(versionless, { filePath: '/x/y.restorm' })
    } catch (e) {
      message = (e as Error).message
    }
    expect(parseImportError(message)?.code).toBe('projectFormatMissing')
  })
})
