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
 * include a `PasswordValue` — which must never emit plaintext.
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
import { KeyValue } from '../../src/shared/models/KeyValue'
import { PasswordValue } from '../../src/shared/types/valueTypes/PasswordValue'
import { StringValue } from '../../src/shared/types/valueTypes/StringValue'

const classResolver = (item: Record<string, unknown>, parentClass: object | undefined): object | undefined => {
  const type = item['type']
  if (type === 'http') return HTTPRequest
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
    request.headers = [
      new KeyValue({ key: 'X-Trace', value: new StringValue('abc') }),
      new KeyValue({ key: 'Authorization', value: new PasswordValue('bearer-leak-me-not') })
    ]

    const folder = new EnvironmentFolderClass({
      id: 'env-1',
      name: 'Prod',
      items: [request]
    })

    // JSON-round-trip mirrors what useFileManagement does before feeding
    // the decomposer. `PasswordValue.toJSON` strips plaintext here.
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
