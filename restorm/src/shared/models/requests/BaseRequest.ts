/**
 * BaseRequest - Abstract base class for all request types
 */

import {
  trackable,
  searchable,
  graphqlField
} from 'electron-core-ui/main'
import type { RuntimeId, Icon, RequestType } from '../types'

/**
 * Abstract base class for all request types.
 * Provides common properties shared by HTTP, GraphQL, gRPC, SOAP, and WebSocket requests.
 */
@trackable()
@searchable()
export abstract class BaseRequest {
  /** Stable identifier persisted with the request. See `Folder.id`. */
  @graphqlField({ type: 'String' })
  id!: RuntimeId

  /** Request type discriminator */
  @graphqlField({ type: 'RequestType' })
  abstract readonly type: RequestType

  /** Display name of the request */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional icon for the request */
  icon?: Icon

  /** Documentation describing the request purpose and usage */
  @graphqlField({ type: 'String', nullable: true })
  @searchable.property({ weight: 1 })
  documentation = ''

  /** Optional user notes */
  @graphqlField({ type: 'String', nullable: true })
  @searchable.property({ weight: 0.5 })
  notes?: string

  /** Tags for categorization and filtering */
  @graphqlField({ type: 'String', isArray: true })
  @searchable.property({ weight: 1.5, filterable: true })
  tags: string[] = []

  constructor(init?: Partial<BaseRequest>) {
    if (init) {
      Object.assign(this, init)
    }
  }

  /**
   * Create a plain object from this request
   */
  abstract toPlainObject(): Record<string, unknown>
}
