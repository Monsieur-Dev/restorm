# gRPC-Web / Connect-RPC transports

A gRPC request in Restorm can dispatch over three wire transports. The
**Transport** selector sits next to the call-type picker on the gRPC request's
client tab (`data-testid="grpc-transport-select"`); switching it doesn't
change the service/method/message you've configured — only how the call
travels over the wire.

## Choosing a transport

| Transport | What it is | When to use it |
| --- | --- | --- |
| **gRPC** (default) | Native gRPC over HTTP/2, via `@grpc/grpc-js`. | The server exposes a plain gRPC endpoint — the common case, and the only transport that supports client-streaming and bidirectional-streaming. |
| **gRPC-Web** | The historical gRPC-Web wire protocol: the same protobuf messages, framed for plain HTTP/1.1. | The server (or a proxy like Envoy) exposes a gRPC-Web endpoint — typically because a browser client needs to reach it and can't speak native HTTP/2 trailers. |
| **Connect** | The [Connect-RPC](https://connectrpc.com/docs/protocol) protocol from Buf: JSON (or binary) over plain HTTP, with a REST-like error shape. | The server is built with a Connect-RPC framework (`connectrpc.com/connect-go`, `@connectrpc/connect-node`, …) and exposes its Connect endpoint alongside — or instead of — native gRPC. |

A request saved before this field existed has no `transport` value; it's
treated as `'grpc'` (native), so nothing changes for existing `.restorm`
files or exported collections.

## Streaming support per transport

| Call type | gRPC | gRPC-Web | Connect |
| --- | --- | --- | --- |
| Unary | ✅ | ✅ | ✅ |
| Server-streaming | ✅ | ✅ (chunked HTTP response) | ✅ (chunked HTTP response) |
| Client-streaming | ✅ | ❌ | ❌ |
| Bidirectional-streaming | ✅ | ❌ | ❌ |

Client- and bidirectional-streaming need a single long-lived duplex
connection, which plain HTTP/1.1 can't provide. When the transport is
`gRPC-Web` or `Connect` and the call type is client- or bidirectional-stream,
the **Connect** button on the request panel is disabled with a tooltip
explaining the limitation — switch back to the native `gRPC` transport for
those call types.

## Wire framing (for the curious / for writing an external client)

* **gRPC-Web** frames every message with a 5-byte header (1 flag byte + a
  big-endian `uint32` length) exactly like native gRPC's HTTP/2 framing, then
  sends it as the body of a plain HTTP POST (`Content-Type:
  application/grpc-web+proto`). Because HTTP/1.1 has no reliable native
  trailers, the final gRPC status travels as one more frame (the `TRAILERS`
  frame, flag bit `0x80` set) rather than as HTTP trailers. See
  `src/main/services/grpc/grpcWebCodec.ts`.
* **Connect** unary calls are the simplest of the three: a plain JSON POST
  body in, a plain JSON body back — no framing at all
  (`Content-Type: application/json`). A 2xx response body *is* the message;
  any other status carries a JSON `{ code, message, details }` error instead.
  Connect streaming calls (server-streaming here) use the same 5-byte-header
  envelope shape as gRPC-Web, but the end-of-stream status travels as one
  more JSON envelope (flag bit `0x02` set) instead of key/value trailer text.
  See `src/main/services/grpc/connectCodec.ts` /
  `src/main/services/grpc/connectTransport.ts`.

## Docker mock

The bundled `moul/grpcbin` mock (`docker-compose.yml`, mapped to `:9002`)
answers both native gRPC (`:9000`) and gRPC-Web (`:9002`) against the same
service definitions — pick gRPC-Web as the transport and point the request at
`localhost:9002` to exercise it locally.

There's no ready-made local Connect-RPC image (`connectrpc/eliza` is a public
demo, not a container), so `docker-compose.yml` also ships a hand-rolled
`connect-mock` service (`tests/docker/connect-server/server.js`, pure
`node:http`, no npm install) on `:8093`. It answers the same
`grpcbin.GRPCBin` service/method names as the bundled fallback proto — point
a Connect-transport request at `localhost:8093` to exercise it locally.

## Code snippets

The response panel's code-snippets tab includes a `grpcurl -grpc-web` example
and a `curl` example for Connect-RPC (`Content-Type: application/connect+json`)
alongside the existing native-gRPC snippets, regardless of which transport
the request currently uses.
