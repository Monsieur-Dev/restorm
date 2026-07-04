import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Activation, ExecContext } from '../types'
import type { ScenarioNode } from '../../../shared/types/scenario'

/**
 * Redis scenario executors — the dual-mode split (streaming subscribe vs
 * unary command). `redisSubscribeExecutor` / `redisCloseExecutor` just build a
 * scope action / drive the socketio bridge (no I/O of their own, mirrors
 * `socketioConnectOverride.test.ts`). `redisCommandExecutor` is unary like
 * `soapRequestExecutor` — what matters there is the flush-before-run contract
 * (the executor must be authoritative whether or not the request's tab is
 * open) and the response-envelope mapping.
 */

const findById = vi.fn<(id: string) => unknown>()
const runCommand = vi.fn<(i: unknown) => Promise<unknown>>()
const cancel = vi.fn<(id: string) => boolean>()
const flushRequestStateToContext = vi.fn<(r: unknown) => void>()

vi.mock('../../services/CollectionStore', () => ({ collectionStore: { findById: (id: string) => findById(id) } }))
vi.mock('../../services/RedisExecutionService', () => ({
  redisExecutionService: { runCommand: (i: unknown) => runCommand(i), cancel: (id: string) => cancel(id) }
}))
vi.mock('../../mcp/tools/execute', () => ({ flushRequestStateToContext: (r: unknown) => { flushRequestStateToContext(r) } }))

// Import AFTER the mocks are registered.
const { redisSubscribeExecutor, redisCloseExecutor, redisCommandExecutor } = await import('./redisExecutors')

function makeRedisRequest(): Record<string, unknown> {
  return { id: 'redis-1', type: 'redis', url: 'redis://localhost:6379' }
}

function cannedResult(): Record<string, unknown> {
  return {
    requestId: 'redis-1',
    success: true,
    mode: 'command',
    command: 'GET',
    args: ['foo'],
    reply: 'bar',
    requestUrl: 'redis://localhost:6379',
    timings: { startedAt: '2026-01-01T00:00:00.000Z', durationMs: 4 }
  }
}

function makeCtx(node: ScenarioNode, opts: { signal?: AbortSignal; socketio?: ExecContext['socketio'] } = {}): ExecContext {
  return {
    signal: opts.signal ?? new AbortController().signal,
    log: () => undefined,
    variables: new Map(),
    runSubScenario: () => Promise.reject(new Error('not wired')),
    requestUserInput: () => Promise.reject(new Error('not wired')),
    node,
    ...(opts.socketio ? { socketio: opts.socketio } : {})
  } as unknown as ExecContext
}

function makeActivation(inputs: Record<string, unknown> = {}): Activation {
  return { nodeId: 'n1', kind: 'redisCommand' as Activation['kind'], scope: [], inputs }
}

