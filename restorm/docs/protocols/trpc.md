# tRPC

[tRPC](https://trpc.io/) is a TypeScript-first RPC framework that layers on
plain HTTP: a procedure call is a GET (query) or POST (mutation) to
`<server>/<procedure>`, with the input/output shape enforced by the
server's TypeScript types rather than a schema language like GraphQL SDL or
an OpenAPI document. Restorm speaks the tRPC v10 non-batch wire format
natively — no more hand-crafting the `?input=` query string or the
`{"0":{"json":...}}` mutation envelope, and no need for tRPC's own devtools
just to poke a procedure.

## Creating a tRPC request

Add a **tRPC** request the same way as any other protocol (sidebar → *New* →
*tRPC*, or the New Request menu). Fill in:

* **URL** — the *base* server URL (e.g. `http://localhost:3000/trpc`). The
  procedure path is appended automatically at execution time — don't include
  it here.
* **Procedure** — the dot-separated procedure path as declared on the
  server's router, e.g. `user.get` or `post.create`.
* **Kind** — `query` (read, dispatched as `GET`) or `mutation` (write,
  dispatched as `POST`). tRPC subscriptions ride a WebSocket transport and
  are out of scope for this request type — model them as a raw WebSocket
  request instead.
* **Input** — the JSON object passed as the procedure's `input`. Leave it
  empty for a no-input procedure. Supports `{{handlebars}}` like every other
  field, resolved against the active environment before the call goes out.
* **Headers** — same `VariableInputBox`-backed key/value table as every
  other protocol.

## Wire format

Restorm composes the exact v10 non-batch shape a tRPC client sends:

| Kind | Method | URL | Body |
| --- | --- | --- | --- |
| `query` | `GET` | `<url>/<procedure>?input=<urlEncoded(input)>` | — |
| `mutation` | `POST` | `<url>/<procedure>` | `{"0":{"json":<input>}}` (or `{"0":{}}` for no input) |

The response envelope is an array even for a single non-batch call:
`[{ "result": { "data": <output> } }]` on success, or
`[{ "error": { "json": { "message", "code", ... } } }]` on a tRPC-level
error (a thrown `TRPCError` on the server). Restorm unwraps this
automatically — the response panel shows just `data` by default. Flip the
**Show raw envelope** toggle above the response body to see the full wire
payload (useful when debugging why a call returned an unexpected shape, or
when the server threw an error).

Execution is a thin shaping layer over the same `HTTPExecutionService` every
plain HTTP / OData / auth request goes through — headers, timeouts,
cancellation, and response-history all behave exactly like an HTTP request,
because under the hood it *is* one.

## Router introspection import

If the target server exposes a schema at `<base>/.trpc/_schema`, restorm's
importer (*File → Import*, paste that URL) reads the declared procedures and
creates one tRPC request per procedure, with a best-effort example `input`
synthesised from the declared input field types.

This is **best-effort by design** — unlike GraphQL's `__schema`
introspection query, tRPC has no standardised discovery endpoint. The
`/.trpc/_schema` path and its JSON shape (`{ "procedures": { "<name>": {
"kind", "input", "output" } } }`) are restorm's own convention, matched by
the docker mock below; a real tRPC server on Express / Fastify / Next.js
almost certainly won't expose it. When the endpoint doesn't exist (a 404, or
any response that doesn't match the expected shape), the import simply falls
through to "unsupported format" — author the requests manually instead.

## Docker mock

The E2E suite runs a hand-rolled `node:http` server (no `@trpc/server`
dependency — the goal is to exercise the wire format, not stand up a real
tRPC router) at `tests/docker/trpc-server/`, listening on **:8096**. It
implements:

* `user.get` (query) — returns `{ id, name }` for a known id, a `NOT_FOUND`
  tRPC error otherwise.
* `post.create` (mutation) — echoes back `{ id, title }` for the given
  title, with an auto-incrementing id.
* `echo.header` (query) — returns the actual HTTP header value the server
  received for the header named in `input.name`; proves a Handlebars-
  resolved header reaches the wire.
* `slow.echo` (mutation) — waits `input.delayMs` before echoing
  `input.message`; used to exercise cancellation of an in-flight call.
* `error.fail` — always returns a `BAD_REQUEST` tRPC error, for exercising
  the error path.
* `GET /.trpc/_schema` — the introspection document the importer consumes.

Refresh the fixture data by editing the seed arrays directly in
`server.js` — the container has no persistence, so a restart resets state.

## Known limitations (v1)

* **No batching.** tRPC's `httpBatchLink` client can coalesce several calls
  into one HTTP round-trip; restorm only speaks the non-batch shape (a
  single call per request).
* **No subscriptions.** tRPC subscriptions run over a WebSocket transport —
  out of scope for this request type; use a raw WebSocket request against
  the same server if you need to exercise one.
* **No generated TypeScript types.** The input editor is a plain JSON
  (Handlebars-aware) Monaco editor — restorm doesn't introspect or enforce
  the server's actual TypeScript input/output types.
