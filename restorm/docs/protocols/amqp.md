# AMQP (RabbitMQ)

AMQP 0-9-1 is RabbitMQ's native wire protocol — the enterprise event-driven
cousin of MQTT. One request type (`amqp`) covers all three interactions a
user needs against a broker: **publish**, **subscribe**, and **browse**
(peek a queue without consuming it). A mode selector on the request's tab
view swaps the visible pane; the fields for the other two modes stay
populated but unused, so switching back and forth never loses what was
typed.

## How to use it in Restorm

Create an AMQP request (sidebar **Add → AMQP request**, or the scenario
graph's own **Add** submenu). Every field is Handlebars-aware
(`{{var}}`) and resolves through `ContextService.transformValue` before
hitting the wire, exactly like every other protocol.

* **Connection** — Broker URL (`amqp://` / `amqps://`), virtual host
  (defaults to `/` when left empty), username / password.
* **Publish mode** — Exchange (empty string = the default exchange),
  routing key, and a JSON payload (Monaco editor). Click **Send**.
* **Subscribe mode** — Queue name, auto-ack toggle (default on), prefetch
  (max unacked messages in flight). Click **Connect** to open a long-lived
  consumer; every delivered message streams into the response panel in
  real time. While connected, **Send** publishes the request's own
  exchange/routing-key payload on the SAME connection (e.g. a
  request/reply pattern). **Disconnect** closes it.
* **Browse mode** — Queue name + peek count (default 50). Click **Browse**
  to peek up to that many messages via a bounded `channel.get()` loop; each
  peeked message is `nack`ed back onto the queue in one batch at the end, so
  the queue is left unchanged. Peeked frames carry a `peek` indicator in the
  response panel, distinguishing them from a genuinely consumed message.

## Supported features

* Publish / subscribe / browse against any AMQP 0-9-1 broker (RabbitMQ is
  the reference target; anything else speaking 0-9-1 should work).
* Channel-level protocol errors (e.g. consuming a queue that doesn't exist)
  recover in place — the service recreates the channel and resumes
  consuming, bounded by a reconnect budget. A connection-level drop (broker
  restart, network blip) is terminal for that run; re-open via the
  scenario's `retry` node if automatic recovery is needed.
* Scenario-graph integration: an `amqpConnect` node (bound to a `subscribe`
  request) opens the connection and re-emits every delivered message on its
  `message` port; `amqpPublish` sends on an already-open connection;
  `amqpClose` closes it. Dropping an AMQP request in `subscribe` mode onto
  the canvas creates a bound `amqpConnect`; `publish` / `browse` mode drops
  a one-shot request node instead (browse has no dedicated scenario node —
  it is tab-view/execution-only).
* Response history, code-snippet generation (Node.js / Python / shell per
  mode), and the request/scenario reverse-navigation button all work like
  every other protocol.

## Gotchas

* **AMQP is not server-capable (v1)** — Restorm never hosts a broker.
  There is no "AMQP server" request kind, no `-server` variant in the Add
  menu, and no listening beam on the sidebar/tab badge beyond an open
  `subscribe` connection.
* **Subscribe's Send button** publishes to the exchange/routing-key fields
  configured on the SAME request, not an independently addressable target
  — switch to publish mode (or duplicate the request) if the reply needs a
  different destination.
* A `browse` peek loop is bounded by `browsePeekCount` (default 50) so a
  very large queue can't block the channel indefinitely; raise it
  deliberately if a bigger sample is needed.

## Docker mock

The integration test suite runs against `rabbitmq:3-management` (container
`restorm-rabbitmq`) in `tests/docker/docker-compose.yml` — the management
image so the HTTP management UI (default port `15672`) is available for
manual inspection alongside the AMQP port itself (default `5672`). No seed
script: tests declare their own exchanges/queues via `amqplib` at setup
time. If the image goes EOL, any RabbitMQ 3.x (or later) image with the
management plugin is a drop-in replacement.

## Where the code lives

* Model: `src/shared/models/requests/AmqpRequest.ts` (decorated class) +
  `src/shared/types/requests/AmqpRequest.ts` (plain interface).
* Execution: `src/main/services/AMQPExecutionService.ts` — publish/browse
  are one-shot (`execute`); subscribe is long-lived (`connectStreaming`),
  used by both the tab view's Connect action and the `amqpConnect` scenario
  node.
* Tab view: `src/renderer/src/components/RequestTabViews/AmqpRequestTabView.tsx`.
* Scenario nodes: `src/renderer/src/components/Scenario/nodes/AmqpNodeBoxes.tsx`,
  registered in `src/shared/scenarioKindRegistry.ts` (`amqpConnect` /
  `amqpPublish` / `amqpClose`) and
  `src/main/scenarioEngine/executors/socketioExecutors.ts`.
* Code snippets: `src/main/resources/templates/code-snippets-amqp.hbs`.
* Registries: `src/shared/protocolRegistry.ts`,
  `src/shared/models/requests/requestFactory.ts`,
  `src/main/protocol/executorRegistry.ts` (the three-registry socle every
  protocol appends to — see
  [`../contributing/adding-a-protocol.md`](../contributing/adding-a-protocol.md)).
