import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitExecutor, waitUntilExecutor } from './timeAndFlowExecutors'
import type { ExecResult } from '../types'

/**
 * `wait` / `waitUntil` sleep cooperatively: they resolve after a timer,
 * scale a wired duration by the node's unit, emit NO value output (sequencing is
 * the universal `done` port), and reject (so the scheduler aborts) on
 * cancellation. Fake timers keep the suite instant.
 */

function makeCtx(signal: AbortSignal, config: Record<string, unknown>): never {
  return {
    signal,
    log: () => undefined,
    variables: new Map<string, unknown>(),
    runSubScenario: () => Promise.reject(new Error('not wired')),
    requestUserInput: () => Promise.reject(new Error('not wired')),
    node: { id: 'w', kind: 'wait', config, inputs: [], outputs: [], position: { x: 0, y: 0 } }
  } as never
}

function act(inputs: Record<string, unknown>): never {
  return { nodeId: 'w', kind: 'wait', scope: [], inputs } as never
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('waitExecutor', () => {
  it('scales a wired duration by the input unit (s → ms) and emits no value output', async () => {
    const p = waitExecutor(act({ duration: 2, in: 'sig' }), makeCtx(new AbortController().signal, { inputUnit: 's' })) as Promise<ExecResult>
    let done = false
    void p.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(1999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toEqual({ outputs: [] })
  })

  it('throws when the wired duration is null (no silent default)', () => {
    expect(() => waitExecutor(act({ duration: null, in: 'sig' }), makeCtx(new AbortController().signal, { inputUnit: 's' }))).toThrow(/null/)
  })

  it('uses the config duration (ms) when no duration is wired', async () => {
    const p = waitExecutor(act({}), makeCtx(new AbortController().signal, { durationMs: 500 })) as Promise<ExecResult>
    let done = false
    void p.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(499)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })

  it('rejects when the run is aborted mid-wait', async () => {
    const ctl = new AbortController()
    const p = waitExecutor(act({ duration: 10, in: 'sig' }), makeCtx(ctl.signal, { inputUnit: 's' })) as Promise<ExecResult>
    ctl.abort()
    await expect(p).rejects.toThrow('cancelled')
  })
})

describe('waitUntilExecutor', () => {
  it('throws when the wired target is null', () => {
    expect(() => waitUntilExecutor(act({ until: null, in: 'sig' }), makeCtx(new AbortController().signal, {}))).toThrow(/null/)
  })

  it('fires immediately for a target already in the past', async () => {
    const past = new Date(Date.now() - 5000).toISOString()
    const p = waitUntilExecutor(act({ until: past, in: 'sig' }), makeCtx(new AbortController().signal, {})) as Promise<ExecResult>
    await vi.advanceTimersByTimeAsync(0)
    expect(await p).toEqual({ outputs: [] })
  })

  it('waits until an epoch-ms target', async () => {
    const target = Date.now() + 1000
    const p = waitUntilExecutor(act({ until: target, in: 'sig' }), makeCtx(new AbortController().signal, {})) as Promise<ExecResult>
    let done = false
    void p.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })
})
