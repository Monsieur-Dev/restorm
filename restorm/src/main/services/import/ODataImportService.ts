/**
 * ODataImportService — parse an OData $metadata document (EDMX CSDL)
 * and generate an `EnvironmentFolder` full of ready-to-run OData
 * requests, one sub-folder per entity set (CRUD) plus `Actions` and
 * `Functions` sub-folders.
 *
 * Three input shapes are handled, all dispatched from `importOData`:
 *   - v4 EDMX XML (`edmx:Edmx Version="4.0"`),
 *   - v2/v3 EDMX XML (older CSDL — `<Key>/<PropertyRef>`, no `<EnumType>`,
 *     `<FunctionImport>` instead of `<Action>`/`<Function>`),
 *   - JSON-CSDL (`{ $Version, $EntityContainer, … }`, OData v4.0/4.01).
 *
 * The folder is tagged with the detected `odataVersion` so the engine
 * emits the right query options (`$inlinecount` vs `$count`) and the
 * response normaliser unwraps the right envelope (`d.results` vs
 * `value`). Parsing is regex-based — EDMX is well-structured and SOAP's
 * WSDL importer already shows the pattern works at scale, so we avoid
 * pulling in a new XML dependency.
 */

import { createHash } from 'node:crypto'
import {
  Folder,
  EnvironmentFolder,
  Environment,
  ODataRequest,
  KeyValue
} from '../../../shared/models'
import type { ODataVersion } from '../../../shared/models/types'
import type {
  ApiDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  PropertyDocumentation
} from '../../../shared/types/apiDocumentation'
import { StringValue } from '../../../shared/types/collections'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'

// ============================================================================
// CSDL (EDMX) intermediate shapes
// ============================================================================

interface EdmProperty {
  name: string
  type: string
  nullable: boolean
  collection: boolean
}

interface EdmEntityType {
  namespace: string
  name: string
  qualifiedName: string
  keys: string[]
  properties: EdmProperty[]
  navigationProperties: EdmProperty[]
}

interface EdmEnumType {
  namespace: string
  name: string
  qualifiedName: string
  members: { name: string; value: string }[]
}

interface EdmOperationParameter {
  name: string
  type: string
  nullable: boolean
  collection: boolean
}

interface EdmOperation {
  kind: 'action' | 'function'
  namespace: string
  name: string
  qualifiedName: string
  isBound: boolean
  bindingType?: string
  parameters: EdmOperationParameter[]
  returnType?: string
}

interface EdmEntitySet {
  name: string
  entityType: string
}

interface EdmSchema {
  version: ODataVersion
  entityTypes: EdmEntityType[]
  enumTypes: EdmEnumType[]
  operations: EdmOperation[]
  entitySets: EdmEntitySet[]
}

// ============================================================================
// XML helpers
// ============================================================================

/** Find every `<tag ...>` occurrence with its attribute map, optionally
 * capturing the inner body. Uses a tolerant regex — CSDL never nests
 * a tag inside the same-name tag at the top level, so `matchAll` over
 * the full body is sufficient for our needs. */
function findTags(xml: string, tag: string): { attrs: Record<string, string>; body: string }[] {
  const results: { attrs: Record<string, string>; body: string }[] = []
  // Self-closing (<Foo ... />) and open/close (<Foo ...>...</Foo>) variants.
  const open = new RegExp(`<${tag}\\b([^>]*?)(/>|>([\\s\\S]*?)<\\/${tag}>)`, 'g')
  let match: RegExpExecArray | null
  while ((match = open.exec(xml)) !== null) {
    const attrString = match[1] ?? ''
    const body = match[3] ?? ''
    results.push({ attrs: parseAttributes(attrString), body })
  }
  return results
}

function parseAttributes(attrString: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attrString)) !== null) {
    const key = m[1]
    const value = m[2]
    if (key !== undefined && value !== undefined) out[key] = value
  }
  return out
}

/** OData types are either `Edm.Xxx`, a qualified `Namespace.TypeName`,
 * or wrapped as `Collection(<inner>)`. Strip the collection wrapper
 * and return `{ inner, collection }`. */
function unwrapCollection(type: string): { inner: string; collection: boolean } {
  const match = /^Collection\((.+)\)$/.exec(type.trim())
  if (match?.[1]) return { inner: match[1], collection: true }
  return { inner: type, collection: false }
}

// ============================================================================
// Version detection
// ============================================================================

