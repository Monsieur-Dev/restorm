# STOMP (Simple Text Oriented Messaging Protocol)

STOMP runs over WebSocket and is popular in Spring / Java backends and with
brokers like ActiveMQ and RabbitMQ. Restorm supports it as a standalone
request type (`stomp`) — you no longer need to hand-craft raw WebSocket
frames in the raw WebSocket tab to talk to a STOMP broker.

## What it is

STOMP (1.1 / 1.2 — 1.0 is out of scope) is a simple, text-based framing
protocol layered on top of a bidirectional transport (here, a WebSocket).
A client:

1. Opens the WebSocket, then sends a `CONNECT` frame. The broker answers
   with `CONNECTED` (or `ERROR` if the handshake is rejected).
2. Issues `SUBSCRIBE` frames for the destinations it wants to receive
   `MESSAGE` frames from.
3. Sends `SEND` frames to publish to a destination.
4. Optionally `ACK`/`NACK`s received messages, depending on the
   subscription's acknowledgement mode.
5. Ends the session with `DISCONNECT`.

## Using it in Restorm

Create a **STOMP request** (sidebar → Add → STOMP request, or drop a STOMP
node in a scenario). The request tab has three sections:

- **Connect** — the broker URL (`ws://` / `wss://`), the negotiated STOMP
  version (1.1 / 1.2), and the CONNECT frame's headers (a key/value table —
  typically `host`, `login`, `passcode`, `heart-beat`). Every value supports
  `{{handlebars}}` and environment variables, so credentials can come from a
  secret-backed environment variable instead of being typed in plain text.
- **Subscriptions** — the list of destinations SUBSCRIBEd right after
  CONNECTED. Each row has a subscription id, a destination, and an
  acknowledgement mode:
  - `auto` — the broker considers the message acknowledged on delivery.
  - `client` — a single ACK/NACK cumulatively acknowledges every earlier
    unacknowledged message on the subscription.
  - `client-individual` — each message needs its own ACK/NACK.
- **Send** — the destination, body, and custom headers for the `SEND`
  button.

Click **Connect** to open the connection (handshake + every configured
SUBSCRIBE); the response panel streams every frame the broker sends as it
arrives, tagging `MESSAGE`/`ERROR` frames with their subscription and
destination. For `client` / `client-individual` subscriptions, an ACK/NACK
button appears on each received message. **Send** publishes the configured
message; **Disconnect** sends `DISCONNECT` and closes the socket.

Heart-beats are negotiated automatically: Restorm proposes `10000,10000` on
CONNECT (its own send guarantee, and what it wants to receive), and once
CONNECTED reports the broker's `heart-beat:<sx>,<sy>` header, it arms a
keep-alive timer at `max(10000, sy)` — `sy` being what the broker asked to
*receive*, not `sx` (the broker's own send guarantee, which says nothing
about our side) — so an idle connection isn't dropped by the broker.

### Scenarios

Three scenario node kinds mirror the raw-WebSocket triplet:

- **STOMP connect** — binds a STOMP request, performs the handshake +
  SUBSCRIBEs, and re-emits every received frame on its `message` port
  (`connected` fires once CONNECTED settles).
- **STOMP send** — sends a `SEND` frame (to the bound request's own
  configured destination) on an already-open connection.
- **STOMP close** — sends `DISCONNECT` and closes an already-open
  connection.

## Docker mock

The E2E / integration suites run against `rmohr/activemq:5.15.9`
(container `restorm-activemq`, host port `61614`) — a classic ActiveMQ 5.x
broker that ships a STOMP-over-WebSocket transport connector on `:61614`
out of the box, with no extra `activemq.xml` configuration needed.
`apache/activemq-artemis` was considered first (per the original ticket
scope) but its default configuration only exposes plain STOMP (`:61613`,
not STOMP-over-WebSocket) and its first-boot time is noticeably slower in
CI, so the classic broker was picked instead — see
`tests/docker/docker-compose.yml` for the compose entry.

## Gotchas

- **`wss://` self-signed certs**: Electron's `ws` package only accepts a
  self-signed certificate against `wss://` when told to. Restorm passes
  `rejectUnauthorized: false` for any `wss://` STOMP connection — acceptable
  for a local/dev/test broker, not a hardening concern for a client tool.
- **STOMP 1.0 is not supported.** Only 1.1 and 1.2.
- **Client-side transactions are out of scope** — `BEGIN` / `COMMIT` /
  `ABORT` frames are not exposed by the UI.
- A subscription's ack mode only matters for **received** `MESSAGE`
  frames — `auto` subscriptions never show an ACK/NACK button.
