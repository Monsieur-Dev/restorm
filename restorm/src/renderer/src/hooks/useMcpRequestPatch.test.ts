// @vitest-environment jsdom
/**
 * The MCP patch bridge decides per field whether a patch entry is a key-value
 * array. `params` is the trap: HTTP-shaped requests hold `KeyValue[]` there,
 * JSON-RPC holds the raw JSON source STRING its code editor renders. Coercing
 * the string through the key-value reifier produced `[]`, which both destroyed
 * the user's source and handed a non-string to Monaco — the editor throws, the
 * workbench falls into its error boundary and the tab strip empties.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'

const emitLocalSync = vi.hoisted(() => vi.fn())
vi.mock('electron-core-ui/renderer', () => ({ eventBus: { emitLocalSync } }))

import { useMcpRequestPatch } from './useMcpRequestPatch'
import { KeyValue } from '../../../shared/models/keyValues/KeyValue'
import { StringValue } from '../../../shared/types/collections'
import type { FolderItem } from '../../../shared/types/collections'

type PatchListener = (payload: { itemId: string; patch: Record<string, unknown> }) => void

/** Install the preload bridge the hook subscribes to, and return an emitter. */
function installBridge(): (payload: { itemId: string; patch: Record<string, unknown> }) => void {
  const listeners: PatchListener[] = []
  ;(window as unknown as Record<string, unknown>)['restorm'] = {
    runtime: {
      onMcpRequestUpdated: (cb: PatchListener) => {
        listeners.push(cb)
        return (): void => {
          listeners.splice(listeners.indexOf(cb), 1)
        }
      }
    }
  }
  return (payload) => {
    for (const listener of [...listeners]) listener(payload)
  }
}

function renderBridge(rootItems: FolderItem[]): void {
  renderHook(() => {
    useMcpRequestPatch({ enabled: true, rootItems, bumpTabContentVersionFor: () => undefined })
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as unknown as Record<string, unknown>)['restorm']
})

describe('useMcpRequestPatch', () => {
  it('keeps a JSON-RPC `params` source string a string', () => {
    const request = { id: 'rpc-1', name: 'Sum', type: 'jsonrpc', method: 'sum', params: '[1, 2]' }
    const emit = installBridge()
    renderBridge([request as unknown as FolderItem])

    emit({ itemId: 'rpc-1', patch: { method: 'subtract', params: '[42, 23]' } })

    expect(request.params).toBe('[42, 23]')
    expect(request.method).toBe('subtract')
  })

  it('still merges an HTTP `params` key-value array', () => {
    const request = {
      id: 'http-1',
      name: 'List',
      type: 'http',
      params: [new KeyValue({ key: 'limit', value: new StringValue('10'), enabled: true })]
    }
    const emit = installBridge()
    renderBridge([request as unknown as FolderItem])

    emit({ itemId: 'http-1', patch: { params: [{ key: 'limit', value: '50', enabled: true }] } })

    expect(Array.isArray(request.params)).toBe(true)
    expect(request.params).toHaveLength(1)
    expect(request.params[0]).toBeInstanceOf(KeyValue)
    expect(String(request.params[0]?.value)).toContain('50')
  })

  it('reifies a STOMP connect-header patch, like the HTTP-shaped names', () => {
    const request = { id: 'stomp-1', name: 'Broker', type: 'stomp', connectHeaders: [] }
    const emit = installBridge()
    renderBridge([request as unknown as FolderItem])

    emit({ itemId: 'stomp-1', patch: { connectHeaders: [{ key: 'login', value: 'guest', enabled: true }] } })

    expect(request.connectHeaders).toHaveLength(1)
    expect(request.connectHeaders[0]).toBeInstanceOf(KeyValue)
  })

  it('notifies the tab so an open editor repaints', () => {
    const request = { id: 'rpc-2', name: 'Ping', type: 'jsonrpc', method: 'ping', params: '{}' }
    const emit = installBridge()
    renderBridge([request as unknown as FolderItem])

    emit({ itemId: 'rpc-2', patch: { method: 'pong' } })

    expect(emitLocalSync).toHaveBeenCalledWith('request:transport-replaced', { requestId: 'rpc-2' })
  })
})
