import type { BaseRequest } from './BaseRequest'
import type { KeyValue } from '../baseTypes'

/** Which lifecycle the request runs when executed. Unlike every other
 * protocol in Restorm, Kafka has NO single request→response shape: producing
 * and consuming are independent `kafkajs` client objects with different
 * lifecycles, and browsing peeks without ever joining a consumer group. The
 * tab view shows one pane per mode; the scenario nodes (`kafkaProduce` /
 * `kafkaConsume`) call the matching execution-service method directly,
 * regardless of this field — `mode` only drives which pane the tab shows for
 * an interactive Run. */
export type KafkaMode = 'produce' | 'consume' | 'browse'

/** Where a consume/browse read starts. `specific` requires `specificOffset`. */
export type KafkaFromOffset = 'earliest' | 'latest' | 'specific'

/** SASL mechanism for broker auth. `none` skips SASL entirely (still allows
 * `tlsEnabled` for a TLS-only broker). */
export type KafkaSaslMechanism = 'none' | 'plain' | 'scram-sha-256' | 'scram-sha-512'

export interface KafkaRequest extends BaseRequest {
  type: 'kafka'
  /** Comma-separated `host:port` broker list (handlebars-resolved as a whole,
   * then split — mirrors every other protocol's single `url` field so it
   * reuses the shared URL-resolution + code-snippet pipeline). */
  url: string
  /** Client id reported to the brokers (handlebars-resolved). */
  clientId: string
  mode: KafkaMode

  // ---- Produce (mode === 'produce') ------------------------------------
  /** Topic name. Shared with consume/browse — a Kafka request targets ONE
   * topic regardless of mode. */
  topic: string
  key?: string | undefined
  value: string
  /** Kafka record headers (name/value pairs sent with the produced record). */
  headers: KeyValue[]
  /** Target partition. Produce: omit to let kafkajs' partitioner pick one.
   * Browse: the partition to peek (required). */
  partition?: number | undefined

  // ---- Consume (mode === 'consume') -------------------------------------
  groupId?: string | undefined
  /** Shared with browse: where the read starts. */
  fromOffset: KafkaFromOffset
  /** Shared with browse: required when `fromOffset === 'specific'`. A string
   * (not a number) — Kafka offsets are 64-bit and kafkajs' own API takes them
   * as strings. */
  specificOffset?: string | undefined
  /** Client-side partition filter: when non-empty, only messages from these
   * partitions are surfaced (the consumer still subscribes to the whole
   * topic — kafkajs consumer-group assignment is not user-picked). Empty/
   * absent means every assigned partition. */
  partitions?: number[] | undefined

  // ---- Browse (mode === 'browse') ---------------------------------------
  /** Number of messages to peek before disconnecting. */
  browsePeekCount?: number | undefined

  // ---- Auth (all modes; via env vars) ------------------------------------
  saslMechanism: KafkaSaslMechanism
  saslUsername?: string | undefined
  saslPassword?: string | undefined
  tlsEnabled?: boolean | undefined
}