/**
 * Detect the OData protocol version of an EDMX XML document.
 *
 * The authoritative signal is the `Version` attribute on the
 * `<edmx:Edmx>` root: `4.0`/`4.01` → v4, `3.0` → v3, `1.0`/`2.0` → v2.
 * Older services sometimes omit it, so we also look at
 * `m:DataServiceVersion` on `<edmx:DataServices>` and at the EDM
 * namespace URI (the v4 namespace is `…/odata/ns/edm`, while v1-v3 use
 * `…/ado/2006|2007|2008|2009/…/edm`). When nothing matches we default
 * to v4 — the modern, most-common case.
 */
function parseEdmxVersion(xml: string): ODataVersion {
  const edmxRoot = /<(?:edmx:)?Edmx\b([^>]*)>/.exec(xml)
  const rootVersion = edmxRoot ? parseAttributes(edmxRoot[1] ?? '')['Version'] : undefined
  if (rootVersion !== undefined) {
    if (rootVersion === '4.01') return 'v4.01'
    if (rootVersion.startsWith('4')) return 'v4'
    if (rootVersion.startsWith('3')) return 'v3'
    if (rootVersion.startsWith('1') || rootVersion.startsWith('2')) return 'v2'
  }

  const dataServices = /<(?:edmx:)?DataServices\b([^>]*)>/.exec(xml)
  const dsVersion = dataServices
    ? parseAttributes(dataServices[1] ?? '')['m:DataServiceVersion']
      ?? parseAttributes(dataServices[1] ?? '')['DataServiceVersion']
    : undefined
  if (dsVersion !== undefined) {
    if (dsVersion.startsWith('3')) return 'v3'
    if (dsVersion.startsWith('1') || dsVersion.startsWith('2')) return 'v2'
  }

  // Namespace fallback — the v4 EDM namespace is unambiguous.
  if (xml.includes('docs.oasis-open.org/odata/ns/edm')) return 'v4'
  if (xml.includes('/ado/2009/11/edm')) return 'v3'
  if (xml.includes('/ado/2008/09/edm') || xml.includes('/ado/2007/05/edm') || xml.includes('/ado/2006/04/edm')) {
    return 'v2'
  }

  return 'v4'
}

// ============================================================================
// CSDL → EdmSchema parser (EDMX XML, all versions)
// ============================================================================

/**
 * Parse an EDMX XML document into the version-agnostic `EdmSchema`.
 *
 * The element shapes the importer needs (`<EntityType>`, `<Key>`,
 * `<PropertyRef>`, `<Property>`, `<NavigationProperty>`, `<EntitySet>`)
 * are spelled the same across v2/v3/v4, so one regex pass covers all
 * three. Where the versions genuinely diverge:
 *   - v4 carries `<Action>`/`<Function>` (bound + unbound); v2/v3 only
 *     expose `<FunctionImport>` inside the container — we pick those up
 *     as functions so the `Functions` folder isn't empty.
 *   - v2 has no `<EnumType>` — `findTags` simply returns none.
 * The detected `version` is stamped onto the schema so every generated
 * request is tagged correctly.
 */
