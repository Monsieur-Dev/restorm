import type { BaseRequest } from './BaseRequest'
import type { ODataVersion } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

/** v4 system query options persisted on an OData request. */
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
  /** `$expand` — raw expand clause, e.g.
   * `Category,Tags($select=Name;$top=5)`. Phase 2 persists this as a
   * single string; structured nested editors land later. */
  expand?: string
  /** `$orderby` — raw clause, e.g. `Name asc,Id desc`. */
  orderby?: string
  /** `$search` — free-text search expression. */
  search?: string
  /** `$format` — response format override (`json`, `xml`, `atom`). */
  format?: string
  /** `$apply` — v4.01 aggregation expression (e.g.
   * `groupby((Status),aggregate($count as Total))`). */
  apply?: string
}

/** Discriminates entity-set navigation from bound/unbound function /
 * action invocations, and from batch requests. Phase 1 persists
 * `'entity-set'` for every request; Phase 4 wires `'function'` /
 * `'action'`; Phase 5 adds `'batch'` — a batch is really just an
 * action whose body is a multipart/mixed envelope assembled from a
 * JSON array of sub-requests, so we model it as another operation
 * kind rather than a separate request type. */
export type ODataOperationKind = 'entity-set' | 'function' | 'action' | 'batch'

export interface ODataRequest extends BaseRequest {
  type: 'odata'
  /** Base service URL including entity set (e.g. `{{base}}/People`). */
  url: string
  /** Per-request OData version. Phase 1 always behaves as v4; the
   * field is persisted so the importer can pre-fill it and the v2/v3
   * engine PR doesn't break existing files. */
  odataVersion: ODataVersion
  /** Operation kind — entity-set navigation, function, or action. */
  operationKind: ODataOperationKind
  /** Extra request headers forwarded to the underlying HTTP call. */
  headers: KeyValue[]
  /** Additional non-OData query params (e.g. API keys). OData system
   * options live in `queryOptions`. */
  params: KeyValue[]
  /** System query options ($filter / $select / $top / $skip / $count). */
  queryOptions: ODataQueryOptions
  /** Raw JSON body sent as the POST payload when `operationKind === 'action'`.
   * Env-templated before dispatch. Ignored for entity-set and function
   * calls (functions inline their parameters into the URL). */
  actionBody?: string
  /** Whether this endpoint is deprecated. */
  deprecated?: boolean
}
