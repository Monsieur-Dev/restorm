/**
 * GrpcRequest - gRPC request definition
 */

import {
  searchable,
  fileNaming,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { KeyValue } from '../KeyValue'
import type { RequestType, RuntimeId, Icon } from '../types'
// The stored / runtime call-type representation is the hyphenated
// `GrpcCallType` from `requestPrimitives` (what the plain request interface,
// the import service, the samples and the execution service all use). The
// camelCase `GRPC_CALL_TYPES` in `../types` exists only for the GraphQL enum.
import type { GrpcCallType } from '../../types/requestPrimitives'

/**
 * gRPC request definition with service, method, and message.
 */
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class GrpcRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'grpc'

  /** gRPC server URL (host:port) */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Service name (e.g., "grpcbin.HelloService") */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1 })
  service = ''

  /** Method name (e.g., "SayHello") */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1 })
  method = ''

  /** gRPC call type */
  @graphqlField({ type: 'GrpcCallType' })
  @searchable.property({ filterable: true })
  callType: GrpcCallType = 'unary'

  /** Request message as JSON string */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  requestMessage = ''

  /** Metadata (headers) */
  @graphqlField({ type: 'KeyValue', isArray: true })
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
    authenticationRequestId?: RuntimeId
    url?: string
    service?: string
    method?: string
    callType?: GrpcCallType
    requestMessage?: string
    metadata?: Parameters<typeof KeyValue.fromPlain>[0][]
  }): GrpcRequest {
    return new GrpcRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      url: obj.url ?? '',
      service: obj.service ?? '',
      method: obj.method ?? '',
      callType: obj.callType ?? 'unary',
      requestMessage: obj.requestMessage ?? '',
      metadata: (obj.metadata ?? []) as KeyValue[]
    })
  }

  /**
   * Create a plain object from this GrpcRequest
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
      url: this.url,
      service: this.service,
      method: this.method,
      callType: this.callType,
      requestMessage: this.requestMessage,
      metadata: this.metadata.map(m => m.toPlainObject())
    }
  }
}
