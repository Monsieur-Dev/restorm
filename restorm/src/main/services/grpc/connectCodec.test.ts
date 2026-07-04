import { describe, it, expect } from 'vitest'
import { encodeConnectEnvelope, decodeConnectEnvelopes, parseConnectEndStream } from './connectCodec'

describe('Connect envelope encoding', () => {
  it('writes the 5-byte header (uncompressed flag + big-endian length) then the JSON payload', () => {
    const payload = Buffer.from('{"f_string":"hi"}')
    const envelope = encodeConnectEnvelope(payload)
    expect(envelope.length).toBe(5 + payload.length)
    expect(envelope.readUInt8(0)).toBe(0)
    expect(envelope.readUInt32BE(1)).toBe(payload.length)
    expect(envelope.subarray(5)).toEqual(payload)
  })

  it('round-trips an empty payload', () => {
    const envelope = encodeConnectEnvelope(Buffer.alloc(0))
    expect(envelope.length).toBe(5)
    expect(envelope.readUInt32BE(1)).toBe(0)
  })
})

describe('Connect envelope decoding', () => {
  it('decodes a single DATA envelope', () => {
    const payload = Buffer.from('{"f_string":"hi"}')
    const { envelopes, remainder } = decodeConnectEnvelopes(encodeConnectEnvelope(payload))
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]).toMatchObject({ endStream: false })
    expect(envelopes[0]?.payload.toString()).toBe(payload.toString())
    expect(remainder.length).toBe(0)
  })

  it('decodes a multi-envelope response body: several DATA envelopes + one END-STREAM envelope', () => {
    const first = encodeConnectEnvelope(Buffer.from('{"f_string":"one"}'))
    const second = encodeConnectEnvelope(Buffer.from('{"f_string":"two"}'))
    const endPayload = Buffer.from('{}')
    const endHeader = Buffer.alloc(5)
    endHeader.writeUInt8(0x02, 0)
    endHeader.writeUInt32BE(endPayload.length, 1)
    const body = Buffer.concat([first, second, endHeader, endPayload])

    const { envelopes, remainder } = decodeConnectEnvelopes(body)
    expect(envelopes).toHaveLength(3)
    expect(envelopes[0]).toMatchObject({ endStream: false })
    expect(envelopes[1]).toMatchObject({ endStream: false })
    expect(envelopes[2]).toMatchObject({ endStream: true })
    expect(envelopes[2]?.payload.toString()).toBe('{}')
    expect(remainder.length).toBe(0)
  })

  it('stops at an incomplete trailing envelope and returns it as remainder (for chunked streaming)', () => {
    const complete = encodeConnectEnvelope(Buffer.from('{"ok":true}'))
    const partialHeader = Buffer.from([0, 0, 0, 0, 10]) // declares a 10-byte payload that never arrives
    const chunk = Buffer.concat([complete, partialHeader])

    const { envelopes, remainder } = decodeConnectEnvelopes(chunk)
    expect(envelopes).toHaveLength(1)
    expect(remainder).toEqual(partialHeader)
  })

  it('accumulates an envelope split across two chunks via the remainder', () => {
    const payload = Buffer.from('{"f_string":"split across chunks"}')
    const envelope = encodeConnectEnvelope(payload)
    const splitAt = 3
    const firstChunk = envelope.subarray(0, splitAt)
    const secondChunk = envelope.subarray(splitAt)

    const first = decodeConnectEnvelopes(firstChunk)
    expect(first.envelopes).toHaveLength(0)
    expect(first.remainder).toEqual(firstChunk)

    const second = decodeConnectEnvelopes(Buffer.concat([first.remainder, secondChunk]))
    expect(second.envelopes).toHaveLength(1)
    expect(second.envelopes[0]?.payload.toString()).toBe(payload.toString())
    expect(second.remainder.length).toBe(0)
  })

  it('returns an empty result for an empty buffer', () => {
    const { envelopes, remainder } = decodeConnectEnvelopes(Buffer.alloc(0))
    expect(envelopes).toHaveLength(0)
    expect(remainder.length).toBe(0)
  })
})

describe('Connect end-stream parsing', () => {
  it('parses an error object', () => {
    const endStream = parseConnectEndStream(Buffer.from('{"error":{"code":"not_found","message":"nope"}}'))
    expect(endStream).toEqual({ error: { code: 'not_found', message: 'nope' } })
  })

  it('returns no error for a clean end-of-stream object', () => {
    expect(parseConnectEndStream(Buffer.from('{"metadata":{}}'))).toEqual({})
  })

  it('returns no error for an empty payload', () => {
    expect(parseConnectEndStream(Buffer.alloc(0))).toEqual({})
  })

  it('returns no error for a malformed payload rather than throwing', () => {
    expect(parseConnectEndStream(Buffer.from('not json'))).toEqual({})
  })
})