function parseEdmx(xml: string, version: ODataVersion): EdmSchema {
  const schema: EdmSchema = {
    version,
    entityTypes: [],
    enumTypes: [],
    operations: [],
    entitySets: []
  }

  const schemaBlocks = findTags(xml, 'Schema')
  for (const block of schemaBlocks) {
    const namespace = block.attrs['Namespace'] ?? 'Default'

    // --- Entity types ---
    for (const et of findTags(block.body, 'EntityType')) {
      const name = et.attrs['Name'] ?? ''
      if (!name) continue
      const keyBlock = findTags(et.body, 'Key')[0]
      const keys = keyBlock
        ? findTags(keyBlock.body, 'PropertyRef').map((k) => k.attrs['Name'] ?? '').filter(Boolean)
        : []
      const properties: EdmProperty[] = findTags(et.body, 'Property').map((p) => {
        const rawType = p.attrs['Type'] ?? 'Edm.String'
        const { inner, collection } = unwrapCollection(rawType)
        return {
          name: p.attrs['Name'] ?? '',
          type: inner,
          nullable: (p.attrs['Nullable'] ?? 'true') !== 'false',
          collection
        }
      })
      const navigationProperties: EdmProperty[] = findTags(et.body, 'NavigationProperty').map((n) => {
        const rawType = n.attrs['Type'] ?? ''
        const { inner, collection } = unwrapCollection(rawType)
        return {
          name: n.attrs['Name'] ?? '',
          type: inner,
          nullable: (n.attrs['Nullable'] ?? 'true') !== 'false',
          collection
        }
      })
      schema.entityTypes.push({
        namespace,
        name,
        qualifiedName: `${namespace}.${name}`,
        keys,
        properties,
        navigationProperties
      })
    }

    // --- Enum types ---
    for (const en of findTags(block.body, 'EnumType')) {
      const name = en.attrs['Name'] ?? ''
      if (!name) continue
      const members = findTags(en.body, 'Member').map((m) => ({
        name: m.attrs['Name'] ?? '',
        value: m.attrs['Value'] ?? ''
      }))
      schema.enumTypes.push({
        namespace,
        name,
        qualifiedName: `${namespace}.${name}`,
        members
      })
    }

    // --- Actions & Functions ---
    for (const [kind, tag] of [['action', 'Action'], ['function', 'Function']] as const) {
      for (const op of findTags(block.body, tag)) {
        const name = op.attrs['Name'] ?? ''
        if (!name) continue
        const isBound = (op.attrs['IsBound'] ?? 'false') === 'true'
        const parameters: EdmOperationParameter[] = findTags(op.body, 'Parameter').map((p) => {
          const rawType = p.attrs['Type'] ?? 'Edm.String'
          const { inner, collection } = unwrapCollection(rawType)
          return {
            name: p.attrs['Name'] ?? '',
            type: inner,
            nullable: (p.attrs['Nullable'] ?? 'true') !== 'false',
            collection
          }
        })
        const returnTypeTag = findTags(op.body, 'ReturnType')[0]
        const returnType = returnTypeTag?.attrs['Type']
        // A bound op's first parameter is the binding parameter; strip it
        // from the "caller-supplied" list and record its type separately.
        const bindingType = isBound && parameters[0] ? parameters[0].type : undefined
        const userParameters = isBound ? parameters.slice(1) : parameters
        const operation: EdmOperation = {
          kind,
          namespace,
          name,
          qualifiedName: `${namespace}.${name}`,
          isBound,
          parameters: userParameters,
          ...(bindingType !== undefined ? { bindingType } : {}),
          ...(returnType !== undefined ? { returnType } : {})
        }
        schema.operations.push(operation)
      }
    }

    // --- Entity sets + container-level function imports ---
    for (const container of findTags(block.body, 'EntityContainer')) {
      for (const es of findTags(container.body, 'EntitySet')) {
        const name = es.attrs['Name'] ?? ''
        const entityType = es.attrs['EntityType'] ?? ''
        if (name && entityType) {
          schema.entitySets.push({ name, entityType })
        }
      }

      // v2/v3 expose callable operations only as `<FunctionImport>` in
      // the container (no schema-level `<Function>`/`<Action>`). v4 has
      // FunctionImports too but they just re-expose an already-declared
      // `<Function>`, so skip any whose name we already captured above.
      for (const fi of findTags(container.body, 'FunctionImport')) {
        const name = fi.attrs['Name'] ?? ''
        if (!name) continue
        if (schema.operations.some((op) => op.name === name)) continue
        const parameters: EdmOperationParameter[] = findTags(fi.body, 'Parameter').map((p) => {
          const rawType = p.attrs['Type'] ?? 'Edm.String'
          const { inner, collection } = unwrapCollection(rawType)
          return {
            name: p.attrs['Name'] ?? '',
            type: inner,
            nullable: (p.attrs['Nullable'] ?? 'true') !== 'false',
            collection
          }
        })
        // v2/v3 carry the return type as a `ReturnType` attribute; a
        // POST `m:HttpMethod` marks it as an action-shaped import.
        const returnType = fi.attrs['ReturnType']
        const isAction = (fi.attrs['m:HttpMethod'] ?? fi.attrs['HttpMethod'] ?? 'GET').toUpperCase() === 'POST'
        schema.operations.push({
          kind: isAction ? 'action' : 'function',
          namespace,
          name,
          qualifiedName: `${namespace}.${name}`,
          isBound: false,
          parameters,
          ...(returnType !== undefined ? { returnType } : {})
        })
      }
    }
  }

  return schema
}

// ============================================================================
// CSDL → EdmSchema parser (JSON-CSDL, v4)
// ============================================================================

/**
 * Parse an OData v4 JSON-CSDL document into the version-agnostic
 * `EdmSchema`.
 *
 * JSON-CSDL replaces the XML element tree with nested objects: each
 * top-level key (other than the `$…` directives) is a namespace whose
 * members are keyed by name. A member is discriminated by its `$Kind`
 * (`EntityType` / `EnumType` / `Action` / `Function` / `EntityContainer`).
 * Properties live as sibling keys on the type object (anything not
 * starting with `$`), with their facets under `$Type` / `$Collection` /
 * `$Nullable`. The shape is documented at
 * https://docs.oasis-open.org/odata/odata-csdl-json/v4.01/.
 */
