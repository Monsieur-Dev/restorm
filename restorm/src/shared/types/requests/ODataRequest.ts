import type { BaseRequest } from './BaseRequest'
import type { ODataVersion } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

/** v4 system query options persisted on an OData request. Only the
 * subset shipped in Phase 1 is modelled here — `$expand`, `$orderby`,
 * `$search`, `$format`, `$apply` land in Phase 2. */
export interface ODataQueryOptions {
  /** `$filter` — raw OData filter expression, env-templated. */
  filter?: string
  /** `$select` — list of property names to project. */
  select?: string[]
  /** `$top` — page size. Env-templated string so `{{pageSize}}` works. */
  top?: string
  /** `$skip` — skip count. Env-templated string. */
  skip?: string
  /** `$count` — include inline count. v4 serializes as
   * `$count=true`, v2/v3 become `$inlinecount=allpages` once those
   * versions are wired. */
  count?: boolean
}

/** Discriminates entity-set navigation from bound/unbound function /
 * action invocations. Phase 1 persists `'entity-set'` for every
 * request; actions & functions wire their own UI + URL rules in Phase 4
 * (`Function(param=@p1)` inlining, POST body for actions, etc.). The
 * field is reserved here so the storage shape is stable. */
export type ODataOperationKind = 'entity-set' | 'function' | 'action'

export interface ODataRequest extends BaseRequest {
  type: 'odata'
  /** Base service URL including entity set (e.g. `{{base}}/People`). */
  url: string
  /** Per-request OData version. Phase 1 always behaves as v4; the
   * field is persisted so the importer can pre-fill it and the v2/v3
   * engine PR doesn't break existing files. */
  odataVersion: ODataVersion
  /** Operation kind — entity-set navigation (Phase 1), function, or
   * action. Phase 1 only persists `'entity-set'`. */
  operationKind: ODataOperationKind
  /** Extra request headers forwarded to the underlying HTTP call. */
  headers: KeyValue[]
  /** Additional non-OData query params (e.g. API keys). OData system
   * options live in `queryOptions`. */
  params: KeyValue[]
  /** System query options ($filter / $select / $top / $skip / $count). */
  queryOptions: ODataQueryOptions
  /** Whether this endpoint is deprecated. */
  deprecated?: boolean
}
