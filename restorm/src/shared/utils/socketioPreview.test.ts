import { describe, it, expect } from 'vitest'
import { socketioPreviewFromMessages } from './socketioPreview'

/**
 * The `socketioConnect` preview picks a representative RECEIVED frame from the
 * connection's history so an `event:<name>` edge gets a JSON-path picker over a
 * real message (the analogue of the httpRequest response preview).
 */
describe('socketioPreviewFromMessages', () => {
  const recv = (event: string, data: string): { direction: string; data: string; event?: string } =>
    ({ direction: 'received', data, event })
  const sent = (event: string, data: string): { direction: string; data: string; event?: string } =>
    ({ direction: 'sent', data, event })

  it('returns null when there are no received frames (only sent)', () => {
    expect(socketioPreviewFromMessages([sent('echo', '{"a":1}')], ['echo'])).toBeNull()
  })

  it('returns null for an empty history', () => {
    expect(socketioPreviewFromMessages([], ['echo'])).toBeNull()
  })

  it('prefers the latest received frame on a LISTENED event', () => {
    const msgs = [
      recv('echo', '{"hello":"first"}'),
      recv('other', '{"x":1}'),
      recv('echo', '{"hello":"latest"}'),
      recv('noise', '{"y":2}')
    ]
    expect(socketioPreviewFromMessages(msgs, ['echo'])).toEqual({ hello: 'latest' })
  })

  it('falls back to the latest received frame when none match a listened event', () => {
    const msgs = [recv('foo', '{"a":1}'), recv('bar', '{"b":2}')]
    expect(socketioPreviewFromMessages(msgs, ['echo'])).toEqual({ b: 2 })
  })

  it('takes the latest received frame with no listened events (raw WebSocket — no named events)', () => {
    const msgs = [recv(undefined as unknown as string, '{"hello":"world"}'), recv(undefined as unknown as string, '{"hello":"from HTTP"}')]
    expect(socketioPreviewFromMessages(msgs, [])).toEqual({ hello: 'from HTTP' })
  })

  it('ignores sent frames when picking', () => {
    const msgs = [sent('echo', '{"sent":true}'), recv('echo', '{"received":true}')]
    expect(socketioPreviewFromMessages(msgs, ['echo'])).toEqual({ received: true })
  })

  it('wraps a non-object payload as `{ value }` so it is still pickable', () => {
    expect(socketioPreviewFromMessages([recv('echo', 'plain-text')], ['echo'])).toEqual({ value: 'plain-text' })
    expect(socketioPreviewFromMessages([recv('echo', '42')], ['echo'])).toEqual({ value: 42 })
  })

  it('returns an array payload as-is (a picker can index it)', () => {
    expect(socketioPreviewFromMessages([recv('echo', '[1,2,3]')], ['echo'])).toEqual([1, 2, 3])
  })
})
