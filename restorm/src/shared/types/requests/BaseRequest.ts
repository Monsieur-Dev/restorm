import type { RuntimeId, Icon } from '../baseTypes'

export interface BaseRequest {
  id: RuntimeId
  name: string
  icon?: Icon
  documentation: string
  notes?: string
  tags: string[]
  /** When set, the execution engine resolves this id to an
   * `AuthenticationRequest` stored elsewhere in the collection and
   * injects its produced headers into this request before dispatch. */
  authenticationRequestId?: RuntimeId
}
