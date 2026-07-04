import type { BaseRequest } from './BaseRequest'
import type { AmqpMode } from '../requestPrimitives'

/**
 * AMQP 0-9-1 (RabbitMQ) request definition. One request type covers all three
 * interaction modes — `publish` (exchange + routingKey + payload), `subscribe`
 * (queue, long-lived, streams received frames like a WebSocket/MQTT connect),
 * and `browse` (queue, peek-without-ack via a bounded `channel.get()` loop).
 * The tab view swaps its pane on `mode`; only `subscribe` binds a scenario
 * connect/publish/close triplet (browse has no scenario node — v1 is
 * tab-view/execution-only).
 */
export interface AmqpRequest extends BaseRequest {
  type: 'amqp'
  /** Broker URL (`amqp://` / `amqps://`). */
  url: string
  /** Virtual host (defaults to `/` when empty). */
  vhost?: string | undefined
  /** Which of the three interactions this request performs. */
  mode: AmqpMode
  /** PUBLISH: destination exchange (empty string = the default exchange). */
  exchange?: string | undefined
  /** PUBLISH: routing key. */
  routingKey?: string | undefined
  /** PUBLISH: message payload. */
  payload?: string | undefined
  /** SUBSCRIBE / BROWSE: source queue name. */
  queue?: string | undefined
  /** SUBSCRIBE: ack received messages automatically (default true). */
  autoAck?: boolean | undefined
  /** SUBSCRIBE: `channel.prefetch` — max unacked messages in flight. */
  prefetch?: number | undefined
  /** BROWSE: max messages to peek without acking (default 50). */
  browsePeekCount?: number | undefined
  /** Auth username (handlebars-resolved). */
  username?: string | undefined
  /** Auth password (handlebars-resolved; may resolve from a secret). */
  password?: string | undefined
}
