import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
  }
  registerResource(): void { /* unused */ }
  invoke(name: string, args: Record<string, unknown> = {}): { content: { type: 'text'; text: string }[]; isError?: true } {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return handler(args, {}) as { content: { type: 'text'; text: string }[]; isError?: true }
  }
}

interface FakeScenario {
  type: 'scenario'
  id: string
  name: string
  nodes: unknown[]
  edges: unknown[]
}

interface FakeFolder {
  id: string
  name: string
  items: unknown[]
}

const mockState = {
  findById: vi.fn<(id: string) => unknown>(),
  createScenario: vi.fn<(parentId: string, init: { name: string }) => FakeScenario>(),
  getCollections: vi.fn<() => unknown[]>(() => [])
}

const updateScenarioSpy = vi.fn<(id: string, updates: Record<string, unknown>) => unknown>()
const updateEnvironmentSpy = vi.fn<(id: string, patch: Record<string, unknown>) => unknown>()
const updateFolderSpy = vi.fn<(id: string, patch: Record<string, unknown>) => unknown>()
const createEnvironmentSpy = vi.fn<(parentId: string, data: { name: string }, parentEnvironmentId?: string) => { id: string; name: string }>()
const deleteEnvironmentSpy = vi.fn<(id: string) => boolean>()
const moveItemSpy = vi.fn<(id: string, newParentId: string | undefined, index: number | undefined) => unknown>()

const broadcastSpy = vi.fn<() => void>()
const getAllWindowsSpy = vi.fn<() => unknown[]>(() => [])

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => getAllWindowsSpy() }
}))

vi.mock('../../services/CollectionStore', () => ({
  collectionStore: {
    findById: (id: string) => mockState.findById(id),
    createScenario: (parentId: string, init: { name: string }) => mockState.createScenario(parentId, init),
    updateScenario: (id: string, updates: Record<string, unknown>) => updateScenarioSpy(id, updates),
    getCollections: () => mockState.getCollections(),
    updateEnvironment: (id: string, patch: Record<string, unknown>) => updateEnvironmentSpy(id, patch),
    updateFolder: (id: string, patch: Record<string, unknown>) => updateFolderSpy(id, patch),
    createEnvironment: (parentId: string, data: { name: string }, parentEnvironmentId?: string) => createEnvironmentSpy(parentId, data, parentEnvironmentId),
    deleteEnvironment: (id: string) => deleteEnvironmentSpy(id),
    moveItem: (id: string, newParentId: string | undefined, index: number | undefined) => moveItemSpy(id, newParentId, index)
  }
}))

const refreshEnvironmentSecretsSpy = vi.fn<(envId: string) => number>(() => 0)
vi.mock('../../services/ContextService', () => ({
  contextService: {
    refreshEnvironmentSecrets: (envId: string) => refreshEnvironmentSecretsSpy(envId)
  }
}))

vi.mock('./import', () => ({
  broadcastTreeReplace: () => { broadcastSpy() }
}))

vi.mock('./scenario', () => ({ broadcastScenario: () => { broadcastSpy() } }))

import { valueSourceRegistry } from '../../../shared/secrets/valueSourceRegistry'
import { envVarDescriptor } from '../../../shared/secrets/sources/envVar.descriptor'
import { envFileSecretDescriptor } from '../../../shared/secrets/sources/envFileSecret.descriptor'
import { KeyValue } from '../../../shared/models'
import { serializeValueForPersistence } from '../../../shared/utils/valuePersistence'

