import { describe, it, expect } from 'vitest'
import { socketioConnectExecutor, websocketConnectExecutor, httpListenExecutor } from './socketioExecutors'
import type { ExecContext } from '../types'

/** A minimal ExecContext carrying just a node with the given config — the
 * connect executors read only `ctx.node.config` to build their scope action. */
function ctxWith(config: Record<string, unknown>): ExecContext {
  return { node: { id: 'n1', kind: 'socketioConnect', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
}

const act = { nodeId: 'n1', inputs: {} } as unknown as Parameters<typeof socketioConnectExecutor>[0]

describe('streaming connect/listen scope action carries override config', () => {
  it('threads quickConfig id + overrides into the socketioConnect scope action', async () => {
    const res = await socketioConnectExecutor(act, ctxWith({
      requestId: 'req-1', quickConfigId: 'qc-1', overrides: { method: 'POST' }
    }))
    const sa = res.scopeAction as { type: string; overrideConfig?: Record<string, unknown> }
    expect(sa.type).toBe('openSocketioConnect')
    // Only the config id travels — the engine resolves its fields from the bound
    // request's project configs (no snapshot of the fields on the node).
    expect(sa.overrideConfig).toEqual({ quickConfigId: 'qc-1', overrides: { method: 'POST' } })
  })

  it('omits overrideConfig when the node carries no override keys', async () => {
    const res = await websocketConnectExecutor(act, ctxWith({ requestId: 'req-1' }))
    expect((res.scopeAction as { overrideConfig?: unknown }).overrideConfig).toBeUndefined()
  })

  it('carries overrides on a mock-server listen node too', async () => {
    const res = await httpListenExecutor(act, ctxWith({ requestId: 'req-1', overrides: { url: 'http://localhost:9' } }))
    expect((res.scopeAction as { overrideConfig?: Record<string, unknown> }).overrideConfig).toEqual({ overrides: { url: 'http://localhost:9' } })
  })
})
