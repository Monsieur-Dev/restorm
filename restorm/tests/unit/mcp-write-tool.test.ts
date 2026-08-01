/**
 * Unit tests for the `update_request` MCP tool's key-value reification.
 *
 * A patch arrives from an MCP client as plain JSON, so every key-value array it
 * carries must be turned back into `KeyValue` instances before it reaches the
 * model — the store serializes the request on every update event, and a plain
 * object has no `toPlainObject`. A protocol whose key-value arrays are named
 * something other than `headers` used to slip through and, worse, stay on the
 * model, so every later read of that request threw too.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpToolConfig, McpToolHandler } from 'electron-core-ui'
import { StompRequest } from '../../src/shared/models/requests/StompRequest'
import { KeyValue } from '../../src/shared/models/KeyValue'

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
  }
  registerResource(): void { /* unused */ }
  invoke(name: string, args: Record<string, unknown> = {}): unknown {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return handler(args, {})
  }
}

// Always holds a request, so the tests can read it back without null-guards;
// `beforeEach` swaps in a fresh one.
const store = {
  item: new StompRequest({ id: 'unset' })
}

/** A folder `isAnyFolder` accepts, so create_request's parent check passes. */
const folder = { id: 'folder-1', name: 'Collection', items: [] }

/** Last payload handed to `collectionStore.createRequest`. */
let created: Record<string, unknown> | null = null

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { send: () => undefined }
    }]
  }
}))

vi.mock('../../src/main/services/CollectionStore', () => ({
  collectionStore: {
    findById: (id: string): unknown => {
      if (id === folder.id) return folder
      return store.item.id === id ? store.item : null
    },
    createRequest: (_parentId: string, data: Record<string, unknown>): unknown => {
      created = data
      return { id: 'new-1', name: data['name'], type: data['type'] }
    },
    // Mirrors the real store: assign the patch, then serialize for the update
    // event. The serialization is what a non-reified array blows up on.
    updateRequest: (id: string, updates: Record<string, unknown>): unknown => {
      const item = store.item
      if (item.id !== id) return null
      Object.assign(item, updates)
      item.toPlainObject()
      return item
    },
    getCollections: () => [],
    setCollections: () => true
  },
  pubsub: { publish: () => undefined },
  PUBSUB_TOPICS: {}
}))

vi.mock('../../src/main/services/ContextService', () => ({
  contextService: { updateFullRequestData: () => undefined }
}))

vi.mock('../../src/main/mcp/tools/import', () => ({
  broadcastTreeReplace: () => undefined
}))

vi.mock('../../src/main/mcp/tools/scenario', () => ({
  broadcastScenario: () => undefined
}))

