/**
 * Unit tests for `OpenRpcImportService` — parses an OpenRPC document
 * fixture and asserts the shape of the generated EnvironmentFolder + its
 * `JsonRpcRequest`s (positional / named params, `$ref` resolution,
 * deprecated flag).
 */

vi.mock('electron-core-ui', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { importOpenRpc } from '../../src/main/services/import/OpenRpcImportService'
import { openrpcImportAdapter } from '../../src/main/services/import/idempotent/OpenRpcAdapter'
import { applyApiUpdate } from '../../src/main/services/apiUpdate/applyApiUpdate'
import { JsonRpcRequest } from '../../src/shared/models'
import type { Folder } from '../../src/shared/types/collections'
import type { EnvironmentFolder } from '../../src/shared/types/folderTypes'

const fixturePath = join(__dirname, 'fixtures/openrpc/echo.openrpc.json')
const fixture = readFileSync(fixturePath, 'utf-8')

function expectPresent<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be present`)
  }
  return value
}

function methodsFolder(root: ReturnType<typeof importOpenRpc>): Folder {
  const folder = (root.items as Folder[]).find((f): f is Folder => 'items' in f && f.name === 'Methods')
  return expectPresent(folder, 'folder "Methods"')
}

function findRequest(folder: Folder, method: string): JsonRpcRequest {
  const request = folder.items.find((i): i is JsonRpcRequest => i instanceof JsonRpcRequest && i.method === method)
  return expectPresent(request, `jsonrpc request for method "${method}"`)
}

describe('importOpenRpc', () => {
  it('returns an EnvironmentFolder with an openrpc import origin', () => {
    const root = importOpenRpc(fixture, { sourceUrl: 'http://example.com/openrpc.json' })
    expect(root.folderType).toBe('environment')
    expect(root.importSource).toBe('openrpc')
    expect(root.name).toBe('Echo JSON-RPC API')
  })

  it('derives the environment baseUrl from the first server entry', () => {
    const root = importOpenRpc(fixture)
    expect(root.environments).toHaveLength(1)
    const env = expectPresent(root.environments[0], 'environment[0]')
    const baseUrl = env.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.toString()).toBe('http://localhost:8080/rpc')
  })

  it('honours a caller-supplied baseUrl override', () => {
    const root = importOpenRpc(fixture, { baseUrl: 'https://prod.example.com/rpc' })
    const env = expectPresent(root.environments[0], 'environment[0]')
    const baseUrl = env.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.toString()).toBe('https://prod.example.com/rpc')
    const echo = findRequest(methodsFolder(root), 'echo')
    expect(echo.url).toBe('https://prod.example.com/rpc')
  })

  it('produces one jsonrpc request per method, all pointing at the resolved server URL', () => {
    const root = importOpenRpc(fixture)
    const folder = methodsFolder(root)
    const requests = folder.items.filter((i): i is JsonRpcRequest => i instanceof JsonRpcRequest)
    expect(requests).toHaveLength(3)
    expect(requests.every((r) => r.url === 'http://localhost:8080/rpc')).toBe(true)
  })

  it('composes a positional (array) params sample for paramStructure "by-position"', () => {
    const root = importOpenRpc(fixture)
    const echo = findRequest(methodsFolder(root), 'echo')
    const params: unknown = JSON.parse(echo.params)
    expect(Array.isArray(params)).toBe(true)
    expect(params).toEqual(['', 0])
  })

  it('composes a named (object) params sample for paramStructure "by-name", resolving $ref', () => {
    const root = importOpenRpc(fixture)
    const namedEcho = findRequest(methodsFolder(root), 'namedEcho')
    const params = JSON.parse(namedEcho.params) as { user: { name: string; age: number; active: boolean } }
    expect(params.user).toEqual({ name: '', age: 0, active: false })
  })

  it('carries the deprecated flag through to the request', () => {
    const root = importOpenRpc(fixture)
    const failMethod = findRequest(methodsFolder(root), 'failMethod')
    expect(failMethod.deprecated).toBe(true)
    const echo = findRequest(methodsFolder(root), 'echo')
    expect(echo.deprecated).toBe(false)
  })

  it('re-importing the same document is idempotent at the id level', () => {
    const first = importOpenRpc(fixture)
    const second = importOpenRpc(fixture)
    const firstEcho = findRequest(methodsFolder(first), 'echo')
    const secondEcho = findRequest(methodsFolder(second), 'echo')
    expect(firstEcho.id).toBe(secondEcho.id)
  })
})

/**
 * Drives the actual idempotent refresh pipeline (`applyApiUpdate` →
 * `runIdempotentImport`) against a real `importOpenRpc` folder + the
 * `openrpcImportAdapter`'s normalised spec — not just id-hash stability
 * across two parse calls. This is what proves a re-import doesn't
 * duplicate requests and a "Refresh from source" round-trip surfaces
 * added / removed methods correctly.
 */
describe('OpenRPC idempotent refresh (applyApiUpdate)', () => {
  const parsedFixture = JSON.parse(fixture) as { methods: { name: string }[] }

  /** Fixture with only the given methods kept — both the parsed doc
   * (fed to the adapter) and its JSON text (fed to `importOpenRpc`)
   * so the "fresh folder" and "normalised spec" stay in lockstep. */
  function docWithMethods(methodNames: string[]): { parsed: object; content: string } {
    const parsed = { ...parsedFixture, methods: parsedFixture.methods.filter((m) => methodNames.includes(m.name)) }
    return { parsed, content: JSON.stringify(parsed) }
  }

  it('re-applying the unchanged spec produces an empty diff', () => {
    const target = importOpenRpc(fixture)
    const freshFolder = importOpenRpc(fixture)
    const spec = openrpcImportAdapter.extractNormalizedSpec(parsedFixture, {})
    const result = applyApiUpdate({
      target: target as unknown as EnvironmentFolder,
      freshFolder: freshFolder as unknown as EnvironmentFolder,
      spec,
      importSource: 'openrpc'
    })
    expect(result.diff.added).toHaveLength(0)
    expect(result.diff.removed).toHaveLength(0)
  })

  it('flags a method dropped from the spec as removed, without deleting the request', () => {
    const target = importOpenRpc(fixture)
    const { parsed, content } = docWithMethods(['echo', 'namedEcho'])
    const freshFolder = importOpenRpc(content)
    const spec = openrpcImportAdapter.extractNormalizedSpec(parsed, {})
    const result = applyApiUpdate({
      target: target as unknown as EnvironmentFolder,
      freshFolder: freshFolder as unknown as EnvironmentFolder,
      spec,
      importSource: 'openrpc'
    })
    expect(result.diff.removed.map((op) => op.naturalKey)).toEqual(['failMethod'])
    const stillThere = findRequest(methodsFolder(target), 'failMethod')
    expect(stillThere.removed).toBe(true)
  })

  it('appends a fresh request for a method added to the spec', () => {
    const { content: reducedContent } = docWithMethods(['echo', 'namedEcho'])
    const target = importOpenRpc(reducedContent)
    const freshFolder = importOpenRpc(fixture)
    const spec = openrpcImportAdapter.extractNormalizedSpec(parsedFixture, {})
    const result = applyApiUpdate({
      target: target as unknown as EnvironmentFolder,
      freshFolder: freshFolder as unknown as EnvironmentFolder,
      spec,
      importSource: 'openrpc'
    })
    expect(result.diff.added.map((op) => op.naturalKey)).toEqual(['failMethod'])
    const added = findRequest(methodsFolder(target), 'failMethod')
    expect(added.deprecated).toBe(true)
  })
})