function parse(result: { content: { type: 'text'; text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

describe('create_scenario MCP tool', () => {
  let mcp: FakeMcpService

  beforeEach(async () => {
    mockState.findById.mockReset()
    mockState.createScenario.mockReset()
    updateScenarioSpy.mockReset()
    broadcastSpy.mockReset()
    getAllWindowsSpy.mockReset()
    getAllWindowsSpy.mockImplementation(() => [])
    mcp = new FakeMcpService()
    // Dynamic import so the vi.mock declarations above land first.
    const { registerWriteTools } = await import('./write')
    registerWriteTools(mcp as unknown as McpService)
  })

  it('rejects an empty parentId', () => {
    const res = mcp.invoke('create_scenario', { parentId: '', name: 'New' })
    expect(res.isError).toBe(true)
    expect(mockState.createScenario).not.toHaveBeenCalled()
  })

  it('rejects an empty name', () => {
    const res = mcp.invoke('create_scenario', { parentId: 'folder-1', name: '' })
    expect(res.isError).toBe(true)
    expect(mockState.createScenario).not.toHaveBeenCalled()
  })

  it('rejects a parentId that points at a request (only folders + scenarios accept children)', () => {
    const fakeRequest = { type: 'http', id: 'req-1', name: 'Some request' }
    mockState.findById.mockImplementation((id) => (id === 'req-1' ? fakeRequest : null))
    const res = mcp.invoke('create_scenario', { parentId: 'req-1', name: 'New' })
    expect(res.isError).toBe(true)
    expect(mockState.createScenario).not.toHaveBeenCalled()
  })

  it('creates the scenario under a folder + broadcasts + triggers save', () => {
    const folder: FakeFolder = { id: 'folder-1', name: 'Folder', items: [] }
    const created: FakeScenario = { type: 'scenario', id: 'scn-new', name: 'New scenario', nodes: [], edges: [] }
    mockState.findById.mockImplementation((id) => (id === 'folder-1' ? folder : null))
    mockState.createScenario.mockImplementation(() => created)

    const res = mcp.invoke('create_scenario', { parentId: 'folder-1', name: 'New scenario' })
    expect(res.isError).toBeUndefined()
    expect(parse(res)).toEqual({ id: 'scn-new', name: 'New scenario', parentId: 'folder-1' })
    expect(mockState.createScenario).toHaveBeenCalledWith('folder-1', { name: 'New scenario' })
    expect(broadcastSpy).toHaveBeenCalledTimes(1)
    // `triggerSave` walks `BrowserWindow.getAllWindows()` to broadcast the
    // autosave IPC — the call is the wire-level proxy for "save was kicked".
    expect(getAllWindowsSpy).toHaveBeenCalled()
  })

  it('accepts a parent that is itself a scenario (scenarios double as folder-like containers)', () => {
    const parentScenario: FakeScenario = { type: 'scenario', id: 'parent-scn', name: 'Parent', nodes: [], edges: [] }
    const created: FakeScenario = { type: 'scenario', id: 'child-scn', name: 'Child', nodes: [], edges: [] }
    mockState.findById.mockImplementation((id) => (id === 'parent-scn' ? parentScenario : null))
    mockState.createScenario.mockImplementation(() => created)

    const res = mcp.invoke('create_scenario', { parentId: 'parent-scn', name: 'Child' })
    expect(res.isError).toBeUndefined()
    expect(parse(res).parentId).toBe('parent-scn')
    expect(mockState.createScenario).toHaveBeenCalledWith('parent-scn', { name: 'Child' })
  })

  it('rename_item renames a scenario through updateScenario', () => {
    const scenario: FakeScenario = { type: 'scenario', id: 's1', name: 'Old', nodes: [], edges: [] }
    mockState.findById.mockImplementation((id) => (id === 's1' ? scenario : null))
    updateScenarioSpy.mockImplementation((id, updates) => {
      if (id !== 's1') return null
      Object.assign(scenario, updates)
      return scenario
    })
    const res = mcp.invoke('rename_item', { id: 's1', newName: 'New' })
    expect(res.isError).toBeUndefined()
    expect(parse(res)).toEqual({ id: 's1', kind: 'scenario', name: 'New' })
    expect(updateScenarioSpy).toHaveBeenCalledWith('s1', { name: 'New' })
    expect(scenario.name).toBe('New')
    // broadcastScenario (mocked onto broadcastSpy) repaints editor + sidebar.
    expect(broadcastSpy).toHaveBeenCalled()
  })
})

describe('move_item MCP tool', () => {
  let mcp: FakeMcpService

  beforeEach(async () => {
    moveItemSpy.mockReset()
    broadcastSpy.mockReset()
    getAllWindowsSpy.mockReset()
    getAllWindowsSpy.mockImplementation(() => [])
    mcp = new FakeMcpService()
    const { registerWriteTools } = await import('./write')
    registerWriteTools(mcp as unknown as McpService)
  })

  it('moves an item, returns the resolved position, and broadcasts + saves', () => {
    moveItemSpy.mockReturnValue({ ok: true, kind: 'scenario', parentId: 'main', index: 2 })
    const res = mcp.invoke('move_item', { itemId: 'demo', newParentId: 'main', index: 2 })
    expect(res.isError).toBeUndefined()
    expect(parse(res)).toEqual({ id: 'demo', kind: 'scenario', parentId: 'main', index: 2 })
    expect(moveItemSpy).toHaveBeenCalledWith('demo', 'main', 2)
    expect(broadcastSpy).toHaveBeenCalledTimes(1)
    expect(getAllWindowsSpy).toHaveBeenCalled()
  })

  it('reorder-only: omitting newParentId passes undefined through and reports parentId null', () => {
    moveItemSpy.mockReturnValue({ ok: true, kind: 'env-folder', parentId: null, index: 0 })
    const res = mcp.invoke('move_item', { itemId: 'envB', index: 0 })
    expect(res.isError).toBeUndefined()
    expect(parse(res)).toEqual({ id: 'envB', kind: 'env-folder', parentId: null, index: 0 })
    expect(moveItemSpy).toHaveBeenCalledWith('envB', undefined, 0)
  })

  it('maps a store rejection to an MCP error and does NOT broadcast or save', () => {
    moveItemSpy.mockReturnValue({ ok: false, error: 'newParentId req-1 is not a container (folder, env-folder or scenario)' })
    const res = mcp.invoke('move_item', { itemId: 'mover', newParentId: 'req-1', index: 0 })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('not a container')
    expect(broadcastSpy).not.toHaveBeenCalled()
  })

  it('rejects a missing itemId before touching the store', () => {
    const res = mcp.invoke('move_item', { itemId: '' })
    expect(res.isError).toBe(true)
    expect(moveItemSpy).not.toHaveBeenCalled()
  })
})

describe('set_env_variable — secret value source', () => {
  let mcp: FakeMcpService

  // An env-folder fixture whose single environment holds the variable list the
  // tool mutates in place. `getCollections` returns it so `findEnvById` +
  // the owner-folder lookup resolve.
  function makeFixture(): { id: string; name: string; variables: KeyValue[]; subEnvironments: unknown[] } {
    const env = { id: 'env-1', name: 'staging', variables: [] as KeyValue[], subEnvironments: [] }
    const folder = { id: 'ef-1', name: 'EF', folderType: 'environment', environments: [env], items: [] }
    mockState.getCollections.mockReturnValue([folder])
    return env
  }

  beforeEach(async () => {
    for (const fn of Object.values(mockState)) fn.mockReset()
    updateScenarioSpy.mockReset(); updateEnvironmentSpy.mockReset(); updateFolderSpy.mockReset()
    broadcastSpy.mockReset(); getAllWindowsSpy.mockReset(); getAllWindowsSpy.mockImplementation(() => [])
    mockState.getCollections.mockReturnValue([])
    // Register the built-in descriptors so source validation has a registry.
    valueSourceRegistry.register(envVarDescriptor)
    valueSourceRegistry.register(envFileSecretDescriptor)
    mcp = new FakeMcpService()
    const { registerWriteTools } = await import('./write')
    registerWriteTools(mcp as unknown as McpService)
  })

  it('accepts a valid secret reference and stores it without plaintext', () => {
    const env = makeFixture()
    const res = mcp.invoke('set_env_variable', {
      envId: 'env-1',
      key: 'API_TOKEN',
      value: { type: 'secret', source: 'envVar', params: { name: 'API_TOKEN' } }
    })
    expect(res.isError).toBeUndefined()
    expect(parse(res)).toMatchObject({ envId: 'env-1', key: 'API_TOKEN', type: 'secret' })
    // The stored KeyValue serializes back to the reference shape — no resolved
    // plaintext field survives the persistence boundary the read tools use.
    const stored = env.variables.find((v) => v.key === 'API_TOKEN')
    expect(stored).toBeDefined()
    const persisted = serializeValueForPersistence(stored?.value)
    expect(persisted).toEqual({ type: 'secret', source: 'envVar', params: { name: 'API_TOKEN' } })
    expect(JSON.stringify(persisted)).not.toContain('resolved')
  })

  it('rejects an unknown secret source', () => {
    makeFixture()
    const res = mcp.invoke('set_env_variable', {
      envId: 'env-1',
      key: 'X',
      value: { type: 'secret', source: 'nope', params: {} }
    })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('unknown secret source')
  })

  it('rejects a secret missing a required param', () => {
    makeFixture()
    const res = mcp.invoke('set_env_variable', {
      envId: 'env-1',
      key: 'X',
      value: { type: 'secret', source: 'envVar', params: {} }
    })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('requires param "name"')
  })

  it('rejects a secret with an empty source', () => {
    makeFixture()
    const res = mcp.invoke('set_env_variable', {
      envId: 'env-1',
      key: 'X',
      value: { type: 'secret', source: '', params: {} }
    })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('non-empty "source"')
  })
})

describe('secret value MCP round-trip (write -> read serialization)', () => {
  it('preserves the reference and never exposes resolved plaintext', () => {
    // The MCP write path builds a value via KeyValue.fromPlain; the MCP read
    // path serializes via serializeValueForPersistence (and SecretValue.toJSON).
    // Simulate a hydrated SecretValue (main sets `.resolved` at run time) and
    // prove neither serialization channel leaks it.
    const kv = KeyValue.fromPlain({
      key: 'Authorization',
      value: { type: 'secret', source: 'envFileSecret', params: { key: 'a/b', folderPath: '/p' } }
    })
    ;(kv.value as unknown as { resolved?: string }).resolved = 'plaintext-secret-DO-NOT-LEAK'

    const persisted = serializeValueForPersistence(kv.value)
    expect(persisted).toEqual({ type: 'secret', source: 'envFileSecret', params: { key: 'a/b', folderPath: '/p' } })
    expect(JSON.stringify(persisted)).not.toContain('plaintext-secret')

    // The JSON.stringify channel (what jsonReply uses) also masks via toJSON.
    expect(JSON.stringify(kv.value)).not.toContain('plaintext-secret')
    expect(JSON.parse(JSON.stringify(kv.value))).toEqual({
      type: 'secret', source: 'envFileSecret', params: { key: 'a/b', folderPath: '/p' }
    })
  })
})

describe('environment structure tools (create / rename / delete / list)', () => {
  let mcp: FakeMcpService

  // ef-1 ─ A ─ B  (B nested under A);  D top-level
  function makeFolder(): { id: string; environments: unknown[] } {
    const B = { id: 'env-B', name: 'B', variables: [], subEnvironments: [] }
    const A = { id: 'env-A', name: 'A', variables: [], subEnvironments: [B] }
    const D = { id: 'env-D', name: 'D', variables: [], subEnvironments: [] }
    const folder = { id: 'ef-1', name: 'EF', folderType: 'environment', environments: [A, D], items: [] }
    mockState.getCollections.mockReturnValue([folder])
    mockState.findById.mockImplementation((id: string) => (id === 'ef-1' ? folder : undefined))
    return folder
  }

  beforeEach(async () => {
    for (const fn of Object.values(mockState)) fn.mockReset()
    updateScenarioSpy.mockReset(); updateEnvironmentSpy.mockReset(); updateFolderSpy.mockReset()
    createEnvironmentSpy.mockReset(); deleteEnvironmentSpy.mockReset()
    broadcastSpy.mockReset(); getAllWindowsSpy.mockReset(); getAllWindowsSpy.mockImplementation(() => [])
    mockState.getCollections.mockReturnValue([])
    mcp = new FakeMcpService()
    const { registerWriteTools } = await import('./write')
    registerWriteTools(mcp as unknown as McpService)
  })

  it('lists the environment tree (top-level + nested sub-envs)', () => {
    makeFolder()
    const res = mcp.invoke('list_environments', { envFolderId: 'ef-1' })
    expect(res.isError).toBeUndefined()
    expect(parse(res)).toEqual({
      envFolderId: 'ef-1',
      environments: [
        { id: 'env-A', name: 'A', subEnvironments: [{ id: 'env-B', name: 'B' }] },
        { id: 'env-D', name: 'D' }
      ]
    })
  })

  it('creates a top-level environment + autosaves', () => {
    makeFolder()
    createEnvironmentSpy.mockReturnValue({ id: 'env-new', name: 'staging' })
    const res = mcp.invoke('create_environment', { envFolderId: 'ef-1', name: 'staging' })
    expect(res.isError).toBeUndefined()
    expect(createEnvironmentSpy).toHaveBeenCalledWith('ef-1', { name: 'staging' }, undefined)
    expect(parse(res)).toEqual({ id: 'env-new', name: 'staging', envFolderId: 'ef-1' })
    expect(broadcastSpy).toHaveBeenCalled()
  })

  it('creates a sub-environment under an existing env in the same folder', () => {
    makeFolder()
    createEnvironmentSpy.mockReturnValue({ id: 'env-sub', name: 'eu-west' })
    const res = mcp.invoke('create_environment', { envFolderId: 'ef-1', name: 'eu-west', parentEnvironmentId: 'env-A' })
    expect(res.isError).toBeUndefined()
    expect(createEnvironmentSpy).toHaveBeenCalledWith('ef-1', { name: 'eu-west' }, 'env-A')
    expect(parse(res)).toMatchObject({ id: 'env-sub', parentEnvironmentId: 'env-A' })
  })

  it('rejects a parentEnvironmentId that lives in another folder', () => {
    makeFolder()
    const res = mcp.invoke('create_environment', { envFolderId: 'ef-1', name: 'x', parentEnvironmentId: 'env-elsewhere' })
    expect(res.isError).toBe(true)
    expect(createEnvironmentSpy).not.toHaveBeenCalled()
  })

  it('renames an environment + autosaves', () => {
    makeFolder()
    const res = mcp.invoke('rename_environment', { envId: 'env-B', name: 'renamed' })
    expect(res.isError).toBeUndefined()
    expect(updateEnvironmentSpy).toHaveBeenCalledWith('env-B', { name: 'renamed' })
    expect(parse(res)).toEqual({ envId: 'env-B', name: 'renamed' })
    expect(broadcastSpy).toHaveBeenCalled()
  })

  it('deletes a sub-environment + autosaves (owner folder resolved before delete)', () => {
    makeFolder()
    deleteEnvironmentSpy.mockReturnValue(true)
    const res = mcp.invoke('delete_environment', { envId: 'env-B' })
    expect(res.isError).toBeUndefined()
    expect(deleteEnvironmentSpy).toHaveBeenCalledWith('env-B')
    expect(parse(res)).toEqual({ envId: 'env-B', removed: true })
    expect(broadcastSpy).toHaveBeenCalled()
  })

  it('returns removed:false for an unknown env and does not autosave', () => {
    makeFolder()
    deleteEnvironmentSpy.mockReturnValue(false)
    const res = mcp.invoke('delete_environment', { envId: 'env-ghost' })
    expect(res.isError).toBeUndefined()
    expect(parse(res)).toEqual({ envId: 'env-ghost', removed: false })
    expect(broadcastSpy).not.toHaveBeenCalled()
  })

  it('refresh_environment re-resolves the env secrets and returns the count', () => {
    makeFolder()
    refreshEnvironmentSecretsSpy.mockReturnValue(2)
    const res = mcp.invoke('refresh_environment', { envId: 'env-A' })
    expect(res.isError).toBeUndefined()
    expect(refreshEnvironmentSecretsSpy).toHaveBeenCalledWith('env-A')
    expect(parse(res)).toEqual({ envId: 'env-A', secretsRefreshed: 2 })
  })

  it('refresh_environment rejects an unknown env', () => {
    makeFolder()
    refreshEnvironmentSecretsSpy.mockReset()
    const res = mcp.invoke('refresh_environment', { envId: 'env-ghost' })
    expect(res.isError).toBe(true)
    expect(refreshEnvironmentSecretsSpy).not.toHaveBeenCalled()
  })
})
