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

/** Parameter descriptor for an action / function, pre-filled by the
 * importer from the EDMX `<Parameter>` elements. The UI surfaces a
 * typed input per entry; the user-supplied values drive the body
 * (actions) or URL-inlined arguments (functions). */
export interface ODataOperationParameterSpec {
  /** Parameter name — e.g. `OwnerId`, `category`. */
  name: string
  /** Qualified CSDL type — e.g. `Edm.Int32`, `Edm.String`,
   * `Collection(Edm.String)`, `OData.PetStore.Models.PetStatus`. */
  type: string
  /** Whether the parameter accepts null. */
  nullable?: boolean
  /** True for the binding parameter on a bound operation — the UI
   * hides these since they're driven by the invocation URL, not the
   * payload. */
  isBinding?: boolean
  /** Current user-supplied value. Stored as a string and parsed by
   * the serializer before dispatch. */
  value?: string
}

/** Wire format for a `$batch` request. OData v4 defines two: the
 * original `multipart/mixed` envelope (works on every v4 server) and
 * the newer, easier-to-read JSON batch (`application/json`, a
 * `{ requests: [...] }` document). Defaults to `'multipart'` when
 * absent so existing files keep their behaviour. */
export type ODataBatchFormat = 'multipart' | 'json'

/** A single sub-request inside a `$batch`. Atomicity groups collect
 * sub-requests that must succeed or fail together (change-sets per
 * the OData v4 spec). A sub-request with no `atomicityGroup` is a
 * standalone operation outside any change-set. */
export interface ODataBatchSubRequestSpec {
  /** Stable ID used by the UI for keys / reordering. */
  id: string
  /** HTTP method. GET inside a change-set is spec-non-conformant;
   * Restorm warns by default and lets the user opt in via
   * `allowGetInChangeSet` (batch level) or `forceIncludeInChangeSet`
   * (per child). */
  method: string
  /** URL relative to the service root (resolved at send time). */
  url: string
  /** Optional extra request headers. */
  headers?: { key: string; value: string }[]
  /** Optional JSON body — required for POST/PATCH/PUT. */
  body?: string
  /** Atomicity group label. Sub-requests sharing the same label are
   * serialized as a nested `multipart/mixed; boundary=changeset_<id>`
   * envelope. Empty / undefined means "no change-set". */
  atomicityGroup?: string
  /** User-visible label shown in the sidebar list. */
  label?: string
  /** Per-child escape hatch: force this GET sub-request into the
   * change-set even when the batch-level `allowGetInChangeSet` flag
   * is off. Only meaningful when `method === 'GET'` and `atomicityGroup`
   * is non-empty. */
  forceIncludeInChangeSet?: boolean
}

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
  /** Structured sub-requests for `$batch` kind. The UI edits this
   * array; the engine serializes it into multipart/mixed (with
   * nested change-set envelopes when `atomicityGroup` is set). */
  batchSubRequests?: ODataBatchSubRequestSpec[]
  /** Wire format for the `$batch` envelope. `'multipart'` (default)
   * uses multipart/mixed; `'json'` uses the v4 JSON batch format. */
  batchFormat?: ODataBatchFormat
  /** Qualified EDMX name of the entity type this request is bound to
   * (e.g. `OData.PetStore.Models.Pet`), pre-filled by the importer.
   * Lets the renderer resolve the request's `ModelDocumentation` in
   * `apiDocumentation.models` to drive metadata-aware `$filter` /
   * `$orderby` autocomplete (property / operator / value suggestions,
   * enum values, type hints). Absent on a hand-authored request ⇒
   * autocomplete falls back to no suggestions. */
  entityTypeRef?: string
  /** When true, GET sub-requests inside change-sets are allowed
   * without a warning. Default `false` (Restorm emits a warning
   * because the OData spec forbids GET inside a change-set; many
   * servers reject such batches). Toggle this flag when your server
   * explicitly supports it. */
  allowGetInChangeSet?: boolean
  /** v4.01 only: when true, batch sub-request URLs are kept as
   * absolute URLs even though the v4.01 spec strongly prefers relative
   * URIs. Useful when the target server requires absolute URLs. */
  forceAbsoluteBatchUrls?: boolean
  /** Names of structural properties on the bound entity type (pre-
   * filled by the importer from the EDMX `EntityType`). The UI
   * surfaces these as clickable chips beneath $select / $orderby
   * to give metadata-driven hints without a full autocomplete
   * pop-over. Empty / absent ⇒ no hints (hand-authored request). */
  entitySetProperties?: string[]
  /** Names of navigation properties on the bound entity type (also
   * from the importer). Surfaced as chips beneath $expand. */
  navigationProperties?: string[]
  /** Parameter schema for action / function invocations (pre-filled
   * by the importer). The UI renders a typed form and the
   * serializer builds the request body (actions) or URL-inlined
   * arguments (functions) from the values. */
  operationParameters?: ODataOperationParameterSpec[]
  /** Whether this endpoint is deprecated. */
  deprecated?: boolean
}
