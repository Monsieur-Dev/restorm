/**
 * KafkaRequest - Apache Kafka request definition (produce / consume / browse)
 */

import {
  searchable,
  fileNaming,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { pickImportMarkers, type ImportMarkerFields } from './importMarkers'
import { KeyValue } from '../KeyValue'
import type { RequestType, RuntimeId, Icon } from '../types'
import type { KafkaMode, KafkaFromOffset, KafkaSaslMechanism } from '../../types/requests/KafkaRequest'
import type { QuickConfig } from '../../types/requests/QuickConfig'

/**
 * Kafka request definition. Unlike every other protocol, Kafka has no single
 * request→response shape: `mode` selects which pane the tab shows (produce /
 * consume / browse), and each mode maps to an independent `kafkajs` client
 * lifecycle in `KafkaExecutionService`.
 */
@fileNaming({ pattern: '{index} - Kafka - {name}', nameProperty: 'name', idProperty: 'id' })
export class KafkaRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'kafka'

  /** Comma-separated `host:port` broker list (handlebars-resolved as a whole,
   * then split — reuses the shared URL-resolution + code-snippet pipeline). */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Client id reported to the brokers (handlebars-resolved). */
  @graphqlField({ type: 'String' })
  clientId = ''

  /** Which pane / lifecycle this request runs. */
  @graphqlField({ type: 'String' })
  @searchable.property({ filterable: true })
  mode: KafkaMode = 'produce'

  // ---- Produce ------------------------------------------------------------

  /** Topic name — shared across produce/consume/browse. */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  topic = ''

  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  key?: string

  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  value = ''

  /** Kafka record headers (produce). */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  /** Target partition. Produce: omit for the default partitioner. Browse: the
   * partition to peek. */
  @graphqlField({ type: 'Int', nullable: true })
  @TreatEmptyAsUndefined()
  partition?: number

  // ---- Consume --------------------------------------------------------------

  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  groupId?: string

  /** Shared with browse: where the read starts. */
  @graphqlField({ type: 'String' })
  fromOffset: KafkaFromOffset = 'latest'

  /** Shared with browse: required when `fromOffset === 'specific'`. */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  specificOffset?: string

  /** Client-side partition filter for consume (empty = every assigned partition). */
  @graphqlField({ type: 'Int', isArray: true, nullable: true })
  partitions?: number[]

  // ---- Browse ---------------------------------------------------------------

  @graphqlField({ type: 'Int', nullable: true })
  @TreatEmptyAsUndefined()
  browsePeekCount?: number

  // ---- Auth (via env vars) ---------------------------------------------------

  @graphqlField({ type: 'String' })
  saslMechanism: KafkaSaslMechanism = 'none'

  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  saslUsername?: string

  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  saslPassword?: string

  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  tlsEnabled?: boolean

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<KafkaRequest>) {
    super(init)
    if (init) {
      Object.assign(this, init)
      if (init.headers) {
        this.headers = init.headers.map(h =>
          h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
        )
      }
    }
  }

  /**
   * Create a KafkaRequest from a plain object
   */
  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    icon?: Icon
    documentation?: string
    notes?: string
    tags?: string[]
    authenticationRequestId?: RuntimeId
    url?: string
    clientId?: string
    mode?: KafkaMode
    topic?: string
    key?: string
    value?: string
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    partition?: number
    groupId?: string
    fromOffset?: KafkaFromOffset
    specificOffset?: string
    partitions?: number[]
    browsePeekCount?: number
    saslMechanism?: KafkaSaslMechanism
    saslUsername?: string
    saslPassword?: string
    tlsEnabled?: boolean
    quickConfigs?: QuickConfig[]
  } & ImportMarkerFields): KafkaRequest {
    return new KafkaRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      ...pickImportMarkers(obj),
      url: obj.url ?? '',
      clientId: obj.clientId ?? '',
      mode: obj.mode ?? 'produce',
      topic: obj.topic ?? '',
      ...(obj.key !== undefined && { key: obj.key }),
      value: obj.value ?? '',
      headers: (obj.headers ?? []) as KeyValue[],
      ...(obj.partition !== undefined && { partition: obj.partition }),
      ...(obj.groupId !== undefined && { groupId: obj.groupId }),
      fromOffset: obj.fromOffset ?? 'latest',
      ...(obj.specificOffset !== undefined && { specificOffset: obj.specificOffset }),
      ...(obj.partitions !== undefined && { partitions: obj.partitions }),
      ...(obj.browsePeekCount !== undefined && { browsePeekCount: obj.browsePeekCount }),
      saslMechanism: obj.saslMechanism ?? 'none',
      ...(obj.saslUsername !== undefined && { saslUsername: obj.saslUsername }),
      ...(obj.saslPassword !== undefined && { saslPassword: obj.saslPassword }),
      ...(obj.tlsEnabled !== undefined && { tlsEnabled: obj.tlsEnabled }),
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

  /**
   * Create a plain object from this KafkaRequest
   */
  toPlainObject(): Record<string, unknown> {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      icon: this.icon,
      documentation: this.documentation,
      notes: this.notes,
      tags: this.tags,
      ...(this.authenticationRequestId !== undefined && { authenticationRequestId: this.authenticationRequestId }),
      ...pickImportMarkers(this),
      url: this.url,
      clientId: this.clientId,
      mode: this.mode,
      topic: this.topic,
      key: this.key,
      value: this.value,
      headers: this.headers.map(h => h.toPlainObject()),
      ...(this.partition !== undefined && { partition: this.partition }),
      ...(this.groupId !== undefined && { groupId: this.groupId }),
      fromOffset: this.fromOffset,
      ...(this.specificOffset !== undefined && { specificOffset: this.specificOffset }),
      ...(this.partitions !== undefined && { partitions: this.partitions }),
      ...(this.browsePeekCount !== undefined && { browsePeekCount: this.browsePeekCount }),
      saslMechanism: this.saslMechanism,
      ...(this.saslUsername !== undefined && { saslUsername: this.saslUsername }),
      ...(this.saslPassword !== undefined && { saslPassword: this.saslPassword }),
      ...(this.tlsEnabled !== undefined && { tlsEnabled: this.tlsEnabled }),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
