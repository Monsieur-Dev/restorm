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

  constructor(init?: Partial<SoapRequest>) {
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
   * Create a SoapRequest from a plain object
   */
  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    icon?: Icon
    documentation?: string
    notes?: string
    tags?: string[]
    url?: string
    soapAction?: string
    service?: string
    operation?: string
    body?: string
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
  }): SoapRequest {
    return new SoapRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      url: obj.url ?? '',
      soapAction: obj.soapAction ?? '',
      service: obj.service ?? '',
      operation: obj.operation ?? '',
      body: obj.body ?? '',
      headers: (obj.headers ?? []) as KeyValue[]
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
      url: this.url,
      soapAction: this.soapAction,
      service: this.service,
      operation: this.operation,
      body: this.body,
      headers: this.headers.map(h => h.toPlainObject())
    }
  }
}
