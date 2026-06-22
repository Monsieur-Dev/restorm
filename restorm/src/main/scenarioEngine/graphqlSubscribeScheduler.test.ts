import { describe, it, expect, vi } from 'vitest'
import { Scheduler, type SocketioConnectRequest, type SocketioConnHandle } from './scheduler'
import { graphqlSubscribeExecutor, graphqlUnsubscribeExecutor } from './executors/socketioExecutors'
import type { Activation, ExecContext, ExecResult, NodeExecutor, ScenarioModel } from './types'

/**
 * GraphQL subscription scenario nodes (A subscribe / C unsubscribe): the same
 * long-lived-connection machinery as gRPC client streaming — a subscription has
 * no named events, so every pushed payload re-emits on the single `message` port.
 * Receive-only: there is no send node.
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
 * so a test can drive connect / message / close. */
function fakeBridge(): {
  bridge: (req: SocketioConnectRequest) => SocketioConnHandle
  cb: () => SocketioConnectRequest
  open: () => boolean
} {
  let captured: SocketioConnectRequest | undefined
  let isOpen = false
  const bridge = (req: SocketioConnectRequest): SocketioConnHandle => {
    captured = req
    return {
      send: () => false,
      close: () => { isOpen = false; req.onClose() },
      isOpen: () => isOpen
    }
  }
  return {
    bridge,
    cb: () => { if (!captured) throw new Error('bridge not invoked yet'); return captured },
    open: () => { isOpen = true; return isOpen }
  }
}

describe('graphqlSubscribe executors — reference validation', () => {
  it('graphqlSubscribe returns an openSocketioConnect scope action with transport=graphql-subscribe and no events', () => {
    const ctx = { node: { id: 'a', kind: 'graphqlSubscribe', config: { requestId: 'req', connectionName: 'Ticks' }, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    const res = graphqlSubscribeExecutor({ nodeId: 'a', kind: 'graphqlSubscribe', scope: [], inputs: {} } as unknown as Activation, ctx) as ExecResult & { scopeAction: { type: string; transport: string; requestId: string; events: string[]; connectionName: string } }
    expect(res.scopeAction.type).toBe('openSocketioConnect')
    expect(res.scopeAction.transport).toBe('graphql-subscribe')
    expect(res.scopeAction.requestId).toBe('req')
    expect(res.scopeAction.connectionName).toBe('Ticks')
    expect(res.scopeAction.events).toEqual([])
  })

  it('graphqlSubscribe without a requestId throws', () => {
    const ctx = { node: { id: 'a', kind: 'graphqlSubscribe', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    expect(() => graphqlSubscribeExecutor({ nodeId: 'a', kind: 'graphqlSubscribe', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/requestId/)
  })

  it('graphqlUnsubscribe with no subscription selected throws (hard error)', () => {
    const ctx = { node: { id: 'c', kind: 'graphqlUnsubscribe', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
    expect(() => graphqlUnsubscribeExecutor({ nodeId: 'c', kind: 'graphqlUnsubscribe', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/no subscription selected/)
  })

  it('graphqlUnsubscribe errors when the referenced subscription does not exist in the run', () => {
    const ctx = {
      node: { id: 'c', kind: 'graphqlUnsubscribe', config: { connectionNodeId: 'a' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
      socketio: { has: () => false, isOpen: () => false, send: () => false, close: () => false }
    } as unknown as ExecContext
    expect(() => graphqlUnsubscribeExecutor({ nodeId: 'c', kind: 'graphqlUnsubscribe', scope: [], inputs: {} } as unknown as Activation, ctx)).toThrow(/does not exist/)
  })
})

describe('graphqlSubscribe scheduler — subscription lifecycle', () => {
  it('routes every pushed payload to the single `message` port and fires done on complete', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'graphqlSubscribe', outputs: ['connected', 'message'], config: { requestId: 'req', connectionName: 'Ticks' } },
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
      ['a', graphqlSubscribeExecutor],
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

    // Subscription payloads carry no event name — every one lands on `message`.
    fb.cb().onMessage(undefined, { data: { ticks: 1 } })
    await flush()
    fb.cb().onMessage(undefined, { data: { ticks: 2 } })
    await flush()
    expect(msgVals).toEqual([{ data: { ticks: 1 } }, { data: { ticks: 2 } }])

    // The server completes the subscription → the connection closes → done.
    fb.cb().onClose()
    await done
    expect(doneRuns).toBe(1)
    expect(s.status().state).toBe('completed')
  })

  it('an unsubscribe node tears the stream down and fires the subscribe node done', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'graphqlSubscribe', outputs: ['connected', 'message'], config: { requestId: 'req', connectionName: 'Ticks' } },
        { id: 'c', kind: 'graphqlUnsubscribe', inputs: ['in'], outputs: [], config: { connectionNodeId: 'a' } },
        { id: 'onDone', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['a', 'connected'], to: ['c', 'in'] },
        { from: ['a', 'done'], to: ['onDone', 'in'] }
      ]
    )
    let doneRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', graphqlSubscribeExecutor],
      ['c', graphqlUnsubscribeExecutor],
      ['onDone', () => { doneRuns += 1; return { outputs: [] } }]
    ])
    const fb = fakeBridge()
    const s = new Scheduler({ scenario, executors, socketioConnect: fb.bridge })
    const done = s.run()

    await flush()
    fb.open()
    fb.cb().onConnect()
    await done
    expect(s.status().state).toBe('completed')
    expect(doneRuns).toBe(1)
  })

  it('a Stop closes the subscription (no done fired; run cancelled)', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'graphqlSubscribe', outputs: ['connected', 'message'], config: { requestId: 'req', connectionName: 'Ticks' } },
        { id: 'onDone', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [{ from: ['a', 'done'], to: ['onDone', 'in'] }]
    )
    let doneRuns = 0
    const closeSpy = vi.fn()
    let captured: SocketioConnectRequest | undefined
    const bridge = (req: SocketioConnectRequest): SocketioConnHandle => {
      captured = req
      return { send: () => false, close: () => { closeSpy(); req.onClose() }, isOpen: () => true }
    }
    const executors = new Map<string, NodeExecutor>([
      ['a', graphqlSubscribeExecutor],
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
