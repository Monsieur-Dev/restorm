/**
 * gRPC-Web mock server for the restorm gRPC-execution E2E suite's gRPC-Web
 * transport scenario.
 *
 * `moul/grpcbin` (the `grpc` service in this compose file) does NOT answer
 * gRPC-Web on any port — its second port is a TLS-secured *native* gRPC
 * endpoint (confirmed against the upstream image: plain HTTP/1.1 there gets
 * "Client sent an HTTP request to an HTTPS server"), not an HTTP/1.1
 * gRPC-Web endpoint. There's no ready-made local gRPC-Web image to reuse
 * (gRPC-Web normally needs an Envoy/grpc-web-proxy sidecar translating to a
 * real gRPC backend) — this is a tiny zero-dependency Node server instead,
 * mirroring the `connect-server` precedent.
 *
 * It answers the same `grpcbin.GRPCBin/DummyUnary` RPC the bundled fallback
 * proto declares (`GRPCBIN_PROTO` in `grpcProtoLoader.ts`), hand-encoding/
 * decoding just the one field the E2E scenario exercises
 * (`DummyMessage.f_string`, protobuf field 1, a length-delimited string) —
 * there's no protobuf library here, and the message shape used by the test
 * is trivial enough not to need one.
 *
 * Routes:
 *   POST /grpcbin.GRPCBin/DummyUnary — gRPC-Web unary protocol
 *     (`Content-Type: application/grpc-web+proto`, framed body — see
 *     `grpcWebCodec.ts` for the exact framing this mirrors): decodes the
 *     request's `f_string`, echoes it back in a DATA frame followed by an
 *     OK TRAILERS frame.
 *
 *   GET /health — 200 "ok" (readiness probe).
 */

const http = require('http')

const PORT = process.env.PORT ? Number(process.env.PORT) : 9002

/** Read the full request body into a Buffer. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(Buffer.alloc(0)))
  })
}

/** Encode one gRPC-Web frame: 1-byte flags + 4-byte BE length + payload.
 * `flags = 0x80` marks the TRAILERS frame; `0` marks a DATA frame. Mirrors
 * `encodeGrpcWebFrame` / the TRAILERS half of `grpcWebCodec.ts`. */
function encodeFrame(flags, payload) {
  const header = Buffer.alloc(5)
  header.writeUInt8(flags, 0)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

/** Encode a protobuf varint (only ever needs one byte for the short test
 * strings this mock handles, but written generically). */
function encodeVarint(value) {
  const bytes = []
  let v = value
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v !== 0) b |= 0x80
    bytes.push(b)
  } while (v !== 0)
  return Buffer.from(bytes)
}

/** Encode a `DummyMessage` carrying only `f_string` (field 1, wire type 2 —
 * length-delimited): tag byte `0x0A` + varint length + UTF-8 bytes. */
function encodeDummyMessage(fString) {
  const strBytes = Buffer.from(fString, 'utf-8')
  return Buffer.concat([Buffer.from([0x0a]), encodeVarint(strBytes.length), strBytes])
}

/** Decode a `DummyMessage`'s `f_string` (field 1, wire type 2) out of its
 * protobuf bytes. Only handles the single-field shape the E2E request sends
 * — good enough for this mock's scope, not a general protobuf decoder. */
function decodeDummyMessageFString(buffer) {
  let offset = 0
  while (offset < buffer.length) {
    const tag = buffer.readUInt8(offset)
    offset += 1
    const fieldNumber = tag >>> 3
    const wireType = tag & 0x07
    if (wireType !== 2) break // only length-delimited fields are handled
    let length = 0
    let shift = 0
    let byte
    do {
      byte = buffer.readUInt8(offset)
      offset += 1
      length |= (byte & 0x7f) << shift
      shift += 7
    } while ((byte & 0x80) !== 0)
    const value = buffer.subarray(offset, offset + length)
    offset += length
    if (fieldNumber === 1) return value.toString('utf-8')
  }
  return ''
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  // GET /health — readiness probe.
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
    return
  }

  const body = await readBody(req)

  // POST /grpcbin.GRPCBin/DummyUnary — one gRPC-Web DATA frame in, one DATA
  // frame + one OK TRAILERS frame out.
  if (path === '/grpcbin.GRPCBin/DummyUnary') {
    // The request is itself one framed DATA message — skip the 5-byte
    // header and decode the protobuf payload after it.
    const fString = decodeDummyMessageFString(body.subarray(5))
    const responseFrame = encodeFrame(0, encodeDummyMessage(fString))
    const trailerFrame = encodeFrame(0x80, Buffer.from('grpc-status: 0\r\ngrpc-message: \r\n'))
    res.writeHead(200, { 'Content-Type': 'application/grpc-web+proto' })
    res.end(Buffer.concat([responseFrame, trailerFrame]))
    return
  }

  // Unknown route — a bare TRAILERS frame carrying a NOT_FOUND status,
  // shaped the way a real gRPC-Web server would answer an unknown method.
  res.writeHead(200, { 'Content-Type': 'application/grpc-web+proto' })
  res.end(encodeFrame(0x80, Buffer.from(`grpc-status: 12\r\ngrpc-message: unknown method: ${path}\r\n`)))
})

server.listen(PORT, () => {
  console.log(`grpcweb-server mock listening on :${PORT}`)
})
