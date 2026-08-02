/**
 * ODataRequest - OData v4 request definition. Phase 1 ships the v4
 * subset: URL + headers + extra non-OData params + the most common
 * system query options ($filter / $select / $top / $skip / $count).
 *
 * The persisted shape also carries an `odataVersion` field so the
 * importer can pre-fill v2/v3 and a follow-up PR wires the engine
 * differences without a storage migration.
 */

import {
  searchable,
  fileNaming,
  graphqlField
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { pickImportMarkers, type ImportMarkerFields } from './importMarkers'
import { KeyValue } from '../KeyValue'
import type { RequestType, RuntimeId, Icon, ODataVersion } from '../types'
import type { QuickConfig } from '../../types/requests/QuickConfig'

/**
 * System query options persisted alongside an OData request. Phase 2
 * adds the advanced v4 options (`$expand`, `$orderby`, `$search`,
 * `$format`, `$apply`) as env-templated strings. Structured nested
 * editors for `$expand` (per-level `$select`/`$filter`/`$top`) and
 * `$orderby` (prop + direction builder) are a follow-up polish pass.
 */
export interface ODataQueryOptions {
  /** `$filter` — raw OData filter expression. Env-templated. */
  filter?: string
  /** `$select` — property names to project. */
  select?: string[]
  /** `$top` — page size. String so `{{pageSize}}` templates work. */
  top?: string
  /** `$skip` — skip count. String so `{{offset}}` templates work. */
  skip?: string
  /** `$count` — when true the URL carries `$count=true`. v2/v3 will
   * emit `$inlinecount=allpages` once the version engine PR lands. */
  count?: boolean
  /** `$expand` — raw expand clause, e.g.
   * `Category,Tags($select=Name;$top=5)`. */
  expand?: string
  /** `$orderby` — raw clause, e.g. `Name asc,Id desc`. */
  orderby?: string
  /** `$search` — free-text search expression. */
  search?: string
  /** `$format` — response format override (`json`, `xml`, `atom`). */
  format?: string
  /** `$apply` — v4.01 aggregation expression. */
  apply?: string
}

/**
 * Discriminates entity-set navigation from bound/unbound function /
 * action invocations, and from batch requests (Phase 5). Phase 1
 * always persists `'entity-set'`; the field is reserved so later
 * phases don't need a storage migration.
 */
export type ODataOperationKind = 'entity-set' | 'function' | 'action' | 'batch'

/** Wire format for a `$batch`: `multipart/mixed` (default) or the v4
 * JSON batch format. Persisted so the user's choice survives reload. */
export type ODataBatchFormat = 'multipart' | 'json'

/** Parameter descriptor for action/function invocations. */
export interface ODataOperationParameterSpec {
  name: string
  type: string
  nullable?: boolean
  isBinding?: boolean
  value?: string
}

/** Structured sub-request inside a `$batch`. An atomicityGroup label
 * ties consecutive entries into one change-set so the server commits
 * them as a single transaction. */
export interface ODataBatchSubRequestSpec {
  id: string
  method: string
  url: string
  headers?: { key: string; value: string }[]
  body?: string
  atomicityGroup?: string
  label?: string
  /** Per-child escape hatch: include this GET in the change-set even
   * when the batch-level `allowGetInChangeSet` is off. */
  forceIncludeInChangeSet?: boolean
}

@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class ODataRequest extends BaseRequest {
  readonly type: RequestType = 'odata'

  /** Base service URL including the entity set (e.g.
   * `{{base}}/People`). Resolved through env/handlebars before
   * dispatch. */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** OData protocol version. Phase 1 always behaves as v4; the field
   * is persisted so the importer can pre-fill it and the v2/v3
   * engine PR doesn't need a storage migration. */
  @graphqlField({ type: 'String' })
  odataVersion: ODataVersion = 'v4'

  /** Entity-set navigation vs function / action invocation. Phase 1
   * always persists `'entity-set'`; the Phase 4 UI will swap to
   * `'function'` / `'action'` when bound/unbound operations ship. */
  @graphqlField({ type: 'String' })
  operationKind: ODataOperationKind = 'entity-set'

  /** Extra request headers forwarded to the underlying HTTP call. */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  /** Non-OData query params (API keys, custom flags). System options
   * live in `queryOptions` and are serialized separately. */
  @graphqlField({ type: 'KeyValue', isArray: true })
  params: KeyValue[] = []

  /** System query options ($filter / $select / $top / $skip / $count). */
  @graphqlField({ type: 'JSON' })
  queryOptions: ODataQueryOptions = {}

  /** Raw JSON body used as the POST payload when operationKind === 'action'.
   * Env-templated before dispatch. */
  @graphqlField({ type: 'String', nullable: true })
  actionBody?: string

  /** Structured sub-requests edited in the batch UI. Serialized to
   * multipart/mixed (with nested change-set envelopes when
   * `atomicityGroup` is set) before dispatch. */
  @graphqlField({ type: 'JSON', nullable: true })
  batchSubRequests?: ODataBatchSubRequestSpec[]

  /** Wire format for the `$batch` envelope. `'multipart'` (default)
   * uses multipart/mixed; `'json'` uses the v4 JSON batch format. */
  @graphqlField({ type: 'String', nullable: true })
  batchFormat?: ODataBatchFormat
  /** Qualified EDMX name of the entity type this request is bound to
   * (e.g. `OData.PetStore.Models.Pet`), pre-filled by the importer.
   * Lets the renderer resolve the request's model in
   * `apiDocumentation.models` to drive metadata-aware $filter /
   * $orderby autocomplete. Absent on a hand-authored request. */
  @graphqlField({ type: 'String', nullable: true })
  entityTypeRef?: string

  /** When true, GET sub-requests inside change-sets are serialized
   * without a warning. Default `false` — Restorm emits a warning
   * because the OData spec forbids GET inside a change-set. */
  @graphqlField({ type: 'Boolean', nullable: true })
  allowGetInChangeSet?: boolean

  /** v4.01 only: when true, batch sub-request URLs are kept as
   * absolute URLs (the v4.01 spec strongly prefers relative URIs;
   * this escape hatch lets you target servers that require absolute). */
  @graphqlField({ type: 'Boolean', nullable: true })
  forceAbsoluteBatchUrls?: boolean

  /** Structural-property names pre-filled by the importer from the
   * bound entity type. Surfaces in the UI as $select / $orderby
   * chip hints. */
  @graphqlField({ type: 'String', isArray: true, nullable: true })
  entitySetProperties?: string[]

  /** Navigation-property names pre-filled by the importer. Surfaces
   * in the UI as $expand chip hints. */
  @graphqlField({ type: 'String', isArray: true, nullable: true })
  navigationProperties?: string[]

  /** Parameter schema for action / function invocations. The UI
   * renders a typed form; the serializer builds the request body
   * (actions) or URL-inlined arguments (functions) from the values. */
  @graphqlField({ type: 'JSON', nullable: true })
  operationParameters?: ODataOperationParameterSpec[]

  /** Whether this endpoint is deprecated. */
  @graphqlField({ type: 'Boolean', nullable: true })
  override deprecated = false

  /** When true, restorm ACTS AS a local OData v4 mock service: it hosts the
   * `mockMetadata` CSDL + the `mockData` entity collections on
   * `localhost:<port><serviceRoot>` (the URL carries only that address) and
   * answers `$metadata` + entity-set + by-key + `$count` + `$batch` with the
   * system query options applied, instead of sending a client request. */
  @graphqlField({ type: 'Boolean', nullable: true })
  server?: boolean

  /** The CSDL ($metadata) document the mock serves verbatim. Its entity-set +
   * entity-type declarations are re-parsed (via the EDMX parser) to derive the
   * route table + validate $select/$filter property names. Server mode only. */
  @graphqlField({ type: 'String', nullable: true })
  mockMetadata?: string

  /** Served entity data, keyed by entity-set name → an array of entity objects.
   * The query-option executor applies $filter/$orderby/$top/$skip/$count/$select
   * over each set. Server mode only. */
  @graphqlField({ type: 'JSON', nullable: true })
  mockData?: Record<string, Record<string, unknown>[]>

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<ODataRequest>) {
    super(init)
    if (init) {
      const { headers, params, queryOptions, ...rest } = init
      Object.assign(this, rest)
      this.headers = (headers ?? []).map(h =>
        h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
      )
      this.params = (params ?? []).map(p =>
        p instanceof KeyValue ? p : KeyValue.fromPlain(p as unknown as Parameters<typeof KeyValue.fromPlain>[0])
      )
      this.queryOptions = { ...(queryOptions ?? {}) }
    }
  }

  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    icon?: Icon
    documentation?: string
    notes?: string
    tags?: string[]
    authenticationRequestId?: RuntimeId
    url?: string
    odataVersion?: ODataVersion
    operationKind?: ODataOperationKind
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    params?: Parameters<typeof KeyValue.fromPlain>[0][]
    queryOptions?: ODataQueryOptions
    actionBody?: string
    batchSubRequests?: ODataBatchSubRequestSpec[]
    batchFormat?: ODataBatchFormat
    entityTypeRef?: string
    allowGetInChangeSet?: boolean
    forceAbsoluteBatchUrls?: boolean
    entitySetProperties?: string[]
    navigationProperties?: string[]
    operationParameters?: ODataOperationParameterSpec[]
    deprecated?: boolean
    server?: boolean
    mockMetadata?: string
    mockData?: Record<string, Record<string, unknown>[]>
    quickConfigs?: QuickConfig[]
  } & ImportMarkerFields): ODataRequest {
    return new ODataRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      ...pickImportMarkers(obj),
      url: obj.url ?? '',
      odataVersion: obj.odataVersion ?? 'v4',
      operationKind: obj.operationKind ?? 'entity-set',
      headers: (obj.headers ?? []) as KeyValue[],
      params: (obj.params ?? []) as KeyValue[],
      queryOptions: obj.queryOptions ?? {},
      ...(obj.actionBody !== undefined && { actionBody: obj.actionBody }),
      ...(obj.batchSubRequests !== undefined && { batchSubRequests: obj.batchSubRequests }),
      ...(obj.batchFormat !== undefined && { batchFormat: obj.batchFormat }),
      ...(obj.entityTypeRef !== undefined && { entityTypeRef: obj.entityTypeRef }),
      ...(obj.allowGetInChangeSet !== undefined && { allowGetInChangeSet: obj.allowGetInChangeSet }),
      ...(obj.forceAbsoluteBatchUrls !== undefined && { forceAbsoluteBatchUrls: obj.forceAbsoluteBatchUrls }),
      ...(obj.entitySetProperties !== undefined && { entitySetProperties: obj.entitySetProperties }),
      ...(obj.navigationProperties !== undefined && { navigationProperties: obj.navigationProperties }),
      ...(obj.operationParameters !== undefined && { operationParameters: obj.operationParameters }),
      ...(obj.server !== undefined && { server: obj.server }),
      ...(obj.mockMetadata !== undefined && { mockMetadata: obj.mockMetadata }),
      ...(obj.mockData !== undefined && { mockData: obj.mockData }),
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

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
      ...pickImportMarkers(this),
      url: this.url,
      odataVersion: this.odataVersion,
      operationKind: this.operationKind,
      headers: this.headers.map(h => h.toPlainObject()),
      params: this.params.map(p => p.toPlainObject()),
      queryOptions: this.queryOptions,
      ...(this.actionBody !== undefined && { actionBody: this.actionBody }),
      ...(this.batchSubRequests !== undefined && { batchSubRequests: this.batchSubRequests }),
      ...(this.batchFormat !== undefined && { batchFormat: this.batchFormat }),
      ...(this.entityTypeRef !== undefined && { entityTypeRef: this.entityTypeRef }),
      ...(this.allowGetInChangeSet !== undefined && { allowGetInChangeSet: this.allowGetInChangeSet }),
      ...(this.forceAbsoluteBatchUrls !== undefined && { forceAbsoluteBatchUrls: this.forceAbsoluteBatchUrls }),
      ...(this.entitySetProperties !== undefined && { entitySetProperties: this.entitySetProperties }),
      ...(this.navigationProperties !== undefined && { navigationProperties: this.navigationProperties }),
      ...(this.operationParameters !== undefined && { operationParameters: this.operationParameters }),
      ...(this.server !== undefined && { server: this.server }),
      ...(this.mockMetadata !== undefined && { mockMetadata: this.mockMetadata }),
      ...(this.mockData !== undefined && { mockData: this.mockData }),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
