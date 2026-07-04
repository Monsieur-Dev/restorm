/**
 * gRPC-Web wire framing (binary variant only — `grpc-web-text`/base64
 * negotiation is out of scope; the transport toggle always sends
 * `application/grpc-web+proto`).
 *
 * A gRPC-Web message frame is a 5-byte header + payload, exactly like native
 * gRPC's HTTP/2 length-prefixed message framing:
 *   - byte 0:     flags (bit `0x80` set = this is the TRAILERS frame)
 *   - bytes 1-4:  payload length, big-endian uint32
 *   - bytes 5+:   payload — the raw protobuf-encoded message for a DATA
 *                 frame, or `\r\n`-joined `key: value` trailer lines for the
 *                 TRAILERS frame.
 *
 * A response body is zero or more DATA frames followed by exactly one
 * TRAILERS frame (carrying the gRPC status + any trailing metadata — HTTP/1.1
 * has no reliable native trailers, so gRPC-Web always frames them in-body).
 * See https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-web.md
 */

const TRAILER_FLAG = 0x80
const HEADER_LENGTH = 5

/** One decoded gRPC-Web frame: a message (`trailer: false`) or the trailer
 * block (`trailer: true`, payload is the raw `key: value\r\n...` text). */
export interface GrpcWebFrame {
  trailer: boolean
  payload: Buffer
}

/** Encode one message into a gRPC-Web DATA frame (uncompressed). */
export function encodeGrpcWebFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_LENGTH)
  header.writeUInt8(0, 0)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

/**
 * Decode every complete frame out of a (possibly partial) gRPC-Web body.
 * Stops at the first incomplete frame and returns the unconsumed bytes as
 * `remainder`, so a caller reading a chunked response can feed each chunk in
 * and keep accumulating `remainder` across calls until a frame completes.
 */
export function decodeGrpcWebFrames(buffer: Buffer): { frames: GrpcWebFrame[]; remainder: Buffer } {
  const frames: GrpcWebFrame[] = []
  let offset = 0
  while (offset + HEADER_LENGTH <= buffer.length) {
    const flags = buffer.readUInt8(offset)
    const length = buffer.readUInt32BE(offset + 1)
    const frameEnd = offset + HEADER_LENGTH + length
    if (frameEnd > buffer.length) break
    frames.push({
      trailer: (flags & TRAILER_FLAG) !== 0,
      payload: Buffer.from(buffer.subarray(offset + HEADER_LENGTH, frameEnd))
    })
    offset = frameEnd
  }
  return { frames, remainder: Buffer.from(buffer.subarray(offset)) }
}

/**
 * Parse a TRAILERS frame's payload (`\r\n`-joined `key: value` lines, the
 * same shape as native gRPC trailing metadata) into a lower-cased key map.
 * Blank lines and malformed entries (no `:`) are skipped.
 */
export function parseGrpcWebTrailers(payload: Buffer): Record<string, string> {
  const trailers: Record<string, string> = {}
  for (const line of payload.toString('utf8').split('\r\n')) {
    if (!line.trim()) continue
    const sep = line.indexOf(':')
    if (sep === -1) continue
    const key = line.slice(0, sep).trim().toLowerCase()
    const value = line.slice(sep + 1).trim()
    if (key) trailers[key] = value
  }
  return trailers
}
