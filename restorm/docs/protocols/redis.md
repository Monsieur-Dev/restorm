# Redis

Restorm talks to Redis over the `ioredis` client library. A `redis` request
straddles two shapes on the same request type — the `mode` field is the
source of truth for which one runs:

* **Subscribe** (`mode: 'subscribe'`) — a long-lived pub/sub listener,
  mirroring the WebSocket/MQTT connect pattern. One or more channels; every
  received message streams into the response panel in real time.
* **Command** (`mode: 'command'`) — a single command → single reply, REPL-like.
  Never runs on the same client as a subscription: a client that has entered
  Redis's subscriber mode cannot issue regular commands, so each command run
  opens a fresh connection, executes, and disconnects.

## Connecting

* **URL** — `redis://`, `rediss://` (TLS), or `redis-cluster://`.
* **Password** — a single auth password (most Redis deployments gate on
  password alone, no username). Handlebars-resolved like every other field.

## Command mode

A small palette covers the most common operations: `GET`, `SET`, `DEL`,
`HGET`, `HSET`, `LPUSH`, `RPUSH`, `LRANGE`, `PUBLISH`, `XADD`, `XREAD`. Args
are a single Handlebars-aware line (quote a token that carries a space, e.g.
`foo "hello world"`). Anything the palette doesn't cover goes through the
**freeform** override — a raw command line (e.g. `EXPIRE foo 60`) that takes
precedence over the palette selection whenever it's non-empty.

Successive command runs append to a REPL-style history in the response panel
— input + raw reply (string / number / `(nil)` / a JSON-rendered array), like
a terminal session.

### `XREAD BLOCK` is capped

Command mode is one-shot (connect → execute → disconnect), not a persistent
stream. A blocking `XREAD BLOCK <ms>` (including `BLOCK 0`, "wait forever")
would otherwise pin the one-shot client indefinitely, so Restorm caps the
`BLOCK` value at 5 seconds (configurable via
`DEFAULT_REDIS_XREAD_BLOCK_CAP_MS` in `shared/config/constants.ts`) before the
command reaches the wire. If you need a true long poll on a stream, use
**subscribe mode** with `PUBLISH`/`SUBSCRIBE` instead — Redis Streams' own
blocking read isn't a good fit for a one-shot request.

## Subscribe mode

List the channels to listen on (one per line). Subscribing opens a dedicated
subscriber client that stays connected until you unsubscribe; every message
received on any of the channels appears in the response panel with its
channel + payload, in arrival order.

## Docker mock

The E2E suite runs against the official `redis:7-alpine` image
(`tests/docker/docker-compose.yml`, container `restorm-redis`), on the
default port 6379 — nothing else in the compose file uses that port, so no
remap is needed. No seed data: `GET`/`SET`/`PUBLISH`/`SUBSCRIBE`/`XADD`/`XREAD`
all work against a fresh instance out of the box. A healthcheck polls
`redis-cli ping`. Set `SKIP_REDIS_E2E=1` to skip the Redis scenarios on a
machine that can't run the container.

## Out of scope (v1)

* Redis Stack modules (RedisJSON, RedisSearch) — a possible follow-up.
* Cluster topology browsing (the `redis-cluster://` scheme connects, but
  Restorm doesn't visualise shards/nodes).
* Redis Streams beyond `XADD` / `XREAD` (consumer groups, `XACK`, etc.).
