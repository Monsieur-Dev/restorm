import { describe, it, expect, beforeEach, vi } from 'vitest'

const emitted: { event: string; payload: unknown }[] = []
vi.mock('electron-core-ui/main', () => ({
  eventBusService: { emit: vi.fn((event: string, payload: unknown) => { emitted.push({ event, payload }); return Promise.resolve() }) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createPubSub: () => ({ publish: vi.fn(), asyncIterator: vi.fn() }),
  serializeWithDecorators: (_c: unknown, o: unknown) => o
}))

import { collectionStore } from './CollectionStore'
import { isRecordingSession, isRequest } from '../../shared/models'

/** An env-folder holding a recording session whose deduced routes are a
 * folder with one request. */
function seedTree(): void {
  collectionStore.setCollections([
    {
      folderType: 'environment',
      id: 'root',
      name: 'Root',
      tags: [],
      items: [
        {
          type: 'recording',
          id: 'rec',
          name: 'Petstore recording',
          url: 'http://localhost:8080/',
          protocols: ['http'],
          whitelist: [],
          blacklist: [],
          items: [
            { id: 'api', name: 'api', items: [{ type: 'http', id: 'req-1', name: 'GET /api/pets', method: 'GET', url: 'http://localhost:8080/api/pets' }], configuration: {} }
          ]
        }
      ],
      environments: []
    }
  ] as unknown as Parameters<typeof collectionStore.setCollections>[0])
  emitted.length = 0
}

describe('CollectionStore — recording session as a container', () => {
  beforeEach(() => { seedTree() })

  it('reifies the session and finds the deduced routes nested under it', () => {
    const session = collectionStore.findById('rec')
    expect(session !== null && isRecordingSession(session)).toBe(true)
    const request = collectionStore.findById('req-1')
    expect(request !== null && isRequest(request)).toBe(true)
    expect(collectionStore.findParentFolder('req-1')?.id).toBe('api')
    expect(collectionStore.findParentFolder('api')?.id).toBe('rec')
  })

  it('createRecording places the session under its parent and emits the created event', () => {
    const created = collectionStore.createRecording('root', { name: 'New rec', url: 'https://example.test/', blacklist: ['\\.png$'] })
    expect(created.type).toBe('recording')
    expect(created.protocols).toEqual(['http', 'websocket', 'graphql', 'grpc-web'])
    expect(collectionStore.findParentFolder(created.id)?.id).toBe('root')
    const event = emitted.find((e) => e.event === 'document:recording:created')
    expect(event?.payload).toMatchObject({ id: created.id, type: 'recording', parentFolderId: 'root' })
    const atRoot = collectionStore.createRecording(null, { name: 'Root rec' })
    expect(collectionStore.getCollections().some((item) => item.id === atRoot.id)).toBe(true)
  })

  it('updateRecording patches the own fields, never the items, and emits updated', () => {
    const updated = collectionStore.updateRecording('rec', { name: 'Renamed', whitelist: ['api'], items: [] } as never)
    expect(updated?.name).toBe('Renamed')
    expect(updated?.whitelist).toEqual(['api'])
    expect(updated?.items).toHaveLength(1)
    expect(emitted.some((e) => e.event === 'document:recording:updated')).toBe(true)
    expect(collectionStore.updateRecording('root', { name: 'x' })).toBeNull()
  })

  it('deleteRecording removes the session (nested or root) and emits deleted', () => {
    expect(collectionStore.deleteRecording('rec')).toBe(true)
    expect(collectionStore.findById('rec')).toBeNull()
    expect(collectionStore.findById('req-1')).toBeNull()
    expect(emitted.find((e) => e.event === 'document:recording:deleted')?.payload).toEqual({ id: 'rec', type: 'recording' })
    expect(collectionStore.deleteRecording('rec')).toBe(false)
    expect(collectionStore.deleteRecording('root')).toBe(false)
  })

  it('moveItem reports the recording kind and accepts a session as destination', () => {
    const moved = collectionStore.moveItem('rec', undefined, 0)
    expect(moved).toMatchObject({ ok: true, kind: 'recording', parentId: 'root' })
    const request = collectionStore.createRequest('root', { name: 'loose', type: 'http', method: 'GET', url: 'http://x/' } as never)
    const into = collectionStore.moveItem(request.id, 'rec', 0)
    expect(into).toMatchObject({ ok: true, kind: 'request', parentId: 'rec', index: 0 })
    expect(collectionStore.findParentFolder(request.id)?.id).toBe('rec')
  })
})
