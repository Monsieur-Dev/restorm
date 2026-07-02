# Protocol docs

User-facing docs for individual execution protocols, one file per protocol
(or per protocol *variant*, when it layers on top of an existing one instead
of adding a new request type — see [`grpc-web.md`](./grpc-web.md)).

- [gRPC-Web / Connect-RPC transports](./grpc-web.md) — the `grpc` / `grpc-web`
  / `connect` transport toggle on gRPC requests: when to use each, their
  streaming limitations, and the wire framing each one speaks.
