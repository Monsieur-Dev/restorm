/**
 * ODataRequest - OData v4 request definition. Phase 1 ships the v4
 * subset: URL + headers + extra non-OData params + the most common
 * system query options ($filter / $select / $top / $skip / $count).
 *
 * The persisted shape also carries an `odataVersion` field so the
 * importer (OYO-181) can pre-fill v2/v3 and a follow-up PR wires the
 * engine differences without a storage migration.
 */

import {
  searchable,
  fileNaming,
  graphqlField
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { KeyValue } from '../KeyValue'
import type { RequestType, RuntimeId, Icon, ODataVersion } from '../types'

/**
 * System query options persisted alongside an OData request. Phase 1
 * models the canonical v4 subset; `$expand`, `$orderby`, `$search`,
 * `$format`, and `$apply` land in Phase 2.
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
}

/**
 * Discriminates entity-set navigation from bound/unbound function /
 * action invocations. Phase 1 always persists `'entity-set'`; the
 * field is reserved so Phase 4 doesn't need a storage migration.
 */
export type ODataOperationKind = 'entity-set' | 'function' | 'action'

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

  /** Whether this endpoint is deprecated. */
  @graphqlField({ type: 'Boolean', nullable: true })
  deprecated = false

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
    url?: string
    odataVersion?: ODataVersion
    operationKind?: ODataOperationKind
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    params?: Parameters<typeof KeyValue.fromPlain>[0][]
    queryOptions?: ODataQueryOptions
    deprecated?: boolean
  }): ODataRequest {
    return new ODataRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      url: obj.url ?? '',
      odataVersion: obj.odataVersion ?? 'v4',
      operationKind: obj.operationKind ?? 'entity-set',
      headers: (obj.headers ?? []) as KeyValue[],
      params: (obj.params ?? []) as KeyValue[],
      queryOptions: obj.queryOptions ?? {},
      deprecated: obj.deprecated ?? false
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
      url: this.url,
      odataVersion: this.odataVersion,
      operationKind: this.operationKind,
      headers: this.headers.map(h => h.toPlainObject()),
      params: this.params.map(p => p.toPlainObject()),
      queryOptions: this.queryOptions,
      deprecated: this.deprecated
    }
  }
}
