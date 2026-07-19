// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

// `useItemOperations` transitively imports the full `electron-core-ui/renderer`
// barrel (Monaco, which jsdom can't run) — mock exactly the values it and
// `../types/reactive` touch at module load. A single shared `emitSync` spy
// captures BOTH the clone's CREATED events and any UPDATED events the reactive
// proxy fires, so the wrap can be asserted behaviourally.
const { emitSyncMock, emitLocalSyncMock } = vi.hoisted(() => ({ emitSyncMock: vi.fn(), emitLocalSyncMock: vi.fn() }))

vi.mock('electron-core-ui/renderer', () => ({
  eventBus: {
    emitSync: emitSyncMock,
    emitLocalSync: emitLocalSyncMock,
    emit: vi.fn(),
    emitLocal: vi.fn(),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
  },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  isTabGroupNode: () => false,
  isContainerNode: () => false
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key })
}))

import { emitClonedSubtreeCreated, useItemOperations, type UseItemOperationsOptions } from './useItemOperations'
import { DocumentEvents } from '../services/DocumentEvents'
import { HTTPRequest } from '../../../shared/models/requests'
import type { FolderItem } from '../../../shared/types/collections'

interface EmittedCall {
  event: string
  payload: { id: string; type: string; parentFolderId?: string; parentEnvironmentId?: string }
}
const calls = (): EmittedCall[] =>
  (emitSyncMock.mock.calls as [string, EmittedCall['payload']][]).map(([event, payload]) => ({ event, payload }))
const callsFor = (event: string): EmittedCall[] => calls().filter((c) => c.event === event)

const localCallsFor = (event: string): EmittedCall[] =>
  (emitLocalSyncMock.mock.calls as [string, EmittedCall['payload']][])
    .map(([e, payload]) => ({ event: e, payload }))
    .filter((c) => c.event === event)

beforeEach(() => { emitSyncMock.mockClear(); emitLocalSyncMock.mockClear() })
afterEach(() => { cleanup() })

const httpRequest = (id: string, name: string): FolderItem =>
  ({ id, name, type: 'http', tags: [], url: 'https://example.com' }) as unknown as FolderItem

