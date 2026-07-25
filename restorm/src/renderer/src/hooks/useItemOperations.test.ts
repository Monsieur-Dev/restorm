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

vi.mock('../services/favoritesStore', () => ({
  removeFavorite: vi.fn()
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

describe('useItemOperations.handleItemDrop', () => {
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

  function makeTree(): FolderItem[] {
    const request = new HTTPRequest({ id: 'req-1', name: 'Find pet', method: 'GET' }) as unknown as FolderItem
    return [
      { id: 'root', name: 'Root', tags: [], configuration: {}, items: [
        { id: 'folder-a', name: 'A', tags: [], configuration: {}, items: [request] },
        { id: 'folder-b', name: 'B', tags: [], configuration: {}, items: [] }
      ] } as unknown as FolderItem
    ]
  }

  function dropPayload(rootItems: FolderItem[]): Parameters<ReturnType<typeof useItemOperations>['handleItemDrop']>[0] {
    const root = rootItems[0] as FolderItem & { items: (FolderItem & { items: FolderItem[] })[] }
    const source = root.items[0]?.items[0]
    const target = root.items[1]
    if (!source || !target) throw new Error('fixture tree is malformed')
    return {
      item: target, path: [], source, sourcePath: [], position: 'into',
      originalEvent: {} as never
    } as never
  }

  it('announces the MOVED item with its new parent, so the move is marked unsaved', () => {
    // A folder's own draft excludes its children, so announcing the
    // container changes nothing and leaves the project "saved". The save
    // unit that genuinely moved is the item, and `parentFolderId` is what
    // carries the move.
    const rootItems = makeTree()
    const { result } = renderHook(() => useItemOperations(buildOptions(rootItems)))

    act(() => { result.current.handleItemDrop(dropPayload(rootItems)) })

    const updated = callsFor(DocumentEvents.REQUEST_UPDATED)
    expect(updated).toHaveLength(1)
    expect(updated[0]?.payload.id).toBe('req-1')
    expect((updated[0]?.payload as { parentFolderId?: string }).parentFolderId).toBe('folder-b')
    // Both buses: only the local one carries the dirty-marking bridge.
    expect(localCallsFor(DocumentEvents.REQUEST_UPDATED)).toHaveLength(1)
  })

  it('stays silent when the drop is refused (an item onto itself)', () => {
    const rootItems = makeTree()
    const { result } = renderHook(() => useItemOperations(buildOptions(rootItems)))
    const payload = dropPayload(rootItems)

    act(() => { result.current.handleItemDrop({ ...payload, item: payload.source } as never) })

    expect(callsFor(DocumentEvents.REQUEST_UPDATED)).toHaveLength(0)
  })
})

describe('useItemOperations.confirmDelete', () => {
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

  const folderWith = (id: string, children: FolderItem[]): FolderItem =>
    ({ id, name: id, tags: [], configuration: {}, items: children }) as unknown as FolderItem

  it('announces REQUEST_DELETED on BOTH buses so search drops it AND the project goes dirty', () => {
    // A sidebar delete used to emit nothing at all: the main-process search
    // index kept the entry (deleted requests still showed in results) and the
    // renderer save-unit bridge never marked the project dirty (no autosave).
    const rootItems: FolderItem[] = [folderWith('f1', [httpRequest('r1', 'Doomed')])]
    const { result } = renderHook(() => useItemOperations(buildOptions(rootItems)))

    act(() => { result.current.confirmDelete('r1') })

    const deleted = callsFor(DocumentEvents.REQUEST_DELETED)
    expect(deleted).toHaveLength(1)
    expect(deleted[0]?.payload.id).toBe('r1')
    expect(deleted[0]?.payload.parentFolderId).toBe('f1')
    expect(localCallsFor(DocumentEvents.REQUEST_DELETED)).toHaveLength(1)
  })

  it('announces the whole subtree when a folder is deleted, one event per descendant', () => {
    // The search index FOLDER_DELETED handler removes only the named id, not
    // descendants, so every request and sub-folder must announce its own
    // deletion or the children linger in the index after the parent is gone.
    const rootItems: FolderItem[] = [
      folderWith('f1', [httpRequest('r1', 'A'), folderWith('f2', [httpRequest('r2', 'B')])])
    ]
    const { result } = renderHook(() => useItemOperations(buildOptions(rootItems)))

    act(() => { result.current.confirmDelete('f1') })

    expect(callsFor(DocumentEvents.FOLDER_DELETED).map((c) => c.payload.id).sort()).toEqual(['f1', 'f2'])
    expect(callsFor(DocumentEvents.REQUEST_DELETED).map((c) => c.payload.id).sort()).toEqual(['r1', 'r2'])
  })

  it('announces a deleted scenario\'s nested requests even though the scenario itself is not indexed', () => {
    const scenario = {
      id: 's1', name: 'Flow', type: 'scenario', tags: [], params: [], nodes: [], edges: [],
      items: [httpRequest('r1', 'Step')]
    } as unknown as FolderItem
    const rootItems: FolderItem[] = [folderWith('f1', [scenario])]
    const { result } = renderHook(() => useItemOperations(buildOptions(rootItems)))

    act(() => { result.current.confirmDelete('s1') })

    // No FOLDER_DELETED for the scenario id; its nested request still drops.
    expect(callsFor(DocumentEvents.FOLDER_DELETED)).toHaveLength(0)
    expect(callsFor(DocumentEvents.REQUEST_DELETED).map((c) => c.payload.id)).toEqual(['r1'])
  })
})

describe('inline rename on creation', () => {
  const buildOptions = (
    rootItems: FolderItem[],
    setSidebarEditingItemId: UseItemOperationsOptions['setSidebarEditingItemId']
  ): UseItemOperationsOptions => ({
    rootItems,
    setRootItems: vi.fn(),
    setExpandedIds: vi.fn(),
    setSelectedItemId: vi.fn(),
    setSidebarEditingItemId,
    setWorkbenchTree: vi.fn(),
    setDeleteConfirmation: vi.fn(),
    openFolderTab: vi.fn(),
    openScenarioEditorTab: vi.fn(),
    openEnvironmentFolderTab: vi.fn(),
    openAnyRequestTab: vi.fn(),
    projectUuid: 'project-1'
  })

  const folderWith = (id: string, children: FolderItem[]): FolderItem =>
    ({ id, name: id, tags: [], configuration: {}, items: children }) as unknown as FolderItem

  /** Run `body`, then flush the tick the rename is deferred by, and report
   * which item (if any) was handed to the sidebar's inline editor. */
  const editedItemAfter = (
    rootItems: FolderItem[],
    body: (ops: ReturnType<typeof useItemOperations>) => void
  ): string | null => {
    vi.useFakeTimers()
    try {
      const setSidebarEditingItemId = vi.fn()
      const { result } = renderHook(() => useItemOperations(buildOptions(rootItems, setSidebarEditingItemId)))
      act(() => { body(result.current) })
      act(() => { vi.advanceTimersByTime(1) })
      const editorCalls = setSidebarEditingItemId.mock.calls
      const call = editorCalls[editorCalls.length - 1]
      return call ? (call[0] as string) : null
    } finally {
      vi.useRealTimers()
    }
  }

  it('opens a folder created from the Add submenu in inline rename', () => {
    let newId: string | null = null
    const edited = editedItemAfter([], (ops) => { newId = ops.handleAddChildItem('', 'folder') })
    expect(newId).toBeTruthy()
    expect(edited).toBe(newId)
  })

  it('does the same for a request — the behaviour is not folder-specific', () => {
    // Requests go down the same dispatcher, so every protocol entry of the
    // submenu inherits the rename without its own wiring.
    const rootItems: FolderItem[] = [folderWith('f1', [])]
    let newId: string | null = null
    const edited = editedItemAfter(rootItems, (ops) => { newId = ops.handleAddChildItem('f1', 'http-get') })
    expect(newId).toBeTruthy()
    expect(edited).toBe(newId)
  })

  it('opens a root environment folder in inline rename too', () => {
    const edited = editedItemAfter([], (ops) => { ops.handleCreateRootEnvironmentFolder() })
    expect(edited).toBeTruthy()
  })

  it('leaves a silent creation alone — the scenario graph must not be interrupted', () => {
    // `silent` creations come from the scenario editor's add palette: no
    // selection, no tab, and therefore no edit field stealing the graph focus.
    const rootItems: FolderItem[] = [
      { id: 's1', name: 'Flow', type: 'scenario', tags: [], params: [], nodes: [], edges: [], items: [] } as unknown as FolderItem
    ]
    const edited = editedItemAfter(rootItems, (ops) => { ops.handleAddChildItem('s1', 'http-get', { silent: true }) })
    expect(edited).toBeNull()
  })
})
