import { describe, it, expect, vi } from 'vitest'
import { Scheduler, type SocketioConnectRequest, type SocketioConnHandle } from './scheduler'
import { websocketConnectExecutor, websocketSendExecutor, websocketCloseExecutor, websocketServerCloseExecutor } from './executors/socketioExecutors'
import type { Activation, ExecContext, ExecResult, NodeExecutor, ScenarioModel } from './types'

/**
 * Raw WebSocket scenario nodes (A connect / B send / C close): the same
 * long-lived-connection machinery as Socket.IO, but a raw socket has no named
 * events, so every received frame re-emits on a single `message` port (no
 * `event:<name>` / `others` / "+"), and a send carries no channel.
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

/** A controllable in-memory socket bridge — captures the scheduler's callbacks so
 * a test can drive connect / message / close, and records sends. */
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

describe('websocket executors — reference validation', () => {
  it('websocketConnect returns an openSocketioConnect scope action with transport=websocket and no events', () => {
    const ctx = { node: { id: 'a', kind: 'websocketConnect', config: { requestId: 'req', connectionName: 'Echo' }, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    const res = websocketConnectExecutor({ nodeId: 'a', kind: 'websocketConnect', scope: [], inputs: {} } as unknown as Activation, ctx) as ExecResult & { scopeAction: { type: string; transport: string; requestId: string; events: string[]; connectionName: string } }
    expect(res.scopeAction.type).toBe('openSocketioConnect')
    expect(res.scopeAction.transport).toBe('websocket')
    expect(res.scopeAction.requestId).toBe('req')
    expect(res.scopeAction.connectionName).toBe('Echo')
    expect(res.scopeAction.events).toEqual([])
  })

  it('websocketConnect without a requestId throws', () => {
    const ctx = { node: { id: 'a', kind: 'websocketConnect', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    expect(() => websocketConnectExecutor({ nodeId: 'a', kind: 'websocketConnect', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/requestId/)
  })

  it('websocketSend with no connection selected throws (hard error)', () => {
    const ctx = { node: { id: 'b', kind: 'websocketSend', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } }, variables: new Map() } as unknown as ExecContext
    expect(() => websocketSendExecutor({ nodeId: 'b', kind: 'websocketSend', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/no connection selected/)
  })

  it('websocketSend errors when the referenced connection does not exist in the run', () => {
    const ctx = {
      node: { id: 'b', kind: 'websocketSend', config: { connectionNodeId: 'a' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
      variables: new Map(),
      socketio: { has: () => false, isOpen: () => false, send: () => false, close: () => false }
    } as unknown as ExecContext
    expect(() => websocketSendExecutor({ nodeId: 'b', kind: 'websocketSend', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/does not exist/)
  })

  it('websocketClose with no connection selected throws (hard error)', () => {
    const ctx = { node: { id: 'c', kind: 'websocketClose', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    expect(() => websocketCloseExecutor({ nodeId: 'c', kind: 'websocketClose', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/no connection selected/)
  })

  it('websocketServerClose with no server selected throws (hard error)', () => {
    const ctx = { node: { id: 'sc', kind: 'websocketServerClose', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    expect(() => websocketServerCloseExecutor({ nodeId: 'sc', kind: 'websocketServerClose', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/no server selected/)
  })

  it('websocketServerClose errors when the referenced server does not exist in the run', () => {
    const ctx = {
      node: { id: 'sc', kind: 'websocketServerClose', config: { connectionNodeId: 'a' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
      socketio: { has: () => false, isOpen: () => false, send: () => false, close: () => false }
    } as unknown as ExecContext
    expect(() => websocketServerCloseExecutor({ nodeId: 'sc', kind: 'websocketServerClose', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/does not exist/)
  })
})

describe('websocket scheduler — connection lifecycle', () => {
  it('routes every received frame to the single `message` port and fires done on close', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'websocketConnect', outputs: ['connected', 'message'], config: { requestId: 'req', connectionName: 'Echo' } },
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
      ['a', websocketConnectExecutor],
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

    // Raw WS frames carry no event name — every one lands on `message`.
    fb.cb().onMessage(undefined, { hello: 'world' })
    await flush()
    fb.cb().onMessage(undefined, { n: 1 })
    await flush()
    expect(msgVals).toEqual([{ hello: 'world' }, { n: 1 }])

    fb.cb().onClose()
    await done
    expect(doneRuns).toBe(1)
    expect(s.status().state).toBe('completed')
  })

  it('a send node emits on the open connection with no channel; a close node ends it', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'websocketConnect', outputs: ['connected', 'message'], config: { requestId: 'req', connectionName: 'Echo' } },
        { id: 'b', kind: 'websocketSend', inputs: ['in', 'payload'], outputs: [], config: { connectionNodeId: 'a', payload: { type: 'string', value: '{"hi":1}' } } },
        { id: 'c', kind: 'websocketClose', inputs: ['in'], outputs: [], config: { connectionNodeId: 'a' } }
      ],
      [
        { from: ['a', 'connected'], to: ['b', 'in'] },
        { from: ['b', 'done'], to: ['c', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['a', websocketConnectExecutor],
      ['b', websocketSendExecutor],
      ['c', websocketCloseExecutor]
    ])
    const fb = fakeBridge()
    const s = new Scheduler({ scenario, executors, socketioConnect: fb.bridge })
    const done = s.run()

    await flush()
    fb.open()
    fb.cb().onConnect()
    await done
    expect(s.status().state).toBe('completed')
    // Empty channel → a plain ws.send(payload).
    expect(fb.sends).toEqual([{ channel: '', payload: '{"hi":1}' }])
  })

  it('a websocketServerClose stops a server-hosting connect and fires its done', async () => {
    // A `server: true`-bound websocketConnect HOSTS a raw-WS mock server; the
    // dedicated server-close node stops it exactly like a client close — the
    // referenced connect node is closed, freeing its port, and its `done` fires.
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'websocketConnect', outputs: ['connected', 'message'], config: { requestId: 'srvReq', connectionName: 'Mock' } },
        { id: 'c', kind: 'websocketServerClose', inputs: ['in'], outputs: [], config: { connectionNodeId: 'a' } },
        { id: 'onDone', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['a', 'connected'], to: ['c', 'in'] },
        { from: ['a', 'done'], to: ['onDone', 'in'] }
      ]
    )
    let doneRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', websocketConnectExecutor],
      ['c', websocketServerCloseExecutor],
      ['onDone', () => { doneRuns += 1; return { outputs: [] } }]
    ])
    const fb = fakeBridge()
    const s = new Scheduler({ scenario, executors, socketioConnect: fb.bridge })
    const done = s.run()

    await flush()
    fb.open()
    fb.cb().onConnect()
    await done
    expect(doneRuns).toBe(1)
    expect(s.status().state).toBe('completed')
  })

  it('a Stop closes the connection (no done fired; run cancelled)', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'websocketConnect', outputs: ['connected', 'message'], config: { requestId: 'req', connectionName: 'Echo' } },
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
      ['a', websocketConnectExecutor],
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
