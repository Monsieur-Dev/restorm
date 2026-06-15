import { describe, it, expect, vi } from 'vitest'
import { Scheduler, type SocketioConnectRequest, type SocketioConnHandle } from './scheduler'
import { grpcConnectExecutor, grpcSendExecutor, grpcCloseExecutor } from './executors/socketioExecutors'
import type { Activation, ExecContext, ExecResult, NodeExecutor, ScenarioModel } from './types'

/**
 * gRPC streaming scenario nodes (A connect / B send / C close): the same
 * long-lived-connection machinery as raw WebSocket — a streaming RPC has no
 * named events, so every received frame re-emits on a single `message` port,
 * and a send carries no channel (a plain stream write).
 */

interface NodeSpec { id: string; kind: string; inputs?: string[]; outputs?: string[]; config?: Record<string, unknown> }
interface EdgeSpec { id?: string; from: [string, string]; to: [string, string] }

function buildScenario(nodes: NodeSpec[], edges: EdgeSpec[]): ScenarioModel {
  return {
    id: 's', name: 'test', tags: [], params: [], items: [], notes: '',
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind as ScenarioModel['nodes'][number]['kind'],
      config: n.config ?? {},
      inputs: (n.inputs ?? []).map((p) => ({ id: p, name: p, role: 'value', dataType: 'any' })) as never,
      outputs: (n.outputs ?? []).map((p) => ({ id: p, name: p, role: 'value', dataType: 'any' })) as never,
      position: { x: 0, y: 0 }
    })),
    edges: edges.map((e, i) => ({ id: e.id ?? `e${i}`, from: { nodeId: e.from[0], portId: e.from[1] }, to: { nodeId: e.to[0], portId: e.to[1] } }))
  } as unknown as ScenarioModel
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

/** A controllable in-memory streaming bridge — captures the scheduler's callbacks
 * so a test can drive connect / message / close, and records sends. */
function fakeBridge(): {
  bridge: (req: SocketioConnectRequest) => SocketioConnHandle
  cb: () => SocketioConnectRequest
  sends: { channel: string; payload: string }[]
  open: () => boolean
} {
  let captured: SocketioConnectRequest | undefined
  let isOpen = false
  const sends: { channel: string; payload: string }[] = []
  const bridge = (req: SocketioConnectRequest): SocketioConnHandle => {
    captured = req
    return {
      send: (channel, payload) => { if (!isOpen) return false; sends.push({ channel, payload }); return true },
      close: () => { isOpen = false; req.onClose() },
      isOpen: () => isOpen
    }
  }
  return {
    bridge,
    cb: () => { if (!captured) throw new Error('bridge not invoked yet'); return captured },
    sends,
    open: () => { isOpen = true; return isOpen }
  }
}

