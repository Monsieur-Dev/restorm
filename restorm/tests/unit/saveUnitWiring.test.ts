/**
 * Integration check for the save-unit wiring restorm installs on top of
 * `electron-core-ui`'s save-unit primitives.
 *
 * The scenario exercises the invariant that makes the
 * DocumentEvents → upsertSaveUnit bridge correct:
 * the cleansed draft sent by the renderer on a mutate MUST match the
 * content the decomposer produces on save for the same node. That's
 * what lets `commitIfDraftMatches` succeed and the dirty dot flip off.
 *
 * We wire the real lib (no mocks) and assert the shapes stay aligned
 * across a realistic request model (HTTPRequest) with headers that
 * include a `SecretValue` whose resolved plaintext must never emit.
 */

import { describe, it, expect } from 'vitest'
import {
  SaveUnitRegistry,
  decomposeForPersistence,
  cleanseForPersistence
} from 'electron-core-ui'
import { HTTPRequest } from '../../src/shared/models/requests/HTTPRequest'
import { Folder as FolderClass } from '../../src/shared/models/Folder'
import { EnvironmentFolder as EnvironmentFolderClass } from '../../src/shared/models/EnvironmentFolder'
import { ApiDesign as ApiDesignClass } from '../../src/shared/models/ApiDesign'
import { buildReferenceApiDesign } from './apiDesignReference'
import { KeyValue } from '../../src/shared/models/KeyValue'
import { SecretValue } from '../../src/shared/types/valueTypes/SecretValue'
import { StringValue } from '../../src/shared/types/valueTypes/StringValue'

const classResolver = (item: Record<string, unknown>, parentClass: object | undefined): object | undefined => {
  const type = item['type']
  if (type === 'http') return HTTPRequest
  if (type === 'design') return ApiDesignClass
  if (parentClass === EnvironmentFolderClass || parentClass === FolderClass) return FolderClass
  return undefined
}

