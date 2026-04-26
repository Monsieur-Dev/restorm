import { describe, it, expect, beforeEach, vi } from 'vitest'
import { toasterService } from './ToasterService'
import type {
  DoNotDisturbChangePayload,
  ShowFrameChangePayload,
  ToasterEvent,
  ToastsChangePayload
} from './types'

type PayloadFor<E extends ToasterEvent> =
  E extends 'toastsChange' ? ToastsChangePayload
    : E extends 'showFrameChange' ? ShowFrameChangePayload
      : E extends 'doNotDisturbChange' ? DoNotDisturbChangePayload
        : never

function allHidden(toasterId: string): boolean {
  return toasterService.getToasts(toasterId).every((t) => t.hidden)
}

function allVisible(toasterId: string): boolean {
  return toasterService.getToasts(toasterId).every((t) => !t.hidden)
}

function stubWindowApi(): void {
  vi.stubGlobal('window', {
    api: {
      logger: { log: vi.fn().mockResolvedValue(undefined) }
    }
  })
}

function collect<E extends ToasterEvent>(event: E): { id: string; payload: PayloadFor<E> }[] {
  const received: { id: string; payload: PayloadFor<E> }[] = []
  toasterService.on(event, (id, payload) => {
    received.push({ id, payload: payload as PayloadFor<E> })
  })
  return received
}

beforeEach(() => {
  stubWindowApi()
  toasterService._reset()
})

describe('register / unregister', () => {
  it('creates independent state per id', () => {
    toasterService.register('a', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
    toasterService.register('b', { showFrame: true, doNotDisturb: false, maxToasts: 5 })

    expect(toasterService.getShowFrame('a')).toBe(false)
    expect(toasterService.getShowFrame('b')).toBe(true)
  })

  it('warns and reconfigures on duplicate id — latest registration wins', async () => {
    const logSpy = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { api: { logger: { log: logSpy } } })

    toasterService.register('dup', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
    toasterService.register('dup', { showFrame: true, doNotDisturb: true, maxToasts: 7 })

    expect(toasterService.getShowFrame('dup')).toBe(true)
    expect(toasterService.getDoNotDisturb('dup')).toBe(true)

    // Logger is async but fire-and-forget — flush microtasks.
    await Promise.resolve()
    await Promise.resolve()
    const calls = logSpy.mock.calls
    expect(calls.some((c) => c[0] === 'warn' && String(c[1]).includes('"dup"'))).toBe(true)
  })

  it('unregister drops the state entirely', () => {
    toasterService.register('x', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
    toasterService.push('x', { title: 't', body: 'b' })
    expect(toasterService.getToasts('x')).toHaveLength(1)

    toasterService.unregister('x')
    expect(toasterService.getToasts('x')).toHaveLength(0)
  })
})

describe('push', () => {
  beforeEach(() => {
    toasterService.register('t', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
  })

  it('generates a uuid when no id is supplied and returns it', () => {
    const id = toasterService.push('t', { title: 'Hi', body: 'there' })
    expect(id).toBeTruthy()
    expect(typeof id).toBe('string')

    const toasts = toasterService.getToasts('t')
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.id).toBe(id)
    expect(toasts[0]?.title).toBe('Hi')
    expect(toasts[0]?.ariaLive).toBe('polite')
    expect(toasts[0]?.exiting).toBe(false)
  })

  it('respects a caller-supplied id', () => {
    const id = toasterService.push('t', { id: 'custom', title: 'Hi', body: 'there' })
    expect(id).toBe('custom')
    expect(toasterService.getToasts('t')[0]?.id).toBe('custom')
  })

  it('updates an existing toast in place when id matches — timer + createdAt reset', async () => {
    const first = toasterService.push('t', { id: 'same', title: 'First', body: 'A', durationMs: 1000 })
    const firstCreatedAt = toasterService.getToasts('t')[0]?.createdAt ?? 0

    // Ensure at least 1ms has elapsed.
    await new Promise((r) => setTimeout(r, 2))

    const second = toasterService.push('t', { id: 'same', title: 'Second', body: 'B', durationMs: 2000 })
    expect(second).toBe(first)

    const toasts = toasterService.getToasts('t')
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.id).toBe('same')
    expect(toasts[0]?.title).toBe('Second')
    expect(toasts[0]?.body).toBe('B')
    expect(toasts[0]?.durationMs).toBe(2000)
    expect(toasts[0]?.exiting).toBe(false)
    expect((toasts[0]?.createdAt ?? 0) > firstCreatedAt).toBe(true)
  })

  it('emits toastsChange on each push', () => {
    const received = collect('toastsChange')
    toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.push('t', { title: 'B', body: 'b' })
    expect(received).toHaveLength(2)
    expect(received[0]?.id).toBe('t')
    expect(received[1]?.payload.toasts).toHaveLength(2)
  })

  it('stores the toast with hidden=true under DND (archived, not displayed)', () => {
    toasterService.setDoNotDisturb('t', true)
    const received = collect('toastsChange')
    const id = toasterService.push('t', { title: 'Muted', body: 'x' })

    expect(id).toBeTruthy()
    const stored = toasterService.getToasts('t')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.hidden).toBe(true)
    expect(received).toHaveLength(1)
  })

  it('DND update-in-place keeps the toast hidden even if it was visible before', () => {
    toasterService.push('t', { id: 'same', title: 'A', body: '1' })
    expect(toasterService.getToasts('t')[0]?.hidden).toBe(false)

    toasterService.setDoNotDisturb('t', true)
    toasterService.push('t', { id: 'same', title: 'A updated', body: '2' })
    expect(toasterService.getToasts('t')[0]?.hidden).toBe(true)
  })

  it('returns "" when toaster is not registered', () => {
    const id = toasterService.push('unknown', { title: 'x', body: 'y' })
    expect(id).toBe('')
  })

  it('enforces maxToasts by dropping the oldest', () => {
    toasterService.register('cap', { showFrame: false, doNotDisturb: false, maxToasts: 3 })
    toasterService.push('cap', { id: 'a', title: 'A', body: 'a' })
    toasterService.push('cap', { id: 'b', title: 'B', body: 'b' })
    toasterService.push('cap', { id: 'c', title: 'C', body: 'c' })
    toasterService.push('cap', { id: 'd', title: 'D', body: 'd' })

    const ids = toasterService.getToasts('cap').map((x) => x.id)
    expect(ids).toEqual(['b', 'c', 'd'])
  })

  it('preserves caller ariaLive override', () => {
    toasterService.push('t', { title: 'A', body: 'a', ariaLive: 'assertive' })
    expect(toasterService.getToasts('t')[0]?.ariaLive).toBe('assertive')
  })
})