describe('grpc executors — reference validation', () => {
  it('grpcConnect returns an openSocketioConnect scope action with transport=grpc and no events', () => {
    const ctx = { node: { id: 'a', kind: 'grpcConnect', config: { requestId: 'req', connectionName: 'Echo' }, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    const res = grpcConnectExecutor({ nodeId: 'a', kind: 'grpcConnect', scope: [], inputs: {} } as unknown as Activation, ctx) as ExecResult & { scopeAction: { type: string; transport: string; requestId: string; events: string[]; connectionName: string } }
    expect(res.scopeAction.type).toBe('openSocketioConnect')
    expect(res.scopeAction.transport).toBe('grpc')
    expect(res.scopeAction.requestId).toBe('req')
    expect(res.scopeAction.connectionName).toBe('Echo')
    expect(res.scopeAction.events).toEqual([])
  })

  it('grpcConnect without a requestId throws', () => {
    const ctx = { node: { id: 'a', kind: 'grpcConnect', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    expect(() => grpcConnectExecutor({ nodeId: 'a', kind: 'grpcConnect', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/requestId/)
  })

  it('grpcSend with no connection selected throws (hard error)', () => {
    const ctx = { node: { id: 'b', kind: 'grpcSend', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } }, variables: new Map() } as unknown as ExecContext
    expect(() => grpcSendExecutor({ nodeId: 'b', kind: 'grpcSend', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/no connection selected/)
  })

  it('grpcSend errors when the referenced connection does not exist in the run', () => {
    const ctx = {
      node: { id: 'b', kind: 'grpcSend', config: { connectionNodeId: 'a' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
      variables: new Map(),
      socketio: { has: () => false, isOpen: () => false, send: () => false, close: () => false }
    } as unknown as ExecContext
    expect(() => grpcSendExecutor({ nodeId: 'b', kind: 'grpcSend', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/does not exist/)
  })

  it('grpcClose with no connection selected throws (hard error)', () => {
    const ctx = { node: { id: 'c', kind: 'grpcClose', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    expect(() => grpcCloseExecutor({ nodeId: 'c', kind: 'grpcClose', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/no connection selected/)
  })
})

describe('grpc scheduler — streaming call lifecycle', () => {
  it('routes every received frame to the single `message` port and fires done on close', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'grpcConnect', outputs: ['connected', 'message'], config: { requestId: 'req', connectionName: 'Echo' } },
        { id: 'onConn', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'onMsg', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'onDone', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['a', 'connected'], to: ['onConn', 'in'] },
        { from: ['a', 'message'], to: ['onMsg', 'in'] },
        { from: ['a', 'done'], to: ['onDone', 'in'] }
      ]
    )
    const connectedVals: unknown[] = []
    const msgVals: unknown[] = []
    let doneRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', grpcConnectExecutor],
      ['onConn', (act) => { connectedVals.push(act.inputs['in']); return { outputs: [] } }],
      ['onMsg', (act) => { msgVals.push(act.inputs['in']); return { outputs: [] } }],
      ['onDone', () => { doneRuns += 1; return { outputs: [] } }]
    ])

    const fb = fakeBridge()
    const s = new Scheduler({ scenario, executors, socketioConnect: fb.bridge })
    const done = s.run()

    await flush()
    expect(s.status().state).toBe('running')

    fb.open()
    fb.cb().onConnect()
    await flush()
    expect(connectedVals).toHaveLength(1)

    // Streaming RPC frames carry no event name — every one lands on `message`.
    fb.cb().onMessage(undefined, { f_string: 'hello' })
    await flush()
    fb.cb().onMessage(undefined, { f_string: 'world' })
    await flush()
    expect(msgVals).toEqual([{ f_string: 'hello' }, { f_string: 'world' }])

    fb.cb().onClose()
    await done
    expect(doneRuns).toBe(1)
    expect(s.status().state).toBe('completed')
  })

  it('a send node writes on the open call with no channel; a close node half-closes it', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'grpcConnect', outputs: ['connected', 'message'], config: { requestId: 'req', connectionName: 'Echo' } },
        { id: 'b', kind: 'grpcSend', inputs: ['in', 'payload'], outputs: [], config: { connectionNodeId: 'a', payload: { type: 'string', value: '{"f_string":"hi"}' } } },
        { id: 'c', kind: 'grpcClose', inputs: ['in'], outputs: [], config: { connectionNodeId: 'a' } }
      ],
      [
        { from: ['a', 'connected'], to: ['b', 'in'] },
        { from: ['b', 'done'], to: ['c', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['a', grpcConnectExecutor],
      ['b', grpcSendExecutor],
      ['c', grpcCloseExecutor]
    ])
    const fb = fakeBridge()
    const s = new Scheduler({ scenario, executors, socketioConnect: fb.bridge })
    const done = s.run()

    await flush()
    fb.open()
    fb.cb().onConnect()
    await done
    expect(s.status().state).toBe('completed')
    // Empty channel → a plain stream write.
    expect(fb.sends).toEqual([{ channel: '', payload: '{"f_string":"hi"}' }])
  })

  it('a Stop closes the call (no done fired; run cancelled)', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'grpcConnect', outputs: ['connected', 'message'], config: { requestId: 'req', connectionName: 'Echo' } },
        { id: 'onDone', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [{ from: ['a', 'done'], to: ['onDone', 'in'] }]
    )
    let doneRuns = 0
    const closeSpy = vi.fn()
    let captured: SocketioConnectRequest | undefined
    const bridge = (req: SocketioConnectRequest): SocketioConnHandle => {
      captured = req
      return { send: () => true, close: () => { closeSpy(); req.onClose() }, isOpen: () => true }
    }
    const executors = new Map<string, NodeExecutor>([
      ['a', grpcConnectExecutor],
      ['onDone', () => { doneRuns += 1; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors, socketioConnect: bridge })
    const done = s.run()
    await flush()
    captured?.onConnect()
    await flush()
    s.abort('user stop')
    await done
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(doneRuns).toBe(0)
    expect(s.status().state).toBe('cancelled')
  })
})
