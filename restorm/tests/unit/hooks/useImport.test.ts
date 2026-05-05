/**
 * Unit tests for `useImport.handleImport`.
 *
 * Covers the contract:
 *   - requests + folders at the root of the imported tree are appended
 *     to the existing rootItems
 *   - exactly one FOLDER_CREATED per top-level imported folder (no
 *     per-descendant emission)
 *   - root-level requests report `parentFolderId: undefined` (no
 *     self-parenting)
 *   - nested requests + sub-folders rely on
 *     `SearchIndexService.indexFolderRecursively` for indexing rather
 *     than firing their own CREATED events
 *   - cross-item `authenticationRequestId` references survive the id-
 *     regeneration pass (remapped to the new auth id)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

interface CapturedEvent { event: string; payload: Record<string, unknown> }
const captured: CapturedEvent[] = []

vi.mock('electron-core-ui/renderer', () => ({
  eventBus: {
    emitSync: vi.fn((event: string, payload: unknown) => {
      captured.push({ event, payload: payload as Record<string, unknown> })
    }),
    emit: vi.fn(),
    emitLocalSync: vi.fn(),
    subscribe: vi.fn(() => ({ unsubscribe: (): void => undefined }))
  },
  DocumentEvents: {
    FOLDER_CREATED: 'document:folder:created',
    FOLDER_UPDATED: 'document:folder:updated',
    FOLDER_DELETED: 'document:folder:deleted',
    REQUEST_CREATED: 'document:request:created',
    REQUEST_UPDATED: 'document:request:updated',
    REQUEST_DELETED: 'document:request:deleted',
    ENVIRONMENT_CREATED: 'document:environment:created',
    ENVIRONMENT_UPDATED: 'document:environment:updated',
    ENVIRONMENT_DELETED: 'document:environment:deleted'
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('../../../src/renderer/src/types/reactive', () => ({
  makeReactiveFolder: (f: unknown) => f,
  makeReactiveRequest: (r: unknown) => r
}))

import { useImport } from '../../../src/renderer/src/hooks/useImport'
import type {
  EnvironmentFolder,
  Folder,
  FolderItem,
  Request
} from '../../../src/shared/types/collections'

function makeFolder(id: string, name: string, items: FolderItem[] = []): Folder {
  return { id, name, documentation: '', tags: [], configuration: {}, items }
}

function makeRequest(id: string, name: string, extra: Partial<Request> = {}): Request {
  return {
    id,
    name,
    type: 'http',
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    documentation: '',
    tags: [],
    ...extra
  } as Request
}

describe('useImport.handleImport — empty-file root requests', () => {
  beforeEach(() => {
    captured.length = 0
  })

  it('keeps a root-level request (e.g. attached auth) alongside a folder', async () => {
    const setRootItems = vi.fn()
    const setExpandedIds = vi.fn()

    const { result } = renderHook(() =>
      useImport({
        rootItems: [] as (EnvironmentFolder | Folder | Request)[],
        setRootItems,
        setExpandedIds
      })
    )

    const auth = makeRequest('auth-id', 'Authentication route')
    const folder = makeFolder('folder-id', 'Imported', [
      makeRequest('nested-req-id', 'Nested request'),
      makeFolder('nested-folder-id', 'Nested folder', [
        makeRequest('deep-req-id', 'Deep request')
      ])
    ])

    await act(async () => {
      result.current.handleImport([auth, folder] as FolderItem[])
      // Flush the microtask that optim #4 defers `setExpandedIds` onto.
      await Promise.resolve()
    })

    // (1) setRootItems receives an updater that appends BOTH the
    // request and the folder to whatever's already at the root.
    expect(setRootItems).toHaveBeenCalledTimes(1)
    const updater = setRootItems.mock.calls[0]?.[0] as (prev: FolderItem[]) => FolderItem[]
    const committed = updater([])
    expect(committed).toHaveLength(2)
    // IDs get regenerated on import so we check by name / structure.
    expect(committed.some((i) => !('items' in i) && i.name === 'Authentication route')).toBe(true)
    expect(committed.some((i) => 'items' in i && i.name === 'Imported')).toBe(true)

    // (2) Exactly one FOLDER_CREATED — the top-level `Imported` folder.
    const folderEvents = captured.filter((c) => c.event === 'document:folder:created')
    expect(folderEvents).toHaveLength(1)
    const folderDoc = folderEvents[0]?.payload['document'] as { name?: string }
    expect(folderDoc.name).toBe('Imported')

    // (3) Exactly one REQUEST_CREATED — the root-level auth request,
    // with `parentFolderId: undefined` (it has no parent folder).
    const requestEvents = captured.filter((c) => c.event === 'document:request:created')
    expect(requestEvents).toHaveLength(1)
    const requestDoc = requestEvents[0]?.payload['document'] as { name?: string }
    expect(requestDoc.name).toBe('Authentication route')
    expect(requestEvents[0]?.payload['parentFolderId']).toBeUndefined()

    // (4) No descendant CREATED events — nested-req / deep-req /
    // nested-folder land in the search index via
    // SearchIndexService.indexFolderRecursively on the parent's
    // FOLDER_CREATED, not through their own IPC events.
    const descendantNames = ['Nested request', 'Nested folder', 'Deep request']
    for (const name of descendantNames) {
      const matchingPayload = captured.find((c) => {
        const doc = c.payload['document'] as { name?: string } | undefined
        return doc?.name === name
      })
      expect(matchingPayload, `no CREATED event should fire for ${name}`).toBeUndefined()
    }
  })
})

describe('useImport.handleImport — authenticationRequestId remap', () => {
  beforeEach(() => {
    captured.length = 0
  })

  it('rewrites pre-regeneration authenticationRequestId references to the new auth id', async () => {
    const setRootItems = vi.fn()
    const setExpandedIds = vi.fn()

    const { result } = renderHook(() =>
      useImport({
        rootItems: [] as (EnvironmentFolder | Folder | Request)[],
        setRootItems,
        setExpandedIds
      })
    )

    // The importer wires `authenticationRequestId` on every
    // downstream request to the attached auth's *pre-regeneration*
    // id. After `regenerateIds` gives the auth a new id, those
    // references have to be remapped or they point at nothing.
    const authOriginalId = 'auth-original-id'
    const auth = makeRequest(authOriginalId, 'Authentication route')
    const folder = makeFolder('folder-id', 'Imported', [
      makeRequest('child-1-id', 'Child 1', { authenticationRequestId: authOriginalId }),
      makeRequest('child-2-id', 'Child 2', { authenticationRequestId: authOriginalId })
    ])

    await act(async () => {
      result.current.handleImport([auth, folder] as FolderItem[])
      await Promise.resolve()
    })

    const updater = setRootItems.mock.calls[0]?.[0] as (prev: FolderItem[]) => FolderItem[]
    const committed = updater([])
    const committedAuth = committed.find((i) => !('items' in i) && i.name === 'Authentication route') as Request
    const committedFolder = committed.find((i) => 'items' in i && i.name === 'Imported') as Folder
    expect(committedAuth).toBeDefined()
    expect(committedFolder).toBeDefined()

    // Auth got a new id…
    expect(committedAuth.id).not.toBe(authOriginalId)

    // …and every child now references *that* new id, not the stale
    // pre-regeneration one.
    for (const child of committedFolder.items) {
      if ('items' in child) continue
      expect(
        (child as { authenticationRequestId?: string }).authenticationRequestId,
        `child "${child.name}" must reference the regenerated auth id`
      ).toBe(committedAuth.id)
    }
  })
})
