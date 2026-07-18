import { describe, it, expect, vi } from 'vitest'
import { Scheduler, type SocketioConnectRequest, type SocketioConnHandle } from './scheduler'
import { socketioConnectExecutor, socketioSendExecutor, socketioCloseExecutor, socketioServerCloseExecutor } from './executors/socketioExecutors'
import type { Activation, ExecContext, ExecResult, NodeExecutor, ScenarioModel } from './types'

/**
 * Socket.IO scenario nodes (A connect / B send / C close):
 *  - the executors validate their references (a hard error when no connection
 *    is selected, as specified — never a silent no-op);
 *  - the scheduler drives the long-lived connection: `connected` fires on open,
 *    each received event re-emits on its `event:<name>` port (or `others`), and
 *    `done` fires when a close node (or a Stop) ends it.
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

/** A controllable in-memory socket bridge: captures the scheduler's callbacks so
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
    cb: () => {
      if (!captured) throw new Error('bridge not invoked yet')
      // Mark open the first time the test asks for the callbacks after connect.
      return captured
    },
    sends,
    open: () => { isOpen = true; return isOpen }
  }
}

describe('socketio executors — reference validation', () => {
  it('socketioConnect returns an openSocketioConnect scope action with its events', () => {
    const ctx = { node: { id: 'a', kind: 'socketioConnect', config: { requestId: 'req', connectionName: 'Echo', events: ['echo', 'echo', ''] }, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    const res = socketioConnectExecutor({ nodeId: 'a', kind: 'socketioConnect', scope: [], inputs: {} } as unknown as Activation, ctx) as ExecResult & { scopeAction: { type: string; requestId: string; events: string[]; connectionName: string } }
    expect(res.scopeAction.type).toBe('openSocketioConnect')
    expect(res.scopeAction.requestId).toBe('req')
    expect(res.scopeAction.connectionName).toBe('Echo')
    expect(res.scopeAction.events).toEqual(['echo'])
  })

  it('socketioConnect without a requestId throws', () => {
    const ctx = { node: { id: 'a', kind: 'socketioConnect', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    expect(() => socketioConnectExecutor({ nodeId: 'a', kind: 'socketioConnect', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/requestId/)
  })

  it('socketioSend with no connection selected throws (hard error)', () => {
    const ctx = { node: { id: 'b', kind: 'socketioSend', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } }, variables: new Map() } as unknown as ExecContext
    expect(() => socketioSendExecutor({ nodeId: 'b', kind: 'socketioSend', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/no connection selected/)
  })

  it('socketioSend errors when the referenced connection does not exist in the run', () => {
    const ctx = {
      node: { id: 'b', kind: 'socketioSend', config: { connectionNodeId: 'a' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
      variables: new Map(),
      socketio: { has: () => false, isOpen: () => false, send: () => false, close: () => false }
    } as unknown as ExecContext
    expect(() => socketioSendExecutor({ nodeId: 'b', kind: 'socketioSend', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/does not exist/)
  })

  it('socketioClose with no connection selected throws (hard error)', () => {
    const ctx = { node: { id: 'c', kind: 'socketioClose', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    expect(() => socketioCloseExecutor({ nodeId: 'c', kind: 'socketioClose', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/no connection selected/)
  })

  it('socketioServerClose with no server selected throws (hard error)', () => {
    const ctx = { node: { id: 'sc', kind: 'socketioServerClose', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    expect(() => socketioServerCloseExecutor({ nodeId: 'sc', kind: 'socketioServerClose', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/no server selected/)
  })

  it('socketioServerClose errors when the referenced server does not exist in the run', () => {
    const ctx = {
      node: { id: 'sc', kind: 'socketioServerClose', config: { connectionNodeId: 'a' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
      socketio: { has: () => false, isOpen: () => false, send: () => false, close: () => false }
    } as unknown as ExecContext
    expect(() => socketioServerCloseExecutor({ nodeId: 'sc', kind: 'socketioServerClose', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/does not exist/)
  })
})

describe('socketio scheduler — connection lifecycle', () => {
  it('connects, routes events to their ports / the catch-all, and fires done on close', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'socketioConnect', outputs: ['connected', 'others', 'event:echo'], config: { requestId: 'req', connectionName: 'Echo', events: ['echo'] } },
        { id: 'onConn', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'onEcho', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'onOther', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'onDone', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['a', 'connected'], to: ['onConn', 'in'] },
        { from: ['a', 'event:echo'], to: ['onEcho', 'in'] },
        { from: ['a', 'others'], to: ['onOther', 'in'] },
        { from: ['a', 'done'], to: ['onDone', 'in'] }
      ]
    )
    const connectedVals: unknown[] = []
    const echoVals: unknown[] = []
    const otherVals: unknown[] = []
    let doneRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', socketioConnectExecutor],
      ['onConn', (act) => { connectedVals.push(act.inputs['in']); return { outputs: [] } }],
      ['onEcho', (act) => { echoVals.push(act.inputs['in']); return { outputs: [] } }],
      ['onOther', (act) => { otherVals.push(act.inputs['in']); return { outputs: [] } }],
      ['onDone', () => { doneRuns += 1; return { outputs: [] } }]
    ])

    const fb = fakeBridge()
    const s = new Scheduler({ scenario, executors, socketioConnect: fb.bridge })
    const done = s.run()

    await flush()
    // A fired and opened the connection (run still alive, not completed).
    expect(s.status().state).toBe('running')

    fb.open()
    fb.cb().onConnect()
    await flush()
    expect(connectedVals).toHaveLength(1)

    fb.cb().onMessage('echo', { hello: 'world' })
    await flush()
    expect(echoVals).toEqual([{ hello: 'world' }])
    expect(otherVals).toHaveLength(0)

    // An un-listened event lands on the catch-all `others` port.
    fb.cb().onMessage('surprise', { n: 1 })
    await flush()
    expect(otherVals).toEqual([{ n: 1 }])
    expect(echoVals).toHaveLength(1)

    // Closing the connection fires the universal `done` port + completes the run.
    fb.cb().onClose()
    await done
    expect(doneRuns).toBe(1)
    expect(s.status().state).toBe('completed')
  })

  it('a socketioServerClose stops a server-hosting connect and fires its done', async () => {
    // A `server: true`-bound socketioConnect HOSTS a Socket.IO mock server; the
    // dedicated server-close node stops it exactly like a client close — the
    // referenced connect node is closed, freeing its port, and its `done` fires.
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'socketioConnect', outputs: ['connected', 'others'], config: { requestId: 'srvReq', connectionName: 'Mock', events: [] } },
        { id: 'c', kind: 'socketioServerClose', inputs: ['in'], outputs: [], config: { connectionNodeId: 'a' } },
        { id: 'onDone', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['a', 'connected'], to: ['c', 'in'] },
        { from: ['a', 'done'], to: ['onDone', 'in'] }
      ]
    )
    let doneRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', socketioConnectExecutor],
      ['c', socketioServerCloseExecutor],
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

  it('a send node emits on the open connection; a close node ends it', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'socketioConnect', outputs: ['connected', 'others'], config: { requestId: 'req', connectionName: 'Echo', events: [] } },
        { id: 'b', kind: 'socketioSend', inputs: ['in', 'channel', 'payload'], outputs: [], config: { connectionNodeId: 'a', channel: { type: 'string', value: 'echo' }, payload: { type: 'string', value: '{"hi":1}' } } },
        { id: 'c', kind: 'socketioClose', inputs: ['in'], outputs: [], config: { connectionNodeId: 'a' } }
      ],
      [
        { from: ['a', 'connected'], to: ['b', 'in'] },
        // The send sequences the close via its universal `done` port (no `sent`).
        { from: ['b', 'done'], to: ['c', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['a', socketioConnectExecutor],
      ['b', socketioSendExecutor],
      ['c', socketioCloseExecutor]
    ])
    const fb = fakeBridge()
    const s = new Scheduler({ scenario, executors, socketioConnect: fb.bridge })
    const done = s.run()

    await flush()
    fb.open()
    fb.cb().onConnect()
    // connected → B sends → B done → C closes → A done → run completes.
    await done
    expect(s.status().state).toBe('completed')
    expect(fb.sends).toEqual([{ channel: 'echo', payload: '{"hi":1}' }])
  })

  it('a Stop closes the connection (no done fired; run cancelled)', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'socketioConnect', outputs: ['connected', 'others'], config: { requestId: 'req', connectionName: 'Echo', events: [] } },
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
      ['a', socketioConnectExecutor],
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