function parseJsonCsdl(root: Record<string, unknown>): EdmSchema {
  const schema: EdmSchema = {
    version: 'v4', // JSON-CSDL only exists for OData v4.0 / v4.01.
    entityTypes: [],
    enumTypes: [],
    operations: [],
    entitySets: []
  }

  const propertyFromMember = (member: Record<string, unknown>): { type: string; nullable: boolean; collection: boolean } => {
    const isCollection = member['$Collection'] === true
    const type = typeof member['$Type'] === 'string' ? member['$Type'] : 'Edm.String'
    const nullable = member['$Nullable'] !== false
    return { type, nullable, collection: isCollection }
  }

  const parseOperationOverloads = (
    kind: 'action' | 'function',
    name: string,
    namespace: string,
    overloads: unknown
  ): void => {
    // An action/function member is an array of overloads. We import the
    // first overload — Restorm requests don't model overload selection.
    const list: unknown[] = Array.isArray(overloads) ? overloads : []
    const first = list[0]
    if (first === undefined || first === null || typeof first !== 'object') return
    const overload = first as Record<string, unknown>
    const isBound = overload['$IsBound'] === true
    const rawParams = Array.isArray(overload['$Parameter']) ? (overload['$Parameter'] as unknown[]) : []
    const parameters: EdmOperationParameter[] = rawParams
      .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
      .map((p) => {
        const facets = propertyFromMember(p)
        return {
          name: typeof p['$Name'] === 'string' ? p['$Name'] : '',
          type: facets.type,
          nullable: facets.nullable,
          collection: facets.collection
        }
      })
    const bindingType = isBound && parameters[0] ? parameters[0].type : undefined
    const userParameters = isBound ? parameters.slice(1) : parameters
    const returnTypeObj = overload['$ReturnType']
    const returnType = returnTypeObj !== null && typeof returnTypeObj === 'object'
      ? (typeof (returnTypeObj as Record<string, unknown>)['$Type'] === 'string'
          ? ((returnTypeObj as Record<string, unknown>)['$Type'] as string)
          : undefined)
      : undefined
    schema.operations.push({
      kind,
      namespace,
      name,
      qualifiedName: `${namespace}.${name}`,
      isBound,
      parameters: userParameters,
      ...(bindingType !== undefined ? { bindingType } : {}),
      ...(returnType !== undefined ? { returnType } : {})
    })
  }

  for (const [namespace, nsValue] of Object.entries(root)) {
    if (namespace.startsWith('$')) continue // $Version, $EntityContainer, $Reference…
    if (nsValue === null || typeof nsValue !== 'object') continue
    const members = nsValue as Record<string, unknown>

    for (const [memberName, memberValue] of Object.entries(members)) {
      if (memberName.startsWith('$')) continue // $Alias and friends.
      // Actions / functions are arrays of overloads; types are objects.
      if (Array.isArray(memberValue)) {
        const kind = memberValue.find(
          (o): o is Record<string, unknown> => o !== null && typeof o === 'object'
        )?.['$Kind']
        if (kind === 'Action') parseOperationOverloads('action', memberName, namespace, memberValue)
        else if (kind === 'Function') parseOperationOverloads('function', memberName, namespace, memberValue)
        continue
      }
      if (memberValue === null || typeof memberValue !== 'object') continue
      const member = memberValue as Record<string, unknown>
      const memberKind = member['$Kind']

      if (memberKind === 'EntityType') {
        const rawKeys = Array.isArray(member['$Key']) ? (member['$Key'] as unknown[]) : []
        const keys = rawKeys.filter((k): k is string => typeof k === 'string')
        const properties: EdmProperty[] = []
        const navigationProperties: EdmProperty[] = []
        for (const [propName, propValue] of Object.entries(member)) {
          if (propName.startsWith('$')) continue
          if (propValue === null || typeof propValue !== 'object') continue
          const prop = propValue as Record<string, unknown>
          const facets = propertyFromMember(prop)
          const target: EdmProperty = { name: propName, type: facets.type, nullable: facets.nullable, collection: facets.collection }
          if (prop['$Kind'] === 'NavigationProperty') navigationProperties.push(target)
          else properties.push(target)
        }
        schema.entityTypes.push({
          namespace,
          name: memberName,
          qualifiedName: `${namespace}.${memberName}`,
          keys,
          properties,
          navigationProperties
        })
      } else if (memberKind === 'EnumType') {
        const enumMembers: { name: string; value: string }[] = []
        for (const [enumName, enumValue] of Object.entries(member)) {
          if (enumName.startsWith('$')) continue
          enumMembers.push({ name: enumName, value: String(enumValue) })
        }
        schema.enumTypes.push({
          namespace,
          name: memberName,
          qualifiedName: `${namespace}.${memberName}`,
          members: enumMembers
        })
      } else if (memberKind === 'EntityContainer') {
        for (const [setName, setValue] of Object.entries(member)) {
          if (setName.startsWith('$')) continue
          if (setValue === null || typeof setValue !== 'object') continue
          const set = setValue as Record<string, unknown>
          if (set['$Collection'] === true && typeof set['$Type'] === 'string') {
            schema.entitySets.push({ name: setName, entityType: set['$Type'] })
          }
        }
      }
    }
  }

  return schema
}

