import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** Mutable array of fake BrowserWindow objects returned by getAllWindows. Tests
 * mutate this array before calling the executor. */
const fakeWindows: { webContents: { send: ReturnType<typeof vi.fn> } }[] = []

// Minimal Electron stub — getAllWindows returns the per-test `fakeWindows` array.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getName: () => 'restorm', on: () => undefined },
  BrowserWindow: {
    getAllWindows: (): typeof fakeWindows => fakeWindows
  }
}))

// conditionEval pulls in CollectionStore → electron-core-ui/main; stub the
// chain up to the module that actually needs it so the test runs without
// a real Electron environment.
vi.mock('../conditionEval', () => ({
  resolveOperand: (wired: unknown, cfg: unknown, _vars: unknown): unknown => {
    if (wired !== undefined) return wired
    // Minimal typed-value unwrap: { type: 'string'|'numeric', value } → value
    if (cfg !== null && typeof cfg === 'object' && 'value' in cfg) return (cfg as { value: unknown }).value
    return cfg
  }
}))

import { toastExecutor } from './toastExecutor'
import type { ExecResult } from '../types'

function runToast(
  config: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
  variables: Record<string, unknown> = {}
): ExecResult {
  const act = { nodeId: 'n', kind: 'toast', scope: 'root', inputs } as never
  const ctx = {
    node: { id: 'n', kind: 'toast', config, inputs: [], outputs: [], position: { x: 0, y: 0 } },
    variables: new Map<string, unknown>(Object.entries(variables)),
    log: vi.fn()
  } as never
  return toastExecutor(act, ctx) as ExecResult
}

describe('toastExecutor', () => {
  let mockSend: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSend = vi.fn()
    fakeWindows.length = 0
    fakeWindows.push({ webContents: { send: mockSend } })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('broadcasts title + message + level to all windows', () => {
    const result = runToast({
      title: { type: 'string', value: 'Heads up' },
      message: { type: 'string', value: 'Hello world' },
      level: 'success'
    })
    expect(mockSend).toHaveBeenCalledOnce()
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({
      title: 'Heads up',
      message: 'Hello world',
      level: 'success'
    }))
    expect(result.outputs).toEqual([])
  })

  it('defaults title to empty string when not set', () => {
    runToast({ message: { type: 'string', value: 'hi' } })
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({ title: '' }))
  })

  it('defaults level to info when not set', () => {
    runToast({ message: { type: 'string', value: 'hi' } })
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({ level: 'info' }))
  })

  it('converts duration seconds → ms (3 s → 3000 ms)', () => {
    runToast({ message: { type: 'string', value: 'timed' }, level: 'warning', duration: 3 })
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({ durationMs: 3000 }))
  })

  it('rounds a fractional seconds duration (1.5 s → 1500 ms)', () => {
    runToast({ message: { type: 'string', value: 'x' }, duration: 1.5 })
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({ durationMs: 1500 }))
  })

  it('duration 0 → not time-limited (durationMs omitted)', () => {
    runToast({ message: { type: 'string', value: 'persist' }, duration: 0 })
    const payload = mockSend.mock.calls[0][1] as Record<string, unknown>
    expect(payload.durationMs).toBeUndefined()
  })

  it('omits durationMs when duration is absent', () => {
    runToast({ message: { type: 'string', value: 'x' } })
    const payload = mockSend.mock.calls[0][1] as Record<string, unknown>
    expect(payload.durationMs).toBeUndefined()
  })

  it('uses a wired message / title input over config', () => {
    runToast(
      { title: { type: 'string', value: 'cfg title' }, message: { type: 'string', value: 'from config' } },
      { message: 'from wire', title: 'wired title' }
    )
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({
      message: 'from wire',
      title: 'wired title'
    }))
  })

  it('renders an inline Expression message via Handlebars against the run variables', () => {
    // `itemCount` (not `count`, which is a registered Handlebars helper) — a
    // plain run variable the template interpolates.
    runToast(
      { message: { type: 'expression', value: 'Got {{itemCount}} items' } },
      {},
      { itemCount: 3 }
    )
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({
      message: 'Got 3 items'
    }))
  })

  it('renders an inline Expression title via Handlebars against the run variables', () => {
    runToast(
      { title: { type: 'expression', value: 'Hello {{name}}' }, message: { type: 'string', value: 'body' } },
      {},
      { name: 'Marty' }
    )
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({
      title: 'Hello Marty',
      message: 'body'
    }))
  })

  it('an Expression referencing a variable named like a registered helper reads the VARIABLE, not the helper', () => {
    // Repro: setVariable(name="test") → toast(message="{{test}}"). `test` is a
    // registered Handlebars block helper, so a naive compile dispatches `{{test}}`
    // to the helper (which reads block options → "Cannot read properties of
    // undefined (reading 'inverse')") and the toast silently fails. The render
    // must give the CONTEXT VARIABLE priority and emit its value.
    runToast(
      { message: { type: 'expression', value: '{{test}}' } },
      {},
      { test: 'eeeeeee' }
    )
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({
      message: 'eeeeeee'
    }))
  })

  it('a wired message wins over an Expression config (no Handlebars on the wired value)', () => {
    runToast(
      { message: { type: 'expression', value: 'Got {{itemCount}} items' } },
      { message: 'wired wins' },
      { itemCount: 3 }
    )
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({
      message: 'wired wins'
    }))
  })

  it('throws on a malformed message expression so the scheduler routes it to the `error` port', () => {
    // An unclosed block is a parse error; the executor lets it throw (not
    // swallow) so the failure surfaces on the node's error port — never a
    // silently-missing toast.
    expect(() => runToast({ message: { type: 'expression', value: '{{#if}}' } })).toThrow()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('headless — no windows — logs to run-log and returns empty outputs without throwing', () => {
    fakeWindows.length = 0
    const logFn = vi.fn()
    const act = { nodeId: 'n', kind: 'toast', scope: 'root', inputs: {} } as never
    const ctx = {
      node: { id: 'n', kind: 'toast', config: { title: { type: 'string', value: 'T' }, message: { type: 'string', value: 'silent' }, level: 'warning' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
      variables: new Map<string, unknown>(),
      log: logFn
    } as never
    const result = toastExecutor(act, ctx) as ExecResult
    expect(mockSend).not.toHaveBeenCalled()
    expect(logFn).toHaveBeenCalledWith(expect.objectContaining({ message: '[toast] T — silent' }))
    expect(result.outputs).toEqual([])
  })

  it('broadcasts to every open window', () => {
    const send2 = vi.fn()
    fakeWindows.push({ webContents: { send: send2 } })
    runToast({ message: { type: 'string', value: 'multi' } })
    expect(mockSend).toHaveBeenCalledOnce()
    expect(send2).toHaveBeenCalledOnce()
  })

  it('coerces a non-string resolved message to string', () => {
    runToast({}, { message: 42 })
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({ message: '42' }))
  })

  it('rejects an invalid level and falls back to info', () => {
    runToast({ message: { type: 'string', value: 'x' }, level: { type: 'string', value: 'critical' } })
    expect(mockSend).toHaveBeenCalledWith('scenario:toast', expect.objectContaining({ level: 'info' }))
  })
})