describe('dismiss / clear', () => {
  beforeEach(() => {
    toasterService.register('t', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
  })

  it('marks exiting=true then removes after gracePeriodMs', () => {
    vi.useFakeTimers()
    try {
      toasterService.push('t', { id: 'a', title: 'A', body: 'a' })
      toasterService.dismiss('t', 'a', 150)

      expect(toasterService.getToasts('t')[0]?.exiting).toBe(true)

      vi.advanceTimersByTime(160)
      expect(toasterService.getToasts('t')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes synchronously when gracePeriodMs is 0', () => {
    toasterService.push('t', { id: 'a', title: 'A', body: 'a' })
    toasterService.dismiss('t', 'a', 0)
    expect(toasterService.getToasts('t')).toHaveLength(0)
  })

  it('is a no-op for unknown toast id', () => {
    const received = collect('toastsChange')
    toasterService.dismiss('t', 'missing', 0)
    expect(received).toHaveLength(0)
  })

  it('is a no-op when dismissed twice', () => {
    toasterService.push('t', { id: 'a', title: 'A', body: 'a' })
    toasterService.dismiss('t', 'a', 100)
    const received = collect('toastsChange')
    toasterService.dismiss('t', 'a', 100)
    expect(received).toHaveLength(0)
  })

  it('clear removes all toasts and emits one event', () => {
    toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.push('t', { title: 'B', body: 'b' })
    const received = collect('toastsChange')
    toasterService.clear('t')
    expect(toasterService.getToasts('t')).toHaveLength(0)
    expect(received).toHaveLength(1)
    expect(received[0]?.payload.toasts).toHaveLength(0)
  })

  it('clear is a no-op when already empty', () => {
    const received = collect('toastsChange')
    toasterService.clear('t')
    expect(received).toHaveLength(0)
  })
})

describe('showFrame flag', () => {
  beforeEach(() => {
    toasterService.register('t', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
  })

  it('setShowFrame toggles + emits when it changes', () => {
    const received = collect('showFrameChange')
    toasterService.setShowFrame('t', true)
    expect(toasterService.getShowFrame('t')).toBe(true)
    expect(received).toHaveLength(1)
    expect(received[0]?.payload).toEqual({ showFrame: true })
  })

  it('setShowFrame is a no-op when the value is unchanged', () => {
    toasterService.setShowFrame('t', true)
    const received = collect('showFrameChange')
    toasterService.setShowFrame('t', true)
    expect(received).toHaveLength(0)
  })

  it('toggleShowFrame flips the value', () => {
    expect(toasterService.getShowFrame('t')).toBe(false)
    toasterService.toggleShowFrame('t')
    expect(toasterService.getShowFrame('t')).toBe(true)
    toasterService.toggleShowFrame('t')
    expect(toasterService.getShowFrame('t')).toBe(false)
  })
})

describe('doNotDisturb flag', () => {
  beforeEach(() => {
    toasterService.register('t', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
  })

  it('setDoNotDisturb toggles + emits when it changes', () => {
    const received = collect('doNotDisturbChange')
    toasterService.setDoNotDisturb('t', true)
    expect(toasterService.getDoNotDisturb('t')).toBe(true)
    expect(received).toHaveLength(1)
    expect(received[0]?.payload).toEqual({ doNotDisturb: true })
  })

  it('setDoNotDisturb is a no-op when the value is unchanged', () => {
    toasterService.setDoNotDisturb('t', true)
    const received = collect('doNotDisturbChange')
    toasterService.setDoNotDisturb('t', true)
    expect(received).toHaveLength(0)
  })

  it('toggleDoNotDisturb flips the value', () => {
    expect(toasterService.getDoNotDisturb('t')).toBe(false)
    toasterService.toggleDoNotDisturb('t')
    expect(toasterService.getDoNotDisturb('t')).toBe(true)
    toasterService.toggleDoNotDisturb('t')
    expect(toasterService.getDoNotDisturb('t')).toBe(false)
  })
})

describe('seen / markSeen', () => {
  beforeEach(() => {
    toasterService.register('t', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
  })

  it('new toasts start with seen=false', () => {
    toasterService.push('t', { title: 'A', body: 'a' })
    expect(toasterService.getToasts('t')[0]?.seen).toBe(false)
  })

  it('markSeen sets seen=true and emits toastsChange', () => {
    const id = toasterService.push('t', { title: 'A', body: 'a' })
    const received = collect('toastsChange')

    toasterService.markSeen('t', id)

    expect(toasterService.getToasts('t')[0]?.seen).toBe(true)
    expect(received).toHaveLength(1)
  })

  it('markSeen is a no-op when the toast is already seen', () => {
    const id = toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.markSeen('t', id)
    const received = collect('toastsChange')

    toasterService.markSeen('t', id)

    expect(received).toHaveLength(0)
  })

  it('markSeen is a no-op for an unknown toast id', () => {
    const received = collect('toastsChange')
    toasterService.markSeen('t', 'missing')
    expect(received).toHaveLength(0)
  })

  it('push update-in-place preserves the existing seen flag', () => {
    const id = toasterService.push('t', { id: 'same', title: 'A', body: '1' })
    toasterService.markSeen('t', id)
    expect(toasterService.getToasts('t')[0]?.seen).toBe(true)

    toasterService.push('t', { id: 'same', title: 'A updated', body: '2' })

    expect(toasterService.getToasts('t')[0]?.seen).toBe(true)
  })

  it('a fresh push alongside seen toasts leaves siblings seen unchanged', () => {
    const a = toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.markSeen('t', a)
    toasterService.push('t', { title: 'B', body: 'b' })

    const stored = toasterService.getToasts('t')
    expect(stored.find((x) => x.title === 'A')?.seen).toBe(true)
    expect(stored.find((x) => x.title === 'B')?.seen).toBe(false)
  })
})

describe('hide / per-toast hidden flag', () => {
  beforeEach(() => {
    toasterService.register('t', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
  })

  it('new toasts start with hidden=false', () => {
    toasterService.push('t', { title: 'A', body: 'a' })
    expect(allVisible('t')).toBe(true)
  })

  it('hide marks all toasts hidden and closes the frame', () => {
    toasterService.setShowFrame('t', true)
    toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.push('t', { title: 'B', body: 'b' })

    const framed = collect('showFrameChange')
    const toasts = collect('toastsChange')
    toasterService.hide('t')

    expect(toasterService.getShowFrame('t')).toBe(false)
    expect(allHidden('t')).toBe(true)
    expect(framed).toHaveLength(1)
    expect(framed[0]?.payload).toEqual({ showFrame: false })
    // One toastsChange covering all toasts flipping to hidden.
    expect(toasts).toHaveLength(1)
  })

  it('hide does not emit showFrameChange when the frame was already closed', () => {
    toasterService.push('t', { title: 'A', body: 'a' })
    const framed = collect('showFrameChange')
    toasterService.hide('t')
    expect(framed).toHaveLength(0)
    expect(allHidden('t')).toBe(true)
  })

  it('push does NOT change sibling hidden state', () => {
    toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.hide('t')
    expect(allHidden('t')).toBe(true)

    toasterService.push('t', { title: 'B', body: 'b' })

    const toasts = toasterService.getToasts('t')
    const a = toasts.find((x) => x.title === 'A')
    const b = toasts.find((x) => x.title === 'B')
    expect(a?.hidden).toBe(true)
    expect(b?.hidden).toBe(false)
  })

  it('setShowFrame(true) reveals every hidden toast', () => {
    toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.push('t', { title: 'B', body: 'b' })
    toasterService.hide('t')

    toasterService.setShowFrame('t', true)

    expect(toasterService.getShowFrame('t')).toBe(true)
    expect(allVisible('t')).toBe(true)
  })

  it('setShowFrame(false) does NOT touch per-toast hidden flags', () => {
    toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.setShowFrame('t', true)

    toasterService.setShowFrame('t', false)

    expect(allVisible('t')).toBe(true)
  })

  it('re-pushing an existing id resets that toast to hidden=false', () => {
    toasterService.push('t', { id: 'same', title: 'A', body: 'a' })
    toasterService.hide('t')
    expect(allHidden('t')).toBe(true)

    toasterService.push('t', { id: 'same', title: 'A updated', body: 'a' })
    expect(allVisible('t')).toBe(true)
  })

  it('toggleVisibility hides when the frame is open', () => {
    toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.setShowFrame('t', true)
    toasterService.toggleVisibility('t')
    expect(toasterService.getShowFrame('t')).toBe(false)
    expect(allHidden('t')).toBe(true)
  })

  it('toggleVisibility opens the frame when transparent stack is visible', () => {
    toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.toggleVisibility('t')
    expect(toasterService.getShowFrame('t')).toBe(true)
    expect(allVisible('t')).toBe(true)
  })

  it('toggleVisibility opens the frame and reveals hidden toasts', () => {
    toasterService.push('t', { title: 'A', body: 'a' })
    toasterService.hide('t')
    toasterService.toggleVisibility('t')
    expect(toasterService.getShowFrame('t')).toBe(true)
    expect(allVisible('t')).toBe(true)
  })

  it('toggleVisibility opens the frame when the toaster is empty', () => {
    toasterService.toggleVisibility('t')
    expect(toasterService.getShowFrame('t')).toBe(true)
  })
})

describe('subscription', () => {
  it('calls listeners for only the matching event + returns an unsubscribe', () => {
    toasterService.register('t', { showFrame: false, doNotDisturb: false, maxToasts: 10 })

    const toasts: number[] = []
    const frames: number[] = []
    const offToasts = toasterService.on('toastsChange', () => { toasts.push(1) })
    const offFrame = toasterService.on('showFrameChange', () => { frames.push(1) })

    toasterService.push('t', { title: 'A', body: 'a' })
    expect(toasts).toHaveLength(1)
    expect(frames).toHaveLength(0)

    toasterService.setShowFrame('t', true)
    expect(frames).toHaveLength(1)

    offToasts()
    offFrame()
    toasterService.push('t', { title: 'B', body: 'b' })
    toasterService.setShowFrame('t', false)
    expect(toasts).toHaveLength(1)
    expect(frames).toHaveLength(1)
  })
})

describe('getToasts snapshot stability', () => {
  // `useSyncExternalStore` calls `getSnapshot` on every render and
  // compares the returned reference against the last one. Returning a
  // fresh `[]` each time ("getSnapshot should be cached …") caused a
  // Maximum-update-depth infinite loop on boot whenever a Toaster was
  // mounted for a toasterId the service hadn't registered yet
  // (renderer boot-order race). These tests pin the stable-reference
  // invariant.

  it('returns the same empty-array reference on successive calls for an unknown toasterId', () => {
    const first = toasterService.getToasts('never-registered')
    const second = toasterService.getToasts('never-registered')
    expect(first).toBe(second)
    expect(first).toHaveLength(0)
  })

  it('returns a stable reference when the state has not changed', () => {
    toasterService.register('stable', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
    const first = toasterService.getToasts('stable')
    const second = toasterService.getToasts('stable')
    expect(first).toBe(second)
  })

  it('returns a NEW reference after a mutation', () => {
    toasterService.register('stable', { showFrame: false, doNotDisturb: false, maxToasts: 10 })
    const before = toasterService.getToasts('stable')
    toasterService.push('stable', { title: 'A', body: 'a' })
    const after = toasterService.getToasts('stable')
    expect(after).not.toBe(before)
    expect(after).toHaveLength(1)
  })

  it('is immutable from the consumer side when empty', () => {
    const empty = toasterService.getToasts('never-registered')
    expect(() => {
      (empty as unknown as { push: (v: unknown) => void }).push({ fake: true })
    }).toThrow()
  })
})
