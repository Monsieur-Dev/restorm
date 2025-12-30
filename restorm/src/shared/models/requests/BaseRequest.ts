/**
 * BaseRequest - Abstract base class for all request types
 */

import {
  trackable,
  searchable,
  NonSerialised
} from 'electron-core-ui/main'
import type { RuntimeId, Icon, RequestType } from '../types'

/**
 * Abstract base class for all request types.
 * Provides common properties shared by HTTP, GraphQL, gRPC, SOAP, and WebSocket requests.
 */
@trackable()
@searchable()
export abstract class BaseRequest {
  /** Runtime identifier (generated at runtime, not persisted) */
  @NonSerialised()
  id!: RuntimeId

  /** Request type discriminator */
  abstract readonly type: RequestType

  /** Display name of the request */
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional icon for the request */
  icon?: Icon

  /** Documentation describing the request purpose and usage */
  @searchable.property({ weight: 1 })
  documentation = ''

  /** Optional user notes */
  @searchable.property({ weight: 0.5 })
  notes?: string

  /** Tags for categorization and filtering */
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