describe('save-unit wiring (restorm ↔ lib)', () => {
  it('cleansed draft matches decomposer content for the same request node', () => {
    const request = new HTTPRequest()
    request.id = 'req-1'
    request.name = 'Login'
    request.type = 'http'
    request.method = 'POST'
    request.url = 'https://api.example.com/login'
    const secret = new SecretValue('envVar', { name: 'TOKEN' })
    secret.resolved = 'bearer-leak-me-not'
    request.headers = [
      new KeyValue({ key: 'X-Trace', value: new StringValue('abc') }),
      new KeyValue({ key: 'Authorization', value: secret })
    ]

    const folder = new EnvironmentFolderClass({
      id: 'env-1',
      name: 'Prod',
      items: [request]
    })

    // JSON-round-trip mirrors what useFileManagement does before feeding
    // the decomposer. `SecretValue.toJSON` strips the resolved plaintext here.
    const rootPojo = JSON.parse(JSON.stringify(folder)) as Record<string, unknown>

    const decomposed = decomposeForPersistence({
      root: rootPojo,
      rootClass: EnvironmentFolderClass,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml',
      classResolver
    })

    const requestEntry = decomposed.children.find((c) => c.runtimeId === 'req-1')
    expect(requestEntry).toBeDefined()

    // No plaintext password anywhere in the decomposer output.
    expect(JSON.stringify(requestEntry)).not.toContain('bearer-leak-me-not')

    // The cleansed draft (what the DocumentEvents bridge sends) is the
    // exact same shape as the decomposer's content slice.
    const rawItemClone = JSON.parse(JSON.stringify(request)) as Record<string, unknown>
    const bridgeDraft = cleanseForPersistence(rawItemClone, HTTPRequest)
    expect(bridgeDraft).toEqual(requestEntry?.content)
  })

  it('cleansed draft matches decomposer content for a design node (leaf unit)', () => {
    // A design is one save unit: its models/enums/routeGroups are tab
    // sections, never child units. The bridge's cleansed draft must be
    // byte-for-byte the decomposer's content slice, or
    // `commitIfDraftMatches` never matches and the unit stays dirty
    // after every save.
    const design = ApiDesignClass.fromPlain(buildReferenceApiDesign())
    const folder = new EnvironmentFolderClass({
      id: 'env-1',
      name: 'Prod',
      items: [design]
    })

    const rootPojo = JSON.parse(JSON.stringify(folder)) as Record<string, unknown>
    const decomposed = decomposeForPersistence({
      root: rootPojo,
      rootClass: EnvironmentFolderClass,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml',
      classResolver
    })

    const designEntry = decomposed.children.find((c) => c.runtimeId === 'design-petstore')
    if (designEntry === undefined) throw new Error('the design must decompose as its own unit')
    // A leaf: the design decomposes as its own unit, with no child units
    // split out of it.
    expect(decomposed.children.some((c) => c.parentId === 'design-petstore')).toBe(false)
    const content = designEntry.content
    expect(Array.isArray(content['models'])).toBe(true)

    const rawItemClone = JSON.parse(JSON.stringify(design)) as Record<string, unknown>
    const bridgeDraft = cleanseForPersistence(rawItemClone, ApiDesignClass)
    expect(bridgeDraft).toEqual(designEntry.content)
  })

  it('pins the m-14 design fields (tags / paramEnumRefs / memberNames / codegenVars / contentTypes) through cleanse + decompose', () => {
    // The rich reference fixture predates these fields; this design carries all
    // of them so a future cleanse/decompose that dropped one is caught here
    // (either path dropping a field breaks the byte-for-byte match).
    const plain = {
      type: 'design',
      id: 'design-m14',
      name: 'M14',
      info: { title: 'M14', version: '1.0.0' },
      models: [{ id: 'm1', doc: { name: 'User' }, properties: [{ id: 'p1', doc: { name: 'id', type: 'string' } }] }],
      enums: [{ id: 'e1', doc: { name: 'Status', properties: [], enumValues: ['open', 'closed'] }, memberNames: ['OPEN', 'CLOSED'] }],
      routeGroups: [{
        id: 'g1',
        doc: { name: 'Users', tags: ['shared'] },
        routes: [{
          id: 'r1',
          doc: {
            match: { method: 'GET', urlPattern: '/users' },
            summary: 'List',
            tags: ['list'],
            parameters: [{ name: 'kind', location: 'query', type: 'string', required: false }]
          },
          design: {
            paramEnumRefs: { kind: 'e1' },
            body: { modelId: 'm1', contentTypes: ['application/json', 'application/xml'] },
            codegenVars: { 'tmpl-1': { route: { path: '/x' } } }
          }
        }]
      }]
    }
    const design = ApiDesignClass.fromPlain(plain)
    const folder = new EnvironmentFolderClass({ id: 'env-m14', name: 'Prod', items: [design] })
    const rootPojo = JSON.parse(JSON.stringify(folder)) as Record<string, unknown>
    const decomposed = decomposeForPersistence({ root: rootPojo, rootClass: EnvironmentFolderClass, basePath: '/tmp/proj', format: 'yaml', extension: 'yaml', classResolver })
    const designEntry = decomposed.children.find((c) => c.runtimeId === 'design-m14')
    if (designEntry === undefined) throw new Error('the design must decompose as its own unit')

    // The bridge's cleansed draft still matches the decomposer byte-for-byte…
    const bridgeDraft = cleanseForPersistence(JSON.parse(JSON.stringify(design)) as Record<string, unknown>, ApiDesignClass)
    expect(bridgeDraft).toEqual(designEntry.content)

    // …and each new field actually survived (not silently dropped by both).
    const content = designEntry.content
    const group = (content['routeGroups'] as Record<string, unknown>[])[0]
    const route = (group['routes'] as Record<string, unknown>[])[0]
    const routeDesign = route['design'] as Record<string, unknown>
    const enumEntry = (content['enums'] as Record<string, unknown>[])[0]
    expect((group['doc'] as Record<string, unknown>)['tags']).toEqual(['shared'])
    expect((route['doc'] as Record<string, unknown>)['tags']).toEqual(['list'])
    expect(routeDesign['paramEnumRefs']).toEqual({ kind: 'e1' })
    expect(routeDesign['codegenVars']).toEqual({ 'tmpl-1': { route: { path: '/x' } } })
    expect((routeDesign['body'] as Record<string, unknown>)['contentTypes']).toEqual(['application/json', 'application/xml'])
    expect(enumEntry['memberNames']).toEqual(['OPEN', 'CLOSED'])
  })

  it('commitIfDraftMatches succeeds when the renderer bridges the same node it later saves', () => {
    const registry = new SaveUnitRegistry()
    const request = new HTTPRequest()
    request.id = 'req-2'
    request.name = 'Ping'
    request.type = 'http'
    request.method = 'GET'
    request.url = 'https://api.example.com/ping'
    request.headers = []

    // Hydrate the registry with a stable reference (initial state).
    const referencePojo = cleanseForPersistence(
      JSON.parse(JSON.stringify(request)) as Record<string, unknown>,
      HTTPRequest
    )
    registry.hydrate({ runtimeId: 'req-2', kind: 'file', reference: referencePojo })

    // User mutates → bridge sends cleansed draft.
    request.name = 'Ping v2'
    const mutatedDraft = cleanseForPersistence(
      JSON.parse(JSON.stringify(request)) as Record<string, unknown>,
      HTTPRequest
    )
    registry.mutate('req-2', mutatedDraft)
    expect(registry.isDirty('req-2')).toBe(true)

    // Save path: decomposer walks the tree and produces the SAME shape
    // (same node → same cleanse → same output).
    const envFolder = new EnvironmentFolderClass({ id: 'env-2', name: 'Dev', items: [request] })
    const decomposed = decomposeForPersistence({
      root: JSON.parse(JSON.stringify(envFolder)) as Record<string, unknown>,
      rootClass: EnvironmentFolderClass,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml',
      classResolver
    })
    const entry = decomposed.children.find((c) => c.runtimeId === 'req-2')
    if (!entry) throw new Error('decomposer did not surface req-2')

    // The commit succeeds because the shapes match.
    const committed = registry.commitIfDraftMatches('req-2', entry.content)
    expect(committed).toBe(true)
    expect(registry.isDirty('req-2')).toBe(false)
  })

  it('a later mutation between bridge-upsert and save leaves the unit dirty (no clobber)', () => {
    const registry = new SaveUnitRegistry()
    registry.hydrate({ runtimeId: 'req-3', kind: 'file', reference: { name: 'v1' } })

    // First mutation landing via the bridge.
    registry.mutate('req-3', { name: 'v2' })

    // Caller captures a snapshot of v2 to save …
    const snapshot = { name: 'v2' }

    // … but before the save completes, the user edits again — the
    // bridge upserts v3 into the registry.
    registry.mutate('req-3', { name: 'v3' })

    const committed = registry.commitIfDraftMatches('req-3', snapshot)
    expect(committed).toBe(false)
    expect(registry.isDirty('req-3')).toBe(true)
    const unit = registry.get('req-3')
    expect(unit?.draft).toEqual({ name: 'v3' })
  })
})