// ============================================================================
// ODataRequest builders
// ============================================================================

function generateId(seed?: string): string {
  if (!seed) return crypto.randomUUID()
  // The earlier djb2-style hash squeezed every seed into 32 bits,
  // which collides routinely past a few thousand items — a 10k-route
  // Dynamics schema actually produced duplicate ids and crashed the
  // preview render with a React "two children with the same key"
  // warning. SHA-256 has enough entropy for any realistic import
  // size, and keeping the generation deterministic preserves the
  // property that re-importing the same schema yields stable ids.
  const digest = createHash('sha256').update(seed).digest('hex')
  // Shape the digest as a valid v4 UUID: version nibble = 4,
  // variant bits = 10xx (hex `8..b`).
  const variantNibble = ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16)
  return (
    digest.slice(0, 8) +
    '-' + digest.slice(8, 12) +
    '-4' + digest.slice(13, 16) +
    '-' + variantNibble + digest.slice(17, 20) +
    '-' + digest.slice(20, 32)
  )
}

function kvHeader(key: string, value: string): KeyValue {
  return new KeyValue({
    id: generateId(`kv:${key}:${value}`),
    key,
    value: new StringValue(value),
    description: '',
    enabled: true
  })
}

/** Build an entity-set request with the given OData method. GET list
 * operates on `/{set}`, everything key-based on `/{set}({key})`. The
 * URL carries a Handlebars `{{baseUrl}}` placeholder that resolves
 * to the environment's baseUrl variable at send time. */
function buildEntitySetRequest(
  set: EdmEntitySet,
  entity: EdmEntityType | undefined,
  method: 'GET-list' | 'GET-key' | 'POST' | 'PATCH' | 'DELETE',
  version: ODataVersion
): ODataRequest {
  const keyName = entity?.keys[0] ?? 'Id'
  const keyUrl = `({{${keyName.toLowerCase()}}})`
  const displayName: Record<typeof method, string> = {
    'GET-list': `List ${set.name}`,
    'GET-key': `Get ${set.name} by ${keyName}`,
    'POST': `Create ${set.name.replace(/s$/, '') || set.name}`,
    'PATCH': `Update ${set.name.replace(/s$/, '') || set.name}`,
    'DELETE': `Delete ${set.name.replace(/s$/, '') || set.name}`
  }
  const isKeyed = method !== 'GET-list' && method !== 'POST'
  const url = `{{baseUrl}}/${set.name}${isKeyed ? keyUrl : ''}`
  const actionBody = method === 'POST' || method === 'PATCH'
    ? JSON.stringify(defaultBodyForEntity(entity), null, 2)
    : undefined

  const entitySetProperties = entity?.properties.map((p) => p.name) ?? []
  const navigationProperties = entity?.navigationProperties.map((p) => p.name) ?? []

  return new ODataRequest({
    id: generateId(`odata:req:${set.name}:${method}`),
    name: displayName[method],
    url,
    odataVersion: version,
    operationKind: 'entity-set',
    headers: [kvHeader('Accept', 'application/json')],
    params: [],
    queryOptions: {},
    ...(actionBody !== undefined ? { actionBody } : {}),
    ...(entity?.qualifiedName ? { entityTypeRef: entity.qualifiedName } : {}),
    ...(entitySetProperties.length > 0 ? { entitySetProperties } : {}),
    ...(navigationProperties.length > 0 ? { navigationProperties } : {}),
    tags: ['odata', set.name]
  })
}

function defaultBodyForEntity(entity: EdmEntityType | undefined): Record<string, unknown> {
  if (!entity) return {}
  const out: Record<string, unknown> = {}
  for (const prop of entity.properties) {
    if (prop.name === entity.keys[0]) continue // key is in the URL for PATCH
    out[prop.name] = sampleValueForType(prop.type, prop.collection)
  }
  return out
}

