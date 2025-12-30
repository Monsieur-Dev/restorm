/**
 * GrpcRequest - gRPC request definition
 */

import {
  searchable,
  fileNaming
} from 'electron-core-ui/main'
import { BaseRequest } from './BaseRequest'
import { KeyValue } from '../KeyValue'
import type { GrpcCallType, RequestType, RuntimeId, Icon } from '../types'

/**
 * gRPC request definition with service, method, and message.
 */
@fileNaming({ pattern: '{index} - GRPC - {name}', nameProperty: 'name' })
export class GrpcRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'grpc'

  /** gRPC server URL (host:port) */
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Service name (e.g., "grpcbin.HelloService") */
  @searchable.property({ weight: 1 })
  service = ''

  /** Method name (e.g., "SayHello") */
  @searchable.property({ weight: 1 })
  method = ''

  /** gRPC call type */
  @searchable.property({ filterable: true })
  callType: GrpcCallType = 'unary'

  /** Request message as JSON string */
  requestMessage = ''

  /** Metadata (headers) */
  metadata: KeyValue[] = []

  constructor(init?: Partial<GrpcRequest>) {
    super(init)
    if (init) {
      Object.assign(this, init)
      if (init.metadata) {
        this.metadata = init.metadata.map(m =>
          m instanceof KeyValue ? m : KeyValue.fromPlain(m as unknown as Parameters<typeof KeyValue.fromPlain>[0])
        )
      }
    }
  }

  /**
   * Create a GrpcRequest from a plain object
   */
  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    icon?: Icon
    documentation?: string
    notes?: string
    tags?: string[]
    url?: string
    service?: string
    method?: string
    callType?: GrpcCallType
    requestMessage?: string
    metadata?: Parameters<typeof KeyValue.fromPlain>[0][]
  }): GrpcRequest {
    return new GrpcRequest({
      id: obj.id,
      name: obj.name ?? '',
      icon: obj.icon,
      documentation: obj.documentation ?? '',
      notes: obj.notes,
      tags: obj.tags ?? [],
      url: obj.url ?? '',
      service: obj.service ?? '',
      method: obj.method ?? '',
      callType: obj.callType ?? 'unary',
      requestMessage: obj.requestMessage ?? '',
      metadata: obj.metadata as KeyValue[] | undefined
    })
  }

  /**
   * Create a plain object from this GrpcRequest
   */
  toPlainObject(): Record<string, unknown> {
    return {
      type: this.type,
      name: this.name,
      icon: this.icon,
      documentation: this.documentation,
      notes: this.notes,
      tags: this.tags,
      url: this.url,
      service: this.service,
      method: this.method,
      callType: this.callType,
      requestMessage: this.requestMessage,
      metadata: this.metadata.map(m => m.toPlainObject())
    }
  }
}