vi.mock('electron-core-ui/main', () => ({
  eventBusService: { emit: () => Promise.resolve() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { registerWriteTools } from '../../src/main/mcp/tools/write'

interface ToolReply {
  isError?: boolean
  content: { text: string }[]
}

function replyJson(result: unknown): Record<string, unknown> {
  return JSON.parse((result as ToolReply).content[0].text) as Record<string, unknown>
}

describe('update_request key-value reification', () => {
  let fakeService: FakeMcpService

  beforeEach(() => {
    fakeService = new FakeMcpService()
    store.item = new StompRequest({
      id: 'stomp-1',
      name: 'Broker',
      url: 'ws://localhost:61614/ws'
    })
    registerWriteTools(fakeService as unknown as Parameters<typeof registerWriteTools>[0])
  })

  it('patches STOMP connectHeaders and leaves the request readable', () => {
    const result = fakeService.invoke('update_request', {
      id: 'stomp-1',
      patch: { connectHeaders: [{ key: 'login', value: 'guest', enabled: true }] }
    }) as ToolReply

    expect(result.isError).toBeUndefined()
    expect(replyJson(result)['patchedFields']).toEqual(['connectHeaders'])
    expect(store.item.connectHeaders[0]).toBeInstanceOf(KeyValue)
    // A subsequent read/patch on the same id must still work — the corruption
    // this guards against only showed up on the call *after* the bad patch.
    expect(() => store.item.toPlainObject()).not.toThrow()
    const second = fakeService.invoke('update_request', {
      id: 'stomp-1',
      patch: { sendDestination: '/queue/orders' }
    }) as ToolReply
    expect(second.isError).toBeUndefined()
    expect(store.item.sendDestination).toBe('/queue/orders')
  })

  it('patches STOMP sendHeaders', () => {
    const result = fakeService.invoke('update_request', {
      id: 'stomp-1',
      patch: { sendHeaders: [{ key: 'content-type', value: 'application/json', enabled: true }] }
    }) as ToolReply

    expect(result.isError).toBeUndefined()
    expect(store.item.sendHeaders[0]).toBeInstanceOf(KeyValue)
    expect(store.item.sendHeaders[0].key).toBe('content-type')
  })

  it('reifies a key-value array named after the field the model already holds', () => {
    // Stands in for a protocol whose key-value field is not in the static list:
    // the live value on the target teaches the patch what the entries are.
    const item = store.item
    item.connectHeaders = [new KeyValue({ key: 'host', value: '/', enabled: true })]

    const result = fakeService.invoke('update_request', {
      id: 'stomp-1',
      patch: { connectHeaders: [{ key: 'passcode', value: 'guest', enabled: true }] }
    }) as ToolReply
    expect(result.isError).toBeUndefined()
    expect(store.item.connectHeaders[0]).toBeInstanceOf(KeyValue)
  })

  it('rolls the request back when a patch leaves it unserializable', () => {
    // `subscriptions` is not a key-value array, so nothing reifies it — stand
    // in for any future field whose entries the model expects to be instances.
    const item = store.item
    const before = item.subscriptions
    const serialize = item.toPlainObject.bind(item)
    item.toPlainObject = (): Record<string, unknown> => {
      const entries: unknown[] = item.subscriptions
      if (entries.some((entry) => typeof entry !== 'object' || entry === null)) {
        throw new TypeError('s.toPlainObject is not a function')
      }
      return serialize()
    }

    const result = fakeService.invoke('update_request', {
      id: 'stomp-1',
      patch: { subscriptions: ['not-an-object'] }
    }) as ToolReply

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('the request is unchanged')
    expect(store.item.subscriptions).toBe(before)
    // …and the request is readable again, not wedged.
    expect(() => store.item.toPlainObject()).not.toThrow()
  })
})

describe('create_request protocol', () => {
  let fakeService: FakeMcpService

  beforeEach(() => {
    fakeService = new FakeMcpService()
    created = null
    registerWriteTools(fakeService as unknown as Parameters<typeof registerWriteTools>[0])
  })

  it.each([
    ['socketio', 'websocket', 'socketio'],
    ['mqtt', 'websocket', 'mqtt']
  ])('creates %s as a websocket request carrying that transport', (protocol, type, wsProtocol) => {
    const result = fakeService.invoke('create_request', {
      parentFolderId: 'folder-1',
      name: 'Live feed',
      protocol
    }) as ToolReply

    expect(result.isError).toBeUndefined()
    expect(replyJson(result)['protocol']).toBe(protocol)
    expect(created).toEqual({ type, name: 'Live feed', protocol: wsProtocol })
  })

  it('creates a plain websocket request without a transport override', () => {
    const result = fakeService.invoke('create_request', {
      parentFolderId: 'folder-1',
      name: 'Socket',
      protocol: 'websocket'
    }) as ToolReply

    expect(result.isError).toBeUndefined()
    expect(created).toEqual({ type: 'websocket', name: 'Socket' })
  })

  it('rejects a protocol that is neither a request type nor a transport', () => {
    const result = fakeService.invoke('create_request', {
      parentFolderId: 'folder-1',
      name: 'Nope',
      protocol: 'carrier-pigeon'
    }) as ToolReply

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('protocol must be one of')
  })
})