function sampleValueForType(type: string, collection: boolean): unknown {
  if (collection) return []
  if (!type.startsWith('Edm.')) return null // complex / enum / entity — caller can fill
  switch (type) {
    case 'Edm.Int16':
    case 'Edm.Int32':
    case 'Edm.Int64':
    case 'Edm.Decimal':
    case 'Edm.Double':
    case 'Edm.Single':
      return 0
    case 'Edm.Boolean':
      return false
    case 'Edm.DateTimeOffset':
    case 'Edm.Date':
    case 'Edm.Time':
    case 'Edm.TimeOfDay':
      return ''
    default:
      return ''
  }
}

function buildActionRequest(op: EdmOperation, version: ODataVersion): ODataRequest {
  // The parser already stripped the binding parameter from
  // `op.parameters`, so everything here is user-supplied.
  const url = op.isBound
    ? `{{baseUrl}}/<BoundEntity>({{key}})/${op.qualifiedName}`
    : `{{baseUrl}}/${op.name}`
  const bodyObj: Record<string, unknown> = {}
  for (const p of op.parameters) {
    bodyObj[p.name] = sampleValueForType(p.type, p.collection)
  }
  const operationParameters = op.parameters.map((p) => ({
    name: p.name,
    type: p.type,
    nullable: p.nullable
  }))
  return new ODataRequest({
    id: generateId(`odata:action:${op.qualifiedName}`),
    name: `Action ${op.name}${op.isBound ? ' (bound)' : ''}`,
    url,
    odataVersion: version,
    operationKind: 'action',
    headers: [kvHeader('Accept', 'application/json')],
    params: [],
    queryOptions: {},
    actionBody: JSON.stringify(bodyObj, null, 2),
    operationParameters,
    tags: ['odata', 'action']
  })
}

function buildFunctionRequest(op: EdmOperation, version: ODataVersion): ODataRequest {
  // Inline parameters into the URL using Handlebars placeholders so
  // the user can fill them via the env: `/Function(name='{{name}}')`.
  // The parser already stripped the binding parameter.
  const inlined = op.parameters
    .map((p) => {
      const placeholder = isStringType(p.type, p.collection) ? `'{{${p.name}}}'` : `{{${p.name}}}`
      return `${p.name}=${placeholder}`
    })
    .join(',')
  const url = op.isBound
    ? `{{baseUrl}}/<BoundEntity>({{key}})/${op.qualifiedName}(${inlined})`
    : `{{baseUrl}}/${op.name}(${inlined})`
  const operationParameters = op.parameters.map((p) => ({
    name: p.name,
    type: p.type,
    nullable: p.nullable
  }))
  return new ODataRequest({
    id: generateId(`odata:function:${op.qualifiedName}`),
    name: `Function ${op.name}${op.isBound ? ' (bound)' : ''}`,
    url,
    odataVersion: version,
    operationKind: 'function',
    headers: [kvHeader('Accept', 'application/json')],
    params: [],
    queryOptions: {},
    operationParameters,
    tags: ['odata', 'function']
  })
}

function isStringType(type: string, collection: boolean): boolean {
  if (collection) return false
  return type === 'Edm.String' || type === 'Edm.Guid'
}

/** Map an Edm primitive type to a short `format` hint surfaced on the
 * property documentation. Drives the `$filter` value-position
 * suggestions (date picker for date/datetime, UUID placeholder for
 * guid, true/false for boolean). Returns `undefined` for types with
 * no special value affordance. */
function edmFormatHint(type: string): string | undefined {
  switch (type) {
    case 'Edm.DateTimeOffset':
      return 'date-time'
    case 'Edm.Date':
      return 'date'
    case 'Edm.TimeOfDay':
    case 'Edm.Time':
      return 'time'
    case 'Edm.Duration':
      return 'duration'
    case 'Edm.Guid':
      return 'uuid'
    case 'Edm.Boolean':
      return 'boolean'
    default:
      return undefined
  }
}

// ============================================================================
// Metadata dispatch (JSON-CSDL vs EDMX XML, version-aware)
// ============================================================================

/**
 * Turn a raw `$metadata` document into an `EdmSchema`, picking the
 * right parser by content shape:
 *   - JSON-CSDL — a JSON object carrying the `$Version` directive,
 *   - EDMX XML — everything else, with the version detected from the
 *     `<edmx:Edmx>` root.
 *
 * `ImportManager.detectFormat` already gates which strings reach the
 * OData adapter, but we re-sniff here so the service is usable
 * stand-alone (unit tests, direct callers) without that gate.
 */
