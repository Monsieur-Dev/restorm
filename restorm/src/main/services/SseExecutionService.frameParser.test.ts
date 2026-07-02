import { describe, it, expect, vi } from 'vitest'

// Importing the service module pulls in Electron + electron-core-ui/main at
// the top level (for the singleton's broadcast helpers), so mock the same two
// surfaces the WebSocket execution-service tests do — this suite only
// exercises the standalone `SseFrameParser`, never the Electron-facing parts.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('electron-core-ui/main', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron-core-ui/main')>()
  return {
    ...actual,
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
  }
})

import { SseFrameParser } from './SseExecutionService'

describe('SseFrameParser', () => {
  it('dispatches a simple event on a blank line', () => {
    const parser = new SseFrameParser()
    const frames = parser.feed('data: hello\n\n')
    expect(frames).toEqual([{ event: 'message', data: 'hello' }])
  })

  it('joins multi-line data: blocks with a newline, trimming the trailing one', () => {
    const parser = new SseFrameParser()
    const frames = parser.feed('data: line1\ndata: line2\n\n')
    expect(frames).toEqual([{ event: 'message', data: 'line1\nline2' }])
  })

  it('ignores comment lines (leading colon)', () => {
    const parser = new SseFrameParser()
    const frames = parser.feed(':heartbeat\ndata: hello\n\n')
    expect(frames).toEqual([{ event: 'message', data: 'hello' }])
  })

  it('uses the event: field as the frame type, defaulting to "message"', () => {
    const parser = new SseFrameParser()
    const frames = parser.feed('event: ping\ndata: hello\n\n')
    expect(frames).toEqual([{ event: 'ping', data: 'hello' }])
  })

  it('attaches the id: field to the frame and remembers it across dispatches', () => {
    const parser = new SseFrameParser()
    const frames = parser.feed('id: 42\ndata: hello\n\ndata: world\n\n')
    expect(frames).toEqual([
      { event: 'message', data: 'hello', id: '42' },
      // id persists (the spec never resets the last-event-id buffer) even
      // though the second frame carries no id: field of its own.
      { event: 'message', data: 'world', id: '42' }
    ])
    expect(parser.getLastEventId()).toBe('42')
  })

  it('ignores an id: field containing a NUL character', () => {
    const parser = new SseFrameParser('seed')
    const frames = parser.feed('id: bad\u0000id\ndata: hello\n\n')
    expect(frames).toEqual([{ event: 'message', data: 'hello', id: 'seed' }])
    expect(parser.getLastEventId()).toBe('seed')
  })

  it('captures a retry: hint, consumed once via takeRetry', () => {
    const parser = new SseFrameParser()
    parser.feed('retry: 5000\ndata: hello\n\n')
    expect(parser.takeRetry()).toBe(5000)
    expect(parser.takeRetry()).toBeUndefined()
  })

  it('ignores a non-numeric retry: hint', () => {
    const parser = new SseFrameParser()
    parser.feed('retry: soon\ndata: hello\n\n')
    expect(parser.takeRetry()).toBeUndefined()
  })

  it('dispatches a frame for an empty data: line', () => {
    const parser = new SseFrameParser()
    const frames = parser.feed('data:\n\n')
    expect(frames).toEqual([{ event: 'message', data: '' }])
  })

  it('dispatches nothing on a blank line with no data: field', () => {
    const parser = new SseFrameParser()
    const frames = parser.feed('event: ping\n\n')
    expect(frames).toEqual([])
  })

  it('buffers an incomplete trailing line across feed() calls', () => {
    const parser = new SseFrameParser()
    expect(parser.feed('data: hel')).toEqual([])
    expect(parser.feed('lo\n\n')).toEqual([{ event: 'message', data: 'hello' }])
  })

  it('handles a \\r\\n line terminator split across two feed() calls', () => {
    const parser = new SseFrameParser()
    expect(parser.feed('data: hello\r')).toEqual([])
    expect(parser.feed('\ndata: world\r\n\r\n')).toEqual([
      { event: 'message', data: 'hello\nworld' }
    ])
  })

  it('handles bare \\r line terminators', () => {
    const parser = new SseFrameParser()
    const frames = parser.feed('data: hello\r\r')
    expect(frames).toEqual([{ event: 'message', data: 'hello' }])
  })

  it('parses several events arriving in one chunk', () => {
    const parser = new SseFrameParser()
    const frames = parser.feed('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n')
    expect(frames).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' }
    ])
  })

  it('treats a field line with no colon as a field name with an empty value', () => {
    const parser = new SseFrameParser()
    // "data" (no colon) is the empty-value form of the data: field per spec.
    const frames = parser.feed('data\n\n')
    expect(frames).toEqual([{ event: 'message', data: '' }])
  })

  it('strips exactly one leading space after the colon', () => {
    const parser = new SseFrameParser()
    const frames = parser.feed('data:  two spaces\n\n')
    expect(frames).toEqual([{ event: 'message', data: ' two spaces' }])
  })
})
