# Kafka

Restorm can produce records to an Apache Kafka topic, consume from a topic as
a long-lived consumer group, and browse recent messages without joining a
group — the three modes a `kafka` request supports.

## What Kafka is, in Restorm's terms

Kafka is fundamentally different from every other protocol Restorm speaks:
there is no single request → response shape, and no persistent per-request
connection. Instead, a `kafka` request's `mode` field picks one of three
independent lifecycles, each backed by its own short-lived `kafkajs` client:

- **Produce** — connect, send one record, disconnect. One-shot, like an HTTP
  request: it returns the broker's `RecordMetadata` (partition + offset)
  immediately.
- **Consume** — connect, subscribe as a consumer group, stay open. Long-lived,
  like an MQTT / WebSocket connection: every message the group receives
  streams into the response panel until you stop it.
- **Browse** — peek the last *N* messages from a partition / offset without
  joining a consumer group and without committing any offset. Read-only,
  side-effect-free.

## Using it

1. Create a `kafka` request (sidebar → **Add → Kafka**, or drag one onto a
   scenario canvas).
2. Fill in the **broker list** (`host:port,host:port` — comma-separated,
   Handlebars-resolved as a whole before being split) and an optional
   **client id**.
3. Pick a **mode** from the selector at the top of the tab — it swaps the
   pane below between Produce / Consume / Browse fields.
4. **Produce**: set topic, key (optional), value (JSON editor), headers, and
   an optional target partition (omit for the default partitioner). Click the
   send button to produce once.
5. **Consume**: set topic, a consumer group id, and where to start reading
   (`earliest` / `latest` / a `specific` offset — the last one needs the
   offset value too). Optionally restrict to specific partitions. Click the
   connect button to start; messages stream in live. Click again to stop —
   the consumer disconnects cleanly (in-flight messages are drained, not
   killed mid-message).
6. **Browse**: set topic, partition, starting offset, and how many messages
   to peek. Click the button to fetch a snapshot — no group, no commit.

Every field is Handlebars-aware and resolved through the standard
environment-variable pipeline, exactly like every other protocol.

### Authentication

The auth section (shared by all three modes) supports:

- **SASL** — `PLAIN`, `SCRAM-SHA-256`, `SCRAM-SHA-512`, or none. Username /
  password are resolved through the same env-variable pipeline as every other
  credential field in Restorm — never hardcode a secret in the request.
- **TLS** — a toggle that enables TLS on the `kafkajs` connection.

### Scenario graph

Because produce and consume have genuinely different lifecycles, they are
**two distinct scenario node kinds**, not one node with a mode switch:

- **Kafka produce** — a one-shot node (mirrors `httpRequest` / `soapRequest`):
  an `env` input, a `response` output carrying the produced record's
  partition + offset.
- **Kafka consume** — a long-lived node (mirrors `mqttConnect`): `connected`
  fires once subscribed, every consumed message re-emits on the single
  `message` output (Kafka has no named events, unlike MQTT topics). Stays
  open until a **Kafka close** node targets it (or the run stops).
- **Kafka close** — stops an already-open consumer declared by a Kafka
  consume node.

Browse has no scenario node — it is an interactive, one-off peek from the
request panel only.

## Docker mock

The test suite runs against a single-node **KRaft** broker (`apache/kafka:3.7.1`
— no ZooKeeper needed since Kafka 3.3), defined in
`restorm/tests/docker/docker-compose.yml` as the `kafka` service, published on
the same port restorm itself connects to: **`localhost:9092`**. A one-shot
`kafka-seed` job creates the `restorm-test` topic (1 partition) and produces 3
messages once the broker's healthcheck passes; see `kafka-seed.sh` to refresh
the fixture. The seed job runs with `network_mode: host` — the broker only
advertises `localhost:9092` (the address restorm-on-the-host needs), and a
compose-network alias would bounce a container-side client straight back to
that same address, a dead end from inside its own container.

## Gotchas

- **No persistent connection.** Unlike MQTT / WebSocket, a `kafkaConsume`
  scenario node (or the tab's consume button) opens a *fresh* consumer group
  subscribe every run — there is no "reconnect to an existing session".
- **`mode` only drives the tab's UI pane and the request's own send button.**
  A scenario's `kafkaProduce` / `kafkaConsume` nodes always run their fixed
  action regardless of what `mode` the underlying request is currently set
  to in its own tab.
- **Schema Registry (Avro / Protobuf decoding) is not supported yet** — an
  explicit v1 follow-up, out of scope here.
- **Kafka admin operations** (create/delete topic, ACLs) and **consumer lag
  dashboards** are likewise out of scope; Restorm is a client, not a cluster
  admin tool.
