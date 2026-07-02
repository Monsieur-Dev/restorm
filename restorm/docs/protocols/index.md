# Protocols — index

Restorm executes each request type through a dedicated `*ExecutionService` in
`src/main/services/`, with a matching `<Protocol>RequestTabView` in the
renderer. Several protocols compose on top of `HTTPExecutionService` rather
than owning their own transport (JSON-RPC is HTTP POST + a JSON envelope;
OData is HTTP + query-option/`$batch` serialization) — see
[`../contributing/adding-a-protocol.md`](../contributing/adding-a-protocol.md)
for the full playbook new protocols follow. Protocol *variants* that layer on
top of an existing request type instead of adding a new one (e.g. an
alternate wire transport) get their own doc too — see
[`grpc-web.md`](./grpc-web.md) for an example. Not every shipped protocol has
a page yet — this index only lists the ones that do.

| Protocol | Doc |
| --- | --- |
| JSON-RPC 2.0 (single call + batch) | [`jsonrpc.md`](./jsonrpc.md) |
| gRPC-Web / Connect-RPC transports | [`grpc-web.md`](./grpc-web.md) |
| tRPC (typed RPC over HTTP) | [`trpc.md`](./trpc.md) |
| Server-Sent Events (SSE) | [`sse.md`](./sse.md) |
| AMQP 0-9-1 (RabbitMQ) | [`amqp.md`](./amqp.md) |
| Redis (pub/sub + common commands) | [`redis.md`](./redis.md) |

For the underlying import-adapter pipeline that turns an external API
specification (OpenAPI, WSDL, `.proto`, OpenRPC, …) into a ready-to-run
Restorm collection, see [`../imports/index.md`](../imports/index.md).
# Execution protocols

User-facing documentation for each request/execution protocol Restorm
supports. This directory is new as of the STOMP ticket — earlier protocols
(HTTP, GraphQL, gRPC, SOAP, WebSocket, Socket.IO, MQTT, OData) don't have a
doc here yet; add one under the same convention (`<protocol>.md`) when you
touch one of them next, per
[`docs/contributing/adding-a-protocol.md`](../contributing/adding-a-protocol.md).

- [STOMP](./stomp.md) — Simple Text Oriented Messaging Protocol over
  WebSocket (ActiveMQ, Spring brokers).
