/** Default HTTP/GraphQL/SOAP request timeout in milliseconds */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Default WebSocket connection timeout in milliseconds */
export const DEFAULT_WS_TIMEOUT_MS = 5_000

/** Default AMQP broker connection timeout in milliseconds */
export const DEFAULT_AMQP_TIMEOUT_MS = 5_000

/** Default `browsePeekCount` when an AmqpRequest in `browse` mode leaves it
 * unset — bounds the `channel.get()` peek loop so a large queue can't block
 * the channel indefinitely. */
export const DEFAULT_AMQP_BROWSE_PEEK_COUNT = 50

/** Lifetime cap on amqplib's built-in connection-recovery attempts for a
 * streaming (subscribe) AMQP connection, mirroring {@link makeReconnectBudget}
 * for MQTT — a broker that never comes back must eventually settle with an
 * error instead of retrying forever. */
export const AMQP_MAX_RECONNECT_ATTEMPTS = 10

/** Default Redis connection timeout in milliseconds */
export const DEFAULT_REDIS_TIMEOUT_MS = 5_000

/** Hard cap on a blocking Redis command (`XREAD BLOCK <ms>`) so a `BLOCK 0`
 * (wait forever) or an over-long block can't pin a command-mode client
 * indefinitely — the client is one-shot (connect → execute → disconnect), not
 * a long-lived stream, so an unbounded block would silently hang the run. */
export const DEFAULT_REDIS_XREAD_BLOCK_CAP_MS = 5_000

/** Default UI debounce/delay in milliseconds */
export const DEFAULT_UI_DELAY_MS = 3_000

/**
 * Hard cap on the number of response bytes any single protocol
 * executor (HTTP / GraphQL / SOAP / auth prefetch) or the scenario
 * sandbox network bridge will buffer in the main process before it
 * destroys the socket and rejects. Without this a hostile / runaway
 * endpoint streaming an unbounded body OOMs the main process. 64 MiB
 * is generous for any realistic API response while still bounding the
 * blast radius.
 */
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024
