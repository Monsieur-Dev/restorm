import { describe, expect, it, vi } from 'vitest'
// Reach into the library source directly. The renderer barrel
// (`electron-core-ui/renderer`) pulls in `@xyflow/react` via
// `JsonViewer`, which the vite-driven test bundler can't resolve at
// unit-test time without a jsdom-compatible shim.
import { eventBus } from '../../../electron-core-ui/src/renderer/services/EventBus'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../src/renderer/src/services/DocumentEvents'

// Waits for every pending microtask to drain so `emitLocalSync`'s
// `queueMicrotask` dispatch runs before we assert.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('request-history event wiring', () => {
  it('only fires REQUEST_HISTORY_OPEN listeners whose requestId matches the payload', async () => {
    const targetListener = vi.fn()
    const otherListener = vi.fn()

    const target = eventBus.subscribe<RequestHistoryEventPayload>(
      DocumentEvents.REQUEST_HISTORY_OPEN,
      (payload) => { if (payload.requestId === 'req-target') targetListener(payload) }
    )
    const other = eventBus.subscribe<RequestHistoryEventPayload>(
      DocumentEvents.REQUEST_HISTORY_OPEN,
      (payload) => { if (payload.requestId === 'req-other') otherListener(payload) }
    )

    try {
      eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_OPEN, { requestId: 'req-target' })
      await flushMicrotasks()

      expect(targetListener).toHaveBeenCalledTimes(1)
      expect(targetListener).toHaveBeenCalledWith({ requestId: 'req-target' })
      expect(otherListener).not.toHaveBeenCalled()
    } finally {
      target.unsubscribe()
      other.unsubscribe()
    }
  })

  it('delivers REQUEST_HISTORY_RECORDED to every subscriber so the statusbar can re-fetch its count', async () => {
    const a = vi.fn()
    const b = vi.fn()

    const subA = eventBus.subscribe<RequestHistoryEventPayload>(DocumentEvents.REQUEST_HISTORY_RECORDED, a)
    const subB = eventBus.subscribe<RequestHistoryEventPayload>(DocumentEvents.REQUEST_HISTORY_RECORDED, b)

    try {
      eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: 'req-abc' })
      await flushMicrotasks()

      expect(a).toHaveBeenCalledWith({ requestId: 'req-abc' })
      expect(b).toHaveBeenCalledWith({ requestId: 'req-abc' })
    } finally {
      subA.unsubscribe()
      subB.unsubscribe()
    }
  })

  it('stops firing after unsubscribe', async () => {
    const listener = vi.fn()
    const subscription = eventBus.subscribe<RequestHistoryEventPayload>(
      DocumentEvents.REQUEST_HISTORY_RECORDED,
      listener
    )
    subscription.unsubscribe()

    eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: 'req-x' })
    await flushMicrotasks()

    expect(listener).not.toHaveBeenCalled()
  })
})
