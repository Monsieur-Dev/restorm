/**
 * BaseRequest - Abstract base class for all request types
 */

import {
  trackable,
  searchable,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import type { RuntimeId, Icon, RequestType } from '../types'
import type { ImportOrigin } from '../../types/requests/BaseRequest'

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
  @TreatEmptyAsUndefined()
  documentation = ''

  /** Optional user notes */
  @graphqlField({ type: 'String', nullable: true })
  @searchable.property({ weight: 0.5 })
  @TreatEmptyAsUndefined()
  notes?: string

  /** Tags for categorization and filtering */
  @graphqlField({ type: 'String', isArray: true })
  @searchable.property({ weight: 1.5, filterable: true })
  tags: string[] = []

  /** Optional id of an {@link AuthenticationRequest} whose produced
   * headers must be injected before this request is dispatched. The
   * execution engine resolves the id against the containing env
   * folder at run time; the id itself is the only field persisted. */
  @graphqlField({ type: 'String', nullable: true })
  authenticationRequestId?: RuntimeId

  /** Link back to the spec operation this request was materialised
   * from. Absent on user-created requests, which the idempotent
   * refresh pipeline leaves strictly alone. Subclasses inherit it
   * rather than redeclaring it — see `./importMarkers`. */
  importOrigin?: ImportOrigin

  /** `true` once the source spec marks the operation deprecated.
   * Subclasses that expose it to GraphQL redeclare it with a
   * `@graphqlField`; the field itself lives here so every protocol
   * persists it. */
  deprecated?: boolean

  /** `true` once the operation stopped appearing in the fetched
   * spec. The request is kept and stays executable — the sidebar
   * renders it struck-through. */
  removed?: boolean

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
