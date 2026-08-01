// @vitest-environment jsdom
/**
 * A single unresolvable environment variable legitimately badges every request
 * that references it — the badge is reference-aware, so those requests really
 * are blocked. What made it read as "everything is broken" was the wording: a
 * generic "a secret could not be retrieved" on each row, with nothing tying the
 * rows back to one cause. The store therefore has to carry the failing variable
 * names through to the badge.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useItemSecretStatus } from './secretItemStatusStore'

interface StatusPayload {
  itemId: string
  resolving: boolean
  error: boolean
  errorVars?: string[]
}

let emit: (payload: StatusPayload) => void = () => undefined

function installContextBridge(seed: StatusPayload[] = []): void {
  ;(window as unknown as Record<string, unknown>)['restorm'] = {
    context: {
      onItemSecretsStatus: (cb: (p: StatusPayload) => void) => {
        emit = cb
        return () => undefined
      },
      getItemSecretStatuses: () => Promise.resolve(seed)
    }
  }
}

beforeEach(() => { installContextBridge() })
afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>)['restorm']
})

describe('useItemSecretStatus', () => {
  it('reports a healthy item as clean', () => {
    const { result } = renderHook(() => useItemSecretStatus('req-1'))
    expect(result.current).toEqual({ resolving: false, error: false, errorVars: [] })
  })

  it('carries the failing environment variables to the consumer', () => {
    const { result } = renderHook(() => useItemSecretStatus('req-1'))
    act(() => { emit({ itemId: 'req-1', resolving: false, error: true, errorVars: ['API_TOKEN'] }) })
    expect(result.current.error).toBe(true)
    expect(result.current.errorVars).toEqual(['API_TOKEN'])
  })

  it('reports the SAME cause for every item blocked by one variable', () => {
    const first = renderHook(() => useItemSecretStatus('req-1'))
    const second = renderHook(() => useItemSecretStatus('req-2'))
    act(() => {
      emit({ itemId: 'req-1', resolving: false, error: true, errorVars: ['API_TOKEN'] })
      emit({ itemId: 'req-2', resolving: false, error: true, errorVars: ['API_TOKEN'] })
    })
    // Both badge — they genuinely reference the broken variable — but each can
    // now say WHICH variable, so the two rows read as one cause.
    expect(first.result.current.errorVars).toEqual(['API_TOKEN'])
    expect(second.result.current.errorVars).toEqual(second.result.current.errorVars)
    expect(second.result.current.errorVars).toEqual(['API_TOKEN'])
  })

  it('leaves errorVars empty for a failure in the item\'s own fields', () => {
    const { result } = renderHook(() => useItemSecretStatus('req-1'))
    act(() => { emit({ itemId: 'req-1', resolving: false, error: true, errorVars: [] }) })
    expect(result.current.error).toBe(true)
    expect(result.current.errorVars).toEqual([])
  })

  it('propagates a change to the failing variable set', () => {
    const { result } = renderHook(() => useItemSecretStatus('req-1'))
    act(() => { emit({ itemId: 'req-1', resolving: false, error: true, errorVars: ['API_TOKEN'] }) })
    act(() => { emit({ itemId: 'req-1', resolving: false, error: true, errorVars: ['API_TOKEN', 'DB_PASSWORD'] }) })
    expect(result.current.errorVars).toEqual(['API_TOKEN', 'DB_PASSWORD'])
  })

  it('clears the status when the variable resolves', () => {
    const { result } = renderHook(() => useItemSecretStatus('req-1'))
    act(() => { emit({ itemId: 'req-1', resolving: false, error: true, errorVars: ['API_TOKEN'] }) })
    act(() => { emit({ itemId: 'req-1', resolving: false, error: false, errorVars: [] }) })
    expect(result.current).toEqual({ resolving: false, error: false, errorVars: [] })
  })
})