function parseODataMetadata(content: string): EdmSchema {
  const trimmed = content.trim()
  if (trimmed.startsWith('{')) {
    let json: unknown
    try {
      json = JSON.parse(trimmed)
    } catch {
      throw new Error('OData metadata looked like JSON-CSDL but failed to parse as JSON.')
    }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('OData JSON-CSDL metadata must be a JSON object.')
    }
    return parseJsonCsdl(json as Record<string, unknown>)
  }
  const version = parseEdmxVersion(trimmed)
  return parseEdmx(trimmed, version)
}

// ============================================================================
// ApiDocumentation transformer
// ============================================================================

function buildApiDocumentation(
  schema: EdmSchema,
  options: { baseUrl?: string; sourceUrl?: string; apiTitle: string }
): ApiDocumentation {
  // Qualified names of every parsed enum type — used to link an
  // enum-typed property to its enum model so the renderer can offer
  // the allowed values as `$filter` value suggestions.
  const enumQualifiedNames = new Set(schema.enumTypes.map((e) => e.qualifiedName))

  const models: Record<string, ModelDocumentation> = {}
  for (const et of schema.entityTypes) {
    models[et.qualifiedName] = {
      name: et.name,
      type: 'object',
      description: `${et.qualifiedName} (OData entity, key: ${et.keys.join(', ')})`,
      properties: et.properties.map((p) => {
        const prop: PropertyDocumentation = {
          name: p.name,
          type: p.collection ? `Collection(${p.type})` : p.type,
          required: !p.nullable
        }
        // Link enum-typed properties to their enum model so the
        // autocomplete can surface the members as value suggestions.
        if (enumQualifiedNames.has(p.type)) {
          prop.targetModelRef = p.type
          if (p.collection) prop.isArrayOfRef = true
        }
        // Carry a `format` hint for the primitive types whose value
        // position drives a smarter suggestion (date picker, GUID
        // placeholder, true/false). Keeps the doc viewer + the
        // autocomplete in sync without re-parsing the Edm type label.
        const fmt = edmFormatHint(p.type)
        if (fmt) prop.format = fmt
        return prop
      })
    }
  }
  for (const enumType of schema.enumTypes) {
    models[enumType.qualifiedName] = {
      name: enumType.name,
      type: 'enum',
      description: `${enumType.qualifiedName} (OData enum)`,
      enum: enumType.members.map((m) => m.name)
    }
  }

  const operations: OperationDocumentation[] = []
  for (const op of schema.operations) {
    operations.push({
      method: op.kind === 'action' ? 'POST' : 'GET',
      path: `/${op.qualifiedName}`,
      summary: `${op.kind === 'action' ? 'Action' : 'Function'} ${op.name}${op.isBound ? ' (bound)' : ''}`,
      description: op.parameters.length > 0
        ? `Parameters: ${op.parameters.map((p) => `${p.name}: ${p.type}`).join(', ')}`
        : '',
      group: op.kind === 'action' ? 'Actions' : 'Functions'
    })
  }
  for (const set of schema.entitySets) {
    operations.push({
      method: 'GET',
      path: `/${set.name}`,
      summary: `List ${set.name}`,
      description: `Entity set of ${set.entityType}`,
      group: set.name,
      referencedModels: [set.entityType]
    })
  }

  return {
    sourceType: 'odata',
    ...(options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {}),
    api: {
      title: options.apiTitle,
      version: schema.version,
      description: `OData ${schema.version} service with ${schema.entitySets.length} entity sets, ${schema.operations.length} operations.`
    },
    ...(options.baseUrl !== undefined ? { server: { baseUrl: options.baseUrl } } : {}),
    models,
    groups: {},
    operations
  }
}

// ============================================================================
// Public entry points
// ============================================================================

export interface ODataImportOptions {
  /** Override for the generated environment baseUrl. When omitted and
   * `sourceUrl` is provided, the service root is inferred by stripping
   * `/\$metadata` from the URL. */
  baseUrl?: string
  /** Original `$metadata` URL — stored on `ApiDocumentation.sourceUrl`. */
  sourceUrl?: string
  environmentFolder?: EnvironmentFolder
  parentFolder?: Folder
}

/** Strip `/$metadata` (optionally with trailing slash / query) off a
 * metadata URL to derive the OData service root. */
function deriveServiceRoot(url: string): string {
  return url.replace(/\/\$metadata(\/|$|\?.*)/, '')
}