describe('emitClonedSubtreeCreated', () => {
  it('emits REQUEST_CREATED for a root request without a parent folder id', () => {
    emitClonedSubtreeCreated(httpRequest('r1', 'Solo'))

    const created = callsFor(DocumentEvents.REQUEST_CREATED)
    expect(created).toHaveLength(1)
    expect(created[0]?.payload.id).toBe('r1')
    expect(created[0]?.payload.parentFolderId).toBeUndefined()
  })

  it('delivers the CREATED event on BOTH buses so the clone is indexed AND marked dirty', () => {
    // emitSync feeds the main-process search index; emitLocalSync feeds the
    // renderer save-unit bridge that marks the new unit dirty (autosave / git
    // push badge). A main-only delivery would index the clone but never dirty
    // it — the exact bug this guards against.
    emitClonedSubtreeCreated(httpRequest('r1', 'Solo'), 'parent-1')

    expect(callsFor(DocumentEvents.REQUEST_CREATED)).toHaveLength(1)
    const localCreated = localCallsFor(DocumentEvents.REQUEST_CREATED)
    expect(localCreated).toHaveLength(1)
    expect(localCreated[0]?.payload.id).toBe('r1')
    expect(localCreated[0]?.payload.parentFolderId).toBe('parent-1')
  })

  it('carries the parent folder id on a nested request', () => {
    emitClonedSubtreeCreated(httpRequest('r1', 'Nested'), 'parent-1')

    const created = callsFor(DocumentEvents.REQUEST_CREATED)
    expect(created).toHaveLength(1)
    expect(created[0]?.payload.parentFolderId).toBe('parent-1')
  })

  it('emits FOLDER_CREATED for a folder plus one REQUEST_CREATED per child request', () => {
    const folder = {
      id: 'f1',
      name: 'Folder',
      tags: [],
      configuration: {},
      items: [httpRequest('r1', 'A'), httpRequest('r2', 'B')]
    } as unknown as FolderItem

    emitClonedSubtreeCreated(folder)

    expect(callsFor(DocumentEvents.FOLDER_CREATED).map((c) => c.payload.id)).toEqual(['f1'])
    const reqs = callsFor(DocumentEvents.REQUEST_CREATED)
    expect(reqs.map((c) => c.payload.id)).toEqual(['r1', 'r2'])
    expect(reqs.every((c) => c.payload.parentFolderId === 'f1')).toBe(true)
  })

  it('announces every env / sub-env of a cloned environment folder', () => {
    const envFolder = {
      id: 'ef1',
      name: 'Envs',
      folderType: 'environment',
      tags: [],
      configuration: {},
      environments: [
        { id: 'e1', name: 'Dev', variables: [], subEnvironments: [{ id: 'e2', name: 'DevChild', variables: [] }] }
      ],
      items: []
    } as unknown as FolderItem

    emitClonedSubtreeCreated(envFolder)

    expect(callsFor(DocumentEvents.FOLDER_CREATED).map((c) => c.payload.id)).toEqual(['ef1'])
    const envs = callsFor(DocumentEvents.ENVIRONMENT_CREATED)
    expect(envs.map((c) => c.payload.id)).toEqual(['e1', 'e2'])
    // The top env has no parent; the sub-env points back at its parent env.
    expect(envs[0]?.payload.parentFolderId).toBe('ef1')
    expect(envs[0]?.payload.parentEnvironmentId).toBeUndefined()
    expect(envs[1]?.payload.parentEnvironmentId).toBe('e1')
  })

  it('skips a document event for the scenario itself but announces its nested requests', () => {
    const scenario = {
      id: 's1',
      name: 'Flow',
      type: 'scenario',
      tags: [],
      params: [],
      nodes: [],
      edges: [],
      items: [httpRequest('r1', 'Step')]
    } as unknown as FolderItem

    emitClonedSubtreeCreated(scenario)

    // No FOLDER_CREATED / no event carrying the scenario id.
    expect(callsFor(DocumentEvents.FOLDER_CREATED)).toHaveLength(0)
    expect(calls().some((c) => c.payload.id === 's1')).toBe(false)
    const reqs = callsFor(DocumentEvents.REQUEST_CREATED)
    expect(reqs.map((c) => c.payload.id)).toEqual(['r1'])
    expect(reqs[0]?.payload.parentFolderId).toBe('s1')
  })
})

describe('useItemOperations.handleCloneItem', () => {
  const buildOptions = (rootItems: FolderItem[]): UseItemOperationsOptions => ({
    rootItems,
    setRootItems: vi.fn(),
    setExpandedIds: vi.fn(),
    setSelectedItemId: vi.fn(),
    setSidebarEditingItemId: vi.fn(),
    setWorkbenchTree: vi.fn(),
    setDeleteConfirmation: vi.fn(),
    openFolderTab: vi.fn(),
    openScenarioEditorTab: vi.fn(),
    openEnvironmentFolderTab: vi.fn(),
    openAnyRequestTab: vi.fn(),
    projectUuid: 'project-1'
  })

  it('emits REQUEST_CREATED for the clone and swaps a reactive node into the tree', () => {
    vi.useFakeTimers()
    try {
      // A real request instance so the reactive-wrap guards match.
      const original = new HTTPRequest({ id: 'req-1', name: 'Original', method: 'GET' }) as unknown as FolderItem
      const rootItems: FolderItem[] = [original]
      const { result } = renderHook(() => useItemOperations(buildOptions(rootItems)))

      act(() => { result.current.handleCloneItem('req-1') })

      // The clone landed after the original and fired its CREATED event.
      const created = callsFor(DocumentEvents.REQUEST_CREATED)
      expect(created).toHaveLength(1)
      const cloneId = created[0]?.payload.id
      expect(cloneId).toBeDefined()
      expect(cloneId).not.toBe('req-1')

      const cloneNode = rootItems.find((i) => i.id === cloneId)
      expect(cloneNode).toBeDefined()
      expect(cloneNode?.name).toContain('copy')

      // Editing the clone in place must emit REQUEST_UPDATED — proof the node
      // in the tree is the reactive wrapper, not the plain deep-copy.
      emitSyncMock.mockClear()
      act(() => { (cloneNode as { name: string }).name = 'Renamed clone' })
      act(() => { vi.advanceTimersByTime(100) })
      expect(callsFor(DocumentEvents.REQUEST_UPDATED).some((c) => c.payload.id === cloneId)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