function node(kind: string, config: Record<string, unknown>): ScenarioNode {
  return { id: 'n1', kind, config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
}

beforeEach(() => {
  findById.mockReset().mockReturnValue(makeRedisRequest())
  runCommand.mockReset().mockResolvedValue(cannedResult())
  cancel.mockReset().mockReturnValue(true)
  flushRequestStateToContext.mockReset()
})

describe('redisSubscribeExecutor', () => {
  it('emits an openSocketioConnect scope action on the redis-subscribe transport', async () => {
    const res = await redisSubscribeExecutor(makeActivation(), makeCtx(node('redisSubscribe', { requestId: 'redis-1' })))
    const sa = res.scopeAction as { type: string; transport: string; requestId: string; events: unknown[]; connectionName: string }
    expect(sa.type).toBe('openSocketioConnect')
    expect(sa.transport).toBe('redis-subscribe')
    expect(sa.requestId).toBe('redis-1')
    // Redis pub/sub has no named events beyond the channel — every message
    // routes to the single `message` port, same as mqttConnect.
    expect(sa.events).toEqual([])
    // Defaults the connection name to the bound requestId when unset.
    expect(sa.connectionName).toBe('redis-1')
  })

  it('uses an explicit connectionName when configured', async () => {
    const res = await redisSubscribeExecutor(makeActivation(), makeCtx(node('redisSubscribe', { requestId: 'redis-1', connectionName: '  events-bus  ' })))
    expect((res.scopeAction as { connectionName: string }).connectionName).toBe('events-bus')
  })

  it('threads quickConfig id + overrides into the scope action', async () => {
    const res = await redisSubscribeExecutor(makeActivation(), makeCtx(node('redisSubscribe', {
      requestId: 'redis-1', quickConfigId: 'qc-1', overrides: { channels: ['news'] }
    })))
    expect((res.scopeAction as { overrideConfig?: Record<string, unknown> }).overrideConfig).toEqual({
      quickConfigId: 'qc-1',
      overrides: { channels: ['news'] }
    })
  })

  it('omits overrideConfig when the node carries no override keys', async () => {
    const res = await redisSubscribeExecutor(makeActivation(), makeCtx(node('redisSubscribe', { requestId: 'redis-1' })))
    expect((res.scopeAction as { overrideConfig?: unknown }).overrideConfig).toBeUndefined()
  })

  it('throws when no request is bound', () => {
    expect(() => redisSubscribeExecutor(makeActivation(), makeCtx(node('redisSubscribe', {})))).toThrow(/no bound requestId/)
  })
})

describe('redisCloseExecutor', () => {
  it('closes the referenced connection via the socketio bridge', async () => {
    const close = vi.fn<(id: string) => boolean>().mockReturnValue(true)
    const has = vi.fn<(id: string) => boolean>().mockReturnValue(true)
    const socketio = { send: () => false, close, has, isOpen: () => true }
    await redisCloseExecutor(makeActivation(), makeCtx(node('redisClose', { connectionNodeId: 'sub-1' }), { socketio }))
    expect(has).toHaveBeenCalledWith('sub-1')
    expect(close).toHaveBeenCalledWith('sub-1')
  })

  it('throws when no connection is selected', () => {
    expect(() => redisCloseExecutor(makeActivation(), makeCtx(node('redisClose', {})))).toThrow(/no connection selected/)
  })

  it('throws when the socket bridge is unavailable', () => {
    expect(() => redisCloseExecutor(makeActivation(), makeCtx(node('redisClose', { connectionNodeId: 'sub-1' })))).toThrow(/socket bridge unavailable/)
  })

  it('throws when the referenced connection does not exist in this run', () => {
    const socketio = { send: () => false, close: vi.fn(), has: () => false, isOpen: () => false }
    expect(() =>
      redisCloseExecutor(makeActivation(), makeCtx(node('redisClose', { connectionNodeId: 'sub-1' }), { socketio }))
    ).toThrow(/does not exist in this run/)
  })
})

describe('redisCommandExecutor', () => {
  it('flushes the bound request before running the command', async () => {
    await redisCommandExecutor(makeActivation(), makeCtx(node('redisCommand', { requestId: 'redis-1' })))
    expect(flushRequestStateToContext).toHaveBeenCalledTimes(1)
    expect(flushRequestStateToContext).toHaveBeenCalledWith(makeRedisRequest())
    expect(runCommand).toHaveBeenCalledWith({ requestId: 'redis-1' })
  })

  it('emits the `response` port with the request + response envelope', async () => {
    const result = await redisCommandExecutor(makeActivation(), makeCtx(node('redisCommand', { requestId: 'redis-1' })))
    const out = result.outputs.find((o) => o.port === 'response')?.value as {
      request: { url: string; method: string }
      response: { status: number; success: boolean; body: string }
    }
    expect(out.request.url).toBe('redis://localhost:6379')
    expect(out.request.method).toBe('GET')
    // Redis has no HTTP-style status code.
    expect(out.response.status).toBe(0)
    expect(out.response.success).toBe(true)
    expect(out.response.body).toBe('bar')
  })

  it('surfaces a failed command as success=false with the error on the response', async () => {
    runCommand.mockResolvedValue({ ...cannedResult(), success: false, reply: undefined, error: 'ERR wrong number of arguments' })
    const result = await redisCommandExecutor(makeActivation(), makeCtx(node('redisCommand', { requestId: 'redis-1' })))
    const out = result.outputs.find((o) => o.port === 'response')?.value as { response: { success: boolean; error?: string } }
    expect(out.response.success).toBe(false)
    expect(out.response.error).toBe('ERR wrong number of arguments')
  })

  it('honours the abort signal by cancelling the in-flight command', async () => {
    const ctrl = new AbortController()
    let release: () => void = () => undefined
    runCommand.mockImplementation(() => new Promise((resolve) => { release = (): void => { resolve(cannedResult()) } }))
    const p = redisCommandExecutor(makeActivation(), makeCtx(node('redisCommand', { requestId: 'redis-1' }), { signal: ctrl.signal }))
    ctrl.abort()
    expect(cancel).toHaveBeenCalledWith('redis-1')
    release()
    await p
  })

  it('throws when the bound request is not a Redis request', async () => {
    findById.mockReturnValue({ id: 'redis-1', type: 'http' })
    await expect(redisCommandExecutor(makeActivation(), makeCtx(node('redisCommand', { requestId: 'redis-1' })))).rejects.toThrow(/not Redis/)
  })

  it('throws when no request is bound', async () => {
    await expect(redisCommandExecutor(makeActivation(), makeCtx(node('redisCommand', {})))).rejects.toThrow(/no bound requestId/)
  })
})
