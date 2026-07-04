/**
 * Connect-RPC streaming envelope framing (JSON only — `application/connect+proto`
 * is out of scope; the transport toggle always sends `application/connect+json`).
 * Unary calls don't use this at all — see `connectTransport.ts`'s
 * `executeConnectUnary`, whose request/response bodies are plain, unenveloped
 * JSON — only streaming calls (server-stream here) frame each message.
 *
 * A Connect streaming envelope is a 5-byte header + JSON payload:
 *   - byte 0:     flags (bit `0x02` set = this is the END-STREAM envelope)
 *   - bytes 1-4:  payload length, big-endian uint32
 *   - bytes 5+:   payload — the JSON-encoded message for a DATA envelope, or
 *                 the end-of-stream JSON object (`{ error?, metadata? }`) for
 *                 the END-STREAM envelope.
 *
 * A streaming response body is zero or more DATA envelopes followed by
 * exactly one END-STREAM envelope (there are no separate HTTP trailers —
 * unlike gRPC-Web, the end-of-stream status travels as a JSON envelope, not
 * `key: value` text). See https://connectrpc.com/docs/protocol#streaming-rpcs
 */

const END_STREAM_FLAG = 0x02
const HEADER_LENGTH = 5

/** One decoded Connect envelope: a message (`endStream: false`) or the
 * end-of-stream marker (`endStream: true`, payload is the JSON status object). */
export interface ConnectEnvelope {
  endStream: boolean
  payload: Buffer
}

/** Encode one JSON message into a Connect DATA envelope (uncompressed). */
export function encodeConnectEnvelope(payload: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_LENGTH)
  header.writeUInt8(0, 0)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

/**
 * Decode every complete envelope out of a (possibly partial) Connect
 * streaming body — same incremental-remainder contract as
 * `grpcWebCodec.ts`'s `decodeGrpcWebFrames`, so a caller reading a chunked
 * response can feed each chunk in and keep accumulating `remainder`.
 */
export function decodeConnectEnvelopes(buffer: Buffer): { envelopes: ConnectEnvelope[]; remainder: Buffer } {
  const envelopes: ConnectEnvelope[] = []
  let offset = 0
  while (offset + HEADER_LENGTH <= buffer.length) {
    const flags = buffer.readUInt8(offset)
    const length = buffer.readUInt32BE(offset + 1)
    const envelopeEnd = offset + HEADER_LENGTH + length
    if (envelopeEnd > buffer.length) break
    envelopes.push({
      endStream: (flags & END_STREAM_FLAG) !== 0,
      payload: Buffer.from(buffer.subarray(offset + HEADER_LENGTH, envelopeEnd))
    })
    offset = envelopeEnd
  }
  return { envelopes, remainder: Buffer.from(buffer.subarray(offset)) }
}

/** The END-STREAM envelope's parsed JSON body: an `error` when the stream
 * failed, or nothing at all for a clean end-of-stream. */
export interface ConnectEndStream {
  error?: { code: string; message: string }
}

/**
 * Parse the END-STREAM envelope's JSON payload. An empty or malformed payload
 * is treated as a clean end-of-stream with no error, rather than throwing —
 * a status-less end is what a well-behaved server sends after the last
 * message of a successful call.
 */
export function parseConnectEndStream(payload: Buffer): ConnectEndStream {
  if (payload.length === 0) return {}
  try {
    const parsed = JSON.parse(payload.toString('utf8')) as ConnectEndStream
    return parsed.error ? { error: parsed.error } : {}
  } catch {
    return {}
  }
}
