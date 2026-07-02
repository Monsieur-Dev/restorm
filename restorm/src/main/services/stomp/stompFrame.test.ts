import { describe, it, expect } from 'vitest'
import { encodeStompFrame, parseStompFrames, type StompFrame } from './stompFrame'

describe('stompFrame — encoder', () => {
  it('encodes a CONNECT frame with unescaped headers + no body (no content-length)', () => {
    const wire = encodeStompFrame({ command: 'CONNECT', headers: { 'accept-version': '1.2', host: '/', login: 'a:b' }, body: '' })
    expect(wire).toBe('CONNECT\naccept-version:1.2\nhost:/\nlogin:a:b\n\n\0')
  })

  it('auto-fills content-length (UTF-8 byte count) for a non-empty body', () => {
    const wire = encodeStompFrame({ command: 'SEND', headers: { destination: '/topic/test' }, body: 'hello' })
    expect(wire).toBe('SEND\ndestination:/topic/test\ncontent-length:5\n\nhello\0')
  })

  it('does not override an explicit content-length', () => {
    const wire = encodeStompFrame({ command: 'SEND', headers: { destination: '/q', 'content-length': '0' }, body: 'ignored-by-header' })
    expect(wire).toContain('content-length:0')
  })

  it('escapes colon, backslash, CR and LF in a SUBSCRIBE header value', () => {
    const wire = encodeStompFrame({ command: 'SUBSCRIBE', headers: { id: '0', destination: 'a:b\\c\nd\re' }, body: '' })
    expect(wire).toContain('destination:a\\cb\\\\c\\nd\\re')
  })
})

describe('stompFrame — parser', () => {
  it('parses a CONNECTED frame (unescaped headers)', () => {
    const [frame] = parseStompFrames('CONNECTED\nversion:1.2\nsession:sess-1\nheart-beat:5000,5000\n\n\0')
    expect(frame).toEqual<StompFrame>({
      command: 'CONNECTED',
      headers: { version: '1.2', session: 'sess-1', 'heart-beat': '5000,5000' },
      body: ''
    })
  })

  it('parses a MESSAGE frame with a body', () => {
    const [frame] = parseStompFrames('MESSAGE\nsubscription:0\nmessage-id:m-1\ndestination:/topic/test\ncontent-type:text/plain\n\nhello world\0')
    expect(frame?.command).toBe('MESSAGE')
    expect(frame?.headers['destination']).toBe('/topic/test')
    expect(frame?.headers['subscription']).toBe('0')
    expect(frame?.body).toBe('hello world')
  })

  it('unescapes colon, backslash, CR and LF in a non-CONNECT frame header', () => {
    const [frame] = parseStompFrames('MESSAGE\ndestination:a\\cb\\\\c\\nd\\re\n\n\0')
    expect(frame?.headers['destination']).toBe('a:b\\c\nd\re')
  })

  it('does NOT unescape CONNECT/CONNECTED headers (1.0 backward compat)', () => {
    const [frame] = parseStompFrames('CONNECT\nlogin:a\\cb\n\n\0')
    expect(frame?.headers['login']).toBe('a\\cb')
  })

  it('trims the body to an explicit content-length', () => {
    const frames = parseStompFrames('MESSAGE\ndestination:/q\ncontent-length:5\n\nhello\0')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.body).toBe('hello')
  })

  it('preserves an embedded NUL byte in the body when content-length declares it', () => {
    const raw = 'MESSAGE\ndestination:/q\ncontent-length:7\n\nab\0cdef\0NEXT\ndestination:/other\n\ntail\0'
    const frames = parseStompFrames(raw)
    expect(frames).toHaveLength(2)
    expect(frames[0]?.body).toBe('ab\0cdef')
    expect(frames[1]?.command).toBe('NEXT')
    expect(frames[1]?.body).toBe('tail')
  })

  it('keeps only the FIRST occurrence of a repeated header', () => {
    const [frame] = parseStompFrames('MESSAGE\ndestination:/first\ndestination:/second\n\n\0')
    expect(frame?.headers['destination']).toBe('/first')
  })

  it('parses an ERROR frame', () => {
    const [frame] = parseStompFrames('ERROR\nmessage:malformed frame\ncontent-type:text/plain\n\nbad request\0')
    expect(frame?.command).toBe('ERROR')
    expect(frame?.headers['message']).toBe('malformed frame')
    expect(frame?.body).toBe('bad request')
  })

  it('parses multiple frames concatenated in one message', () => {
    const frames = parseStompFrames('RECEIPT\nreceipt-id:r-1\n\n\0MESSAGE\ndestination:/q\n\nsecond\0')
    expect(frames).toHaveLength(2)
    expect(frames[0]?.command).toBe('RECEIPT')
    expect(frames[1]?.command).toBe('MESSAGE')
    expect(frames[1]?.body).toBe('second')
  })

  it('skips heart-beat EOLs between frames', () => {
    const frames = parseStompFrames('\n\nMESSAGE\ndestination:/q\n\nhi\0\n')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.command).toBe('MESSAGE')
  })

  it('returns no frames for a heart-beat-only message', () => {
    expect(parseStompFrames('\n')).toEqual([])
    expect(parseStompFrames('')).toEqual([])
  })

  it('round-trips encode → parse for CONNECT / SUBSCRIBE / SEND / ACK / NACK / DISCONNECT', () => {
    const originals: StompFrame[] = [
      { command: 'CONNECT', headers: { 'accept-version': '1.2', host: '/', 'heart-beat': '10000,10000' }, body: '' },
      { command: 'SUBSCRIBE', headers: { id: 'sub-0', destination: '/topic/test', ack: 'client' }, body: '' },
      { command: 'SEND', headers: { destination: '/topic/test' }, body: '{"hello":"world"}' },
      { command: 'ACK', headers: { id: 'm-1', subscription: 'sub-0' }, body: '' },
      { command: 'NACK', headers: { id: 'm-2', subscription: 'sub-0' }, body: '' },
      { command: 'DISCONNECT', headers: { receipt: 'bye-1' }, body: '' }
    ]
    for (const original of originals) {
      const [parsed] = parseStompFrames(encodeStompFrame(original))
      expect(parsed?.command).toBe(original.command)
      expect(parsed?.body).toBe(original.body)
      for (const [k, v] of Object.entries(original.headers)) {
        expect(parsed?.headers[k]).toBe(v)
      }
    }
  })
})