function apiTitleFromSchema(schema: EdmSchema, fallback: string): string {
  const firstNs = schema.entityTypes[0]?.namespace
    ?? schema.enumTypes[0]?.namespace
    ?? schema.operations[0]?.namespace
  return firstNs ?? fallback
}

/** Main entry — synchronously turn a metadata XML string into an
 * `EnvironmentFolder`. Matches the `importSwagger` signature. */
export function importOData(content: string, options: ODataImportOptions = {}): EnvironmentFolder {
  const schema = parseODataMetadata(content)
  const serviceRoot = options.baseUrl
    ?? (options.sourceUrl !== undefined ? deriveServiceRoot(options.sourceUrl) : 'http://localhost/odata')
  const apiTitle = apiTitleFromSchema(schema, 'OData service')

  // --- Environment ---
  const environment: Environment = {
    id: generateId(`env:odata:${apiTitle}`),
    name: 'localhost',
    variables: [
      new KeyValue({
        id: generateId(`kv:baseUrl:${serviceRoot}`),
        key: 'baseUrl',
        value: new StringValue(serviceRoot),
        description: 'OData service root URL',
        enabled: true
      })
    ],
    subEnvironments: []
  }

  // --- Entity-set folders ---
  const entityByQualified = new Map(schema.entityTypes.map((et) => [et.qualifiedName, et]))
  const entitySetFolders: Folder[] = schema.entitySets.map((set) => {
    const entity = entityByQualified.get(set.entityType)
    const items: Folder['items'] = [
      buildEntitySetRequest(set, entity, 'GET-list', schema.version),
      buildEntitySetRequest(set, entity, 'GET-key', schema.version),
      buildEntitySetRequest(set, entity, 'POST', schema.version),
      buildEntitySetRequest(set, entity, 'PATCH', schema.version),
      buildEntitySetRequest(set, entity, 'DELETE', schema.version)
    ]
    return {
      id: generateId(`odata:folder:set:${set.name}`),
      name: set.name,
      tags: ['odata', set.name],
      configuration: {},
      items
    }
  })

  // --- Action / Function folders ---
  const actions = schema.operations.filter((op) => op.kind === 'action')
  const functions = schema.operations.filter((op) => op.kind === 'function')
  const extraFolders: Folder[] = []
  if (actions.length > 0) {
    extraFolders.push({
      id: generateId(`odata:folder:actions:${apiTitle}`),
      name: 'Actions',
      tags: ['odata', 'action'],
      configuration: {},
      items: actions.map((op) => buildActionRequest(op, schema.version))
    })
  }
  if (functions.length > 0) {
    extraFolders.push({
      id: generateId(`odata:folder:functions:${apiTitle}`),
      name: 'Functions',
      tags: ['odata', 'function'],
      configuration: {},
      items: functions.map((op) => buildFunctionRequest(op, schema.version))
    })
  }

  const apiDocumentation = buildApiDocumentation(schema, {
    baseUrl: serviceRoot,
    ...(options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {}),
    apiTitle
  })

  const importedItems = [...entitySetFolders, ...extraFolders]

  // --- Attach into existing folder or create a new root ---
  if (options.environmentFolder) {
    options.environmentFolder.environments = [
      ...options.environmentFolder.environments,
      environment
    ]
    const targetFolder = options.parentFolder ?? options.environmentFolder
    targetFolder.items = [...targetFolder.items, ...importedItems]
    options.environmentFolder.apiDocumentation = apiDocumentation
    return options.environmentFolder
  }

  const root: EnvironmentFolder = {
    folderType: 'environment',
    fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
    id: generateId(`odata:root:${apiTitle}`),
    name: apiTitle,
    // Tag the imported root with the detected protocol version so it is
    // discoverable in the tree without opening a request; per-request
    // behaviour still rides each `ODataRequest.odataVersion`.
    tags: ['odata', `odata:${schema.version}`],
    configuration: {},
    environments: [environment],
    items: importedItems,
    importSource: 'odata',
    apiDocumentation
  }
  return root
}

/** Fetch `$metadata` from a URL and import. */
export async function importODataFromUrl(url: string, options: ODataImportOptions = {}): Promise<EnvironmentFolder> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch OData metadata: ${response.status} ${response.statusText}`)
  }
  const content = await response.text()
  return importOData(content, { ...options, sourceUrl: url })
}

/** Alias mirroring the `importSwaggerFromJson` naming so callers can
 * be symmetric. */
export function importODataFromString(content: string, options: ODataImportOptions = {}): EnvironmentFolder {
  return importOData(content, options)
}
