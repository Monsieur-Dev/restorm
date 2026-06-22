/**
 * SoapRequest - SOAP request definition
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
import type { SoapMockOperation } from '../../types/requests/SoapRequest'
import type { QuickConfig } from '../../types/requests/QuickConfig'

/** Deep-copy a mock-operations array so a model never aliases a caller's array
 * (mirrors the `headers` copy below — keeps persistence + edits independent). */
function cloneMockOperations(ops: SoapMockOperation[]): SoapMockOperation[] {
  return ops.map(op => ({
    name: op.name,
    ...(op.soapAction !== undefined && { soapAction: op.soapAction }),
    responseBody: op.responseBody,
    ...(op.isFault !== undefined && { isFault: op.isFault })
  }))
}

/**
 * SOAP request definition with service, operation, and body.
 */
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class SoapRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'soap'

  /** SOAP endpoint URL */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** SOAP action */
  @graphqlField({ type: 'String', nullable: true })
  soapAction = ''

  /** Service name */
  @graphqlField({ type: 'String', nullable: true })
  @searchable.property({ weight: 1 })
  service = ''

  /** Operation name */
  @graphqlField({ type: 'String', nullable: true })
  @searchable.property({ weight: 1 })
  operation = ''

  /** SOAP envelope body as XML string */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  body = ''

  /** HTTP headers */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  /** When true, restorm ACTS AS the server (hosts a SOAP mock on localhost)
   * instead of calling out as a client. The URL then carries only
   * `localhost:<port>[/<route>]` (host is fixed). */
  @TreatEmptyAsUndefined()
  server?: boolean

  /** Operations the hosted mock answers (server mode): each maps an inbound
   * SOAPAction / body-operation to a canned XML response (or a `<soap:Fault>`). */
  mockOperations?: SoapMockOperation[]

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<SoapRequest>) {
    super(init)
    if (init) {
      Object.assign(this, init)
      if (init.headers) {
        this.headers = init.headers.map(h =>
          h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
        )
      }
      if (init.mockOperations) {
        this.mockOperations = cloneMockOperations(init.mockOperations)
      }
    }
  }

  /**
   * Create a SoapRequest from a plain object
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
    soapAction?: string
    service?: string
    operation?: string
    body?: string
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    server?: boolean
    mockOperations?: SoapMockOperation[]
    quickConfigs?: QuickConfig[]
  }): SoapRequest {
    return new SoapRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      url: obj.url ?? '',
      soapAction: obj.soapAction ?? '',
      service: obj.service ?? '',
      operation: obj.operation ?? '',
      body: obj.body ?? '',
      headers: (obj.headers ?? []) as KeyValue[],
      ...(obj.server !== undefined && { server: obj.server }),
      ...(obj.mockOperations !== undefined && { mockOperations: cloneMockOperations(obj.mockOperations) }),
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

  /**
   * Create a plain object from this SoapRequest
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
      soapAction: this.soapAction,
      service: this.service,
      operation: this.operation,
      body: this.body,
      headers: this.headers.map(h => h.toPlainObject()),
      ...(this.server !== undefined && { server: this.server }),
      ...(this.mockOperations !== undefined && { mockOperations: cloneMockOperations(this.mockOperations) }),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
