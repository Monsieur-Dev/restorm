# Server-Sent Events (SSE)

Restorm treats `text/event-stream` as a **dedicated request type** (`sse`),
not an HTTP mode flag — the scenario graph needs a distinct type
discriminator to bind `sseConnect` / `sseClose` nodes, and the response
panel renders an accumulated frame list rather than a single body.

## What it is

SSE is a one-directional, long-lived HTTP `GET` whose response body streams
`event:` / `data:` / `id:` / `retry:` text frames per the [W3C EventSource
spec](https://html.spec.whatwg.org/multipage/server-sent-events.html).
Common uses: LLM completion APIs (OpenAI, Anthropic), observability
dashboards, server-push notifications. Unlike WebSocket, there is no send
direction and no server mode — the connection is purely a client
subscribing to a stream.

## Using it in the request panel

An SSE request has a URL (`{{handlebars}}`-resolvable) and a header table —
no body, no message editor. The **Connect** button opens the streaming
`GET`; each parsed frame appears as a new row in the frames list
(timestamp, event type, a truncated data preview, click to expand the full
payload). **Disconnect** closes the stream cleanly.

Execution (`src/main/services/SseExecutionService.ts`) uses Node's raw
`http`/`https` client, **not** `fetch`, which buffers the whole response
body before resolving — incompatible with a stream that may never end.

## Reconnect

Per spec, a dropped connection reconnects automatically, seeding a
`Last-Event-ID` header from the last `id:` value actually received (falling
back to the request's own `lastEventId` field on the very first connect). A
server's `retry:` hint overrides the default 3s reconnect delay for the
next attempt. Reconnects are capped at 10 attempts
(`SSE_MAX_RECONNECT_ATTEMPTS`) — a server that never comes back does not
retry forever; the run then reports failure. A `204 No Content` response
stops reconnecting immediately (per spec).

Reconnecting resumes the **same logical session**: the `connected` signal
(UI badge, scenario `sseConnect` node's `connected` port) fires once, on
the first successful connect, not on every reconnect.

## Cancellation

Clicking Disconnect (or stopping a scenario run) closes the underlying
socket immediately — no partial frame is emitted, and the run resolves as
a clean, caller-initiated close regardless of whether the stream had ever
connected.

## Frame parsing

`SseFrameParser` (in `SseExecutionService.ts`) is a standalone, unit-tested
state machine independent of network chunk boundaries: multi-line `data:`
blocks (joined with `\n`), `:`-prefixed comment lines (ignored — including
heartbeats), a `retry:` hint (consumed once), a NUL byte in an `id:` value
(ignored per spec), and a `\r\n` line terminator split across two network
reads.

## Scenario graph

Two nodes, mirroring `websocketConnect` / `websocketClose` — SSE has no
send direction, so there is no `sseWrite` equivalent:

* **`sseConnect`** — opens the connection from a bound `sse` request.
  `connected` (signal, fires once) + `message` (re-emits every received
  frame) + the universal `done` (fires once the connection is closed, by
  budget exhaustion or an `sseClose`).
* **`sseClose`** — closes a connection opened by a named `sseConnect` node.

## Response history

Each run's accumulated frames are stored via `ResponseHistoryService`
(`sse` builder) and replayed from the history panel exactly as they
streamed in.

## Code snippets

The request panel's code-examples tab renders curl (`--no-buffer`, to
disable curl's own output buffering so frames print as they arrive),
browser `EventSource`, and Python (`requests`, streamed line-by-line) —
template at `src/main/resources/templates/code-snippets-sse.hbs`. The
native `EventSource` API has no header support, so the curl example is the
reference for custom headers / auth.

## Docker mock

`tests/docker/sse-server/` — a zero-dependency `node:http` server
(`restorm-sse-server`, port **8097**, healthcheck on `/health`). No fixture
seeding needed; both routes are fully deterministic:

* `GET /events?count=&intervalMs=` — streams `count` (default 5) labelled
  `event: ping` frames spaced `intervalMs` (default 50ms) apart, then holds
  the connection open on `:heartbeat` comments until the client
  disconnects — the base connect / assert / cancel scenario. An `X-Echo`
  request header, when present, is echoed back as a leading `event: echo`
  frame — proof that a Handlebars/env-var header value reached the wire.
* `GET /reconnect-test` — drops the connection after frames `id=1..2` on
  the first request (no `Last-Event-ID`), then resumes from `id=3` once the
  client reconnects with `Last-Event-ID: 2` — exercises the reconnect path
  deterministically.

## Testing

* Unit — `src/main/services/SseExecutionService.frameParser.test.ts`
  (multi-line `data:`, comments, retry hints, reconnect ids, empty `data:`
  lines, split `\r\n`), `tests/unit/services/CodeSnippetGenerator.test.ts`
  (SSE case).
* E2E — `tests/e2e/bdd/sse-execution/` against the mock above.
