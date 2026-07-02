import { describe, it, expect } from 'vitest'
import { encodeGrpcWebFrame, decodeGrpcWebFrames, parseGrpcWebTrailers } from './grpcWebCodec'

describe('grpc-web frame encoding', () => {
  it('writes the 5-byte header (uncompressed flag + big-endian length) then the payload', () => {
    const payload = Buffer.from([1, 2, 3, 4])
    const frame = encodeGrpcWebFrame(payload)
    expect(frame.length).toBe(5 + payload.length)
    expect(frame.readUInt8(0)).toBe(0)
    expect(frame.readUInt32BE(1)).toBe(payload.length)
    expect(frame.subarray(5)).toEqual(payload)
  })

  it('round-trips an empty payload', () => {
    const frame = encodeGrpcWebFrame(Buffer.alloc(0))
    expect(frame.length).toBe(5)
    expect(frame.readUInt32BE(1)).toBe(0)
  })
})

describe('grpc-web frame decoding', () => {
  it('decodes a single DATA frame', () => {
    const payload = Buffer.from('{"f_string":"hi"}')
    const { frames, remainder } = decodeGrpcWebFrames(encodeGrpcWebFrame(payload))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ trailer: false })
    expect(frames[0]?.payload.toString()).toBe(payload.toString())
    expect(remainder.length).toBe(0)
  })

  it('decodes a multi-frame response body: several DATA frames + one TRAILERS frame', () => {
    const first = encodeGrpcWebFrame(Buffer.from('{"f_string":"one"}'))
    const second = encodeGrpcWebFrame(Buffer.from('{"f_string":"two"}'))
    const trailerPayload = Buffer.from('grpc-status: 0\r\ngrpc-message: OK\r\n')
    const trailerHeader = Buffer.alloc(5)
    trailerHeader.writeUInt8(0x80, 0)
    trailerHeader.writeUInt32BE(trailerPayload.length, 1)
    const body = Buffer.concat([first, second, trailerHeader, trailerPayload])

    const { frames, remainder } = decodeGrpcWebFrames(body)
    expect(frames).toHaveLength(3)
    expect(frames[0]).toMatchObject({ trailer: false })
    expect(frames[1]).toMatchObject({ trailer: false })
    expect(frames[2]).toMatchObject({ trailer: true })
    expect(frames[2]?.payload.toString()).toBe(trailerPayload.toString())
    expect(remainder.length).toBe(0)
  })

  it('stops at an incomplete trailing frame and returns it as remainder (for chunked streaming)', () => {
    const complete = encodeGrpcWebFrame(Buffer.from('{"ok":true}'))
    const partialHeader = Buffer.from([0, 0, 0, 0, 10]) // declares a 10-byte payload that never arrives
    const chunk = Buffer.concat([complete, partialHeader])

    const { frames, remainder } = decodeGrpcWebFrames(chunk)
    expect(frames).toHaveLength(1)
    expect(remainder).toEqual(partialHeader)
  })

  it('accumulates a frame split across two chunks via the remainder', () => {
    const payload = Buffer.from('{"f_string":"split across chunks"}')
    const frame = encodeGrpcWebFrame(payload)
    const splitAt = 3
    const firstChunk = frame.subarray(0, splitAt)
    const secondChunk = frame.subarray(splitAt)

    const first = decodeGrpcWebFrames(firstChunk)
    expect(first.frames).toHaveLength(0)
    expect(first.remainder).toEqual(firstChunk)

    const second = decodeGrpcWebFrames(Buffer.concat([first.remainder, secondChunk]))
    expect(second.frames).toHaveLength(1)
    expect(second.frames[0]?.payload.toString()).toBe(payload.toString())
    expect(second.remainder.length).toBe(0)
  })

  it('returns an empty result for an empty buffer', () => {
    const { frames, remainder } = decodeGrpcWebFrames(Buffer.alloc(0))
    expect(frames).toHaveLength(0)
    expect(remainder.length).toBe(0)
  })
})

describe('grpc-web trailer parsing', () => {
  it('parses key: value lines into a lower-cased map', () => {
    const trailers = parseGrpcWebTrailers(Buffer.from('grpc-status: 0\r\nGrpc-Message: OK\r\nx-trace-id: abc123\r\n'))
    expect(trailers).toEqual({
      'grpc-status': '0',
      'grpc-message': 'OK',
      'x-trace-id': 'abc123'
    })
  })

  it('skips blank lines and entries with no colon', () => {
    const trailers = parseGrpcWebTrailers(Buffer.from('grpc-status: 0\r\n\r\nmalformed-line-no-colon\r\n'))
    expect(trailers).toEqual({ 'grpc-status': '0' })
  })

  it('returns an empty map for an empty trailer payload', () => {
    expect(parseGrpcWebTrailers(Buffer.alloc(0))).toEqual({})
  })
})
