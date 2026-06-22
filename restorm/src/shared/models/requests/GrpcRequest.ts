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
import type { GrpcMockMethod } from '../../types/requests/GrpcRequest'

/** Normalise a (plain or class) trailers list to `KeyValue` instances. */
function toKeyValues(rows: unknown): KeyValue[] {
  if (!Array.isArray(rows)) return []
  return rows.map(r =>
    r instanceof KeyValue ? r : KeyValue.fromPlain(r as Parameters<typeof KeyValue.fromPlain>[0])
  )
}

/** Materialise one persisted/plain mock-method entry into the runtime shape
 * (trailers become `KeyValue` instances; missing optional fields stay absent). */
function mockMethodFromPlain(m: Partial<GrpcMockMethod>): GrpcMockMethod {
  return {
    service: m.service ?? '',
    method: m.method ?? '',
    callType: m.callType ?? 'unary',
    responseMessage: m.responseMessage ?? '',
    ...(m.statusCode !== undefined && { statusCode: m.statusCode }),
    ...(m.statusMessage !== undefined && { statusMessage: m.statusMessage }),
    ...(m.trailers !== undefined && { trailers: toKeyValues(m.trailers) }),
    ...(m.script !== undefined && { script: m.script })
  }
}

/** Serialise one runtime mock-method entry back to a plain object for disk. */
function mockMethodToPlain(m: GrpcMockMethod): Record<string, unknown> {
  return {
    service: m.service,
    method: m.method,
    callType: m.callType,
    responseMessage: m.responseMessage,
    ...(m.statusCode !== undefined && { statusCode: m.statusCode }),
    ...(m.statusMessage !== undefined && { statusMessage: m.statusMessage }),
    ...(m.trailers !== undefined && { trailers: m.trailers.map(t => (t instanceof KeyValue ? t.toPlainObject() : t)) }),
    ...(m.script !== undefined && { script: m.script })
  }
}

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

  /** When true, restorm ACTS AS a local gRPC mock server (hosts an
   * `@grpc/grpc-js` server on `localhost:<port>` and answers `mockMethods`). */
  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  server?: boolean

  /** Per-method mock configuration (server mode). */
  mockMethods?: GrpcMockMethod[]

  /** Inline `.proto` descriptor content the mock server loads (server mode). */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  protoContent?: string

  /** Path to a `.proto` file on disk the mock server loads (server mode). */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  protoPath?: string

  /** Serve the standard gRPC ServerReflection service (server mode; default true). */
  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  reflection?: boolean

  /** Use TLS with a server certificate instead of an insecure channel (server mode). */
  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  tls?: boolean

  /** PEM server certificate (TLS server mode). */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  tlsCertPem?: string

  /** PEM private key (TLS server mode). */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  tlsKeyPem?: string

  constructor(init?: Partial<GrpcRequest>) {
    super(init)
    if (init) {
      Object.assign(this, init)
      if (init.metadata) {
        this.metadata = init.metadata.map(m =>
          m instanceof KeyValue ? m : KeyValue.fromPlain(m as unknown as Parameters<typeof KeyValue.fromPlain>[0])
        )
      }
      if (init.mockMethods) {
        this.mockMethods = init.mockMethods.map(m => mockMethodFromPlain(m))
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
    server?: boolean
    mockMethods?: Partial<GrpcMockMethod>[]
    protoContent?: string
    protoPath?: string
    reflection?: boolean
    tls?: boolean
    tlsCertPem?: string
    tlsKeyPem?: string
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
      metadata: (obj.metadata ?? []) as KeyValue[],
      ...(obj.server !== undefined && { server: obj.server }),
      ...(obj.mockMethods !== undefined && { mockMethods: obj.mockMethods.map(m => mockMethodFromPlain(m)) }),
      ...(obj.protoContent !== undefined && { protoContent: obj.protoContent }),
      ...(obj.protoPath !== undefined && { protoPath: obj.protoPath }),
      ...(obj.reflection !== undefined && { reflection: obj.reflection }),
      ...(obj.tls !== undefined && { tls: obj.tls }),
      ...(obj.tlsCertPem !== undefined && { tlsCertPem: obj.tlsCertPem }),
      ...(obj.tlsKeyPem !== undefined && { tlsKeyPem: obj.tlsKeyPem })
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
      metadata: this.metadata.map(m => m.toPlainObject()),
      ...(this.server !== undefined && { server: this.server }),
      ...(this.mockMethods !== undefined && { mockMethods: this.mockMethods.map(m => mockMethodToPlain(m)) }),
      ...(this.protoContent !== undefined && { protoContent: this.protoContent }),
      ...(this.protoPath !== undefined && { protoPath: this.protoPath }),
      ...(this.reflection !== undefined && { reflection: this.reflection }),
      ...(this.tls !== undefined && { tls: this.tls }),
      ...(this.tlsCertPem !== undefined && { tlsCertPem: this.tlsCertPem }),
      ...(this.tlsKeyPem !== undefined && { tlsKeyPem: this.tlsKeyPem })
    }
  }
}
