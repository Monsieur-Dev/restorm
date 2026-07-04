# JSON-RPC 2.0

JSON-RPC 2.0 is the wire format behind most Ethereum/Solana/Cosmos/Bitcoin
node APIs, plus a fair number of internal service-to-service protocols. It's
a single JSON envelope — `{ "jsonrpc": "2.0", "method", "params", "id" }` —
POSTed over HTTP, so Restorm treats it as a thin request-shaping layer over
its existing HTTP transport rather than a brand-new protocol stack.

## Creating a request

Right-click a folder → *New Request → JSON-RPC*. The request tab exposes:

* **URL** — the JSON-RPC endpoint the envelope is POSTed to.
* **Method** — the RPC method name.
* **Params** — a JSON editor (Monaco, with Handlebars autocomplete) that
  accepts either a `[...]` array (**positional** params) or a `{...}` object
  (**named** params) — whichever the target API expects. Left empty, the
  envelope omits `params` entirely.
* **Id** — the JSON-RPC request id. Left empty, an id is auto-generated per
  call.
* **Notification mode** — a toggle. When on, the envelope carries no `id`
  and no response body is awaited (per the JSON-RPC 2.0 spec, a
  notification gets no reply); the response panel shows "Notification sent"
  instead of a body.
* **Headers** — extra headers merged into the POST (`Content-Type:
  application/json` is added automatically).

Every field — URL, method, params, id — resolves `{{handlebars}}` against
the active environment before the call is dispatched, same as every other
protocol.

## Response panel

A successful HTTP call unwraps the JSON-RPC envelope: a `result` renders as
formatted JSON; an `error` renders distinctly (`code`, `message`, and
`data` when present), styled as a failure even though the underlying HTTP
call succeeded — a JSON-RPC error is an application-level failure, not a
transport one. History navigation, JSONcrack, cancellation, and the request
history modal all work as they do for a plain HTTP request.

## Batch calls

*New Request → JSON-RPC Batch* creates a `jsonrpc-batch` request: a list of
child calls (each with its own method/params/id/notification toggle) that
compose into a single JSON array, POSTed in one HTTP call — the JSON-RPC
spec's batch form. The editor mirrors the OData `$batch` editor's UX for
adding/reordering/removing children.

The response panel matches each array entry in the reply back to its
originating child by `id` and renders one block per child (`result` or
`error`, or "no matching response entry" if the server dropped one).

## Scenarios

A `jsonrpc` or `jsonrpc-batch` request binds to a scenario's regular
**HTTP Request** node — there's no dedicated JSON-RPC scenario node kind,
since running one is a unary call/response like any other bound request.

## Importing an OpenRPC document

[OpenRPC](https://spec.open-rpc.org/) is the OpenAPI-equivalent
specification format for JSON-RPC APIs. *File → Import* and point Restorm
at an `openrpc.json` document (file, paste, or URL) to generate a `Methods`
folder with one `jsonrpc` request per declared method. The importer:

* Reads the base URL from the document's first `servers[].url` entry.
* Builds a starter `params` sample from each method's `paramStructure`
  (`by-position` → a `[...]` array, `by-name` → a `{...}` object) and its
  parameters' JSON Schema, resolving one level of `$ref` against
  `components.schemas`.
* Carries the method's `deprecated` flag onto the generated request.

The importer targets primitive types + a single `$ref` hop — a deeply
nested or self-referential schema falls back to `null` in the params
sample rather than looping; the generated request is a runnable starting
point you edit from, not a byte-perfect schema instantiation.

## Code snippets

The request's code-snippets panel renders cURL and JavaScript (`fetch`)
examples for both a single call and a batch — the batch's JS snippet
iterates the response array instead of unwrapping a single envelope.

## Gotchas

* **Positional vs. named params** is a per-request choice, not a toggle —
  just write a `[...]` or a `{...}` in the Params editor; Restorm parses
  whichever shape you give it at execution time.
* **Notification mode** silently drops the response body — if a call
  "succeeds" but the response panel shows nothing, check whether
  Notification mode is on when you expected a reply.
* A JSON-RPC **`error` response is still an HTTP 200** in most
  implementations — don't rely on the HTTP status code alone to detect a
  failed call; check the response panel's error block.
