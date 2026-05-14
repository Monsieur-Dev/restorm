/**
 * ODataImportService — parse an OData $metadata document (EDMX CSDL)
 * and generate an `EnvironmentFolder` full of ready-to-run OData
 * requests, one sub-folder per entity set (CRUD) plus `Actions` and
 * `Functions` sub-folders.
 *
 * Phase 1 covers v4 EDMX XML only. v2/v3 CSDL and JSON-CSDL land in
 * a follow-up. Parsing is regex-based — EDMX is well-structured and
 * SOAP's WSDL importer already shows the pattern works at scale, so
 * we avoid pulling in a new XML dependency.
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
  OperationDocumentation
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
// CSDL → EdmSchema parser (v4 XML)
// ============================================================================

function parseEdmxV4(xml: string): EdmSchema {
  const edmxMatch = /<edmx:Edmx\b[^>]*\bVersion="([^"]+)"/i.exec(xml)
  const version: ODataVersion = edmxMatch?.[1] === '4.0' ? 'v4' : 'v4'

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

    // --- Entity sets ---
    for (const container of findTags(block.body, 'EntityContainer')) {
      for (const es of findTags(container.body, 'EntitySet')) {
        const name = es.attrs['Name'] ?? ''
        const entityType = es.attrs['EntityType'] ?? ''
        if (name && entityType) {
          schema.entitySets.push({ name, entityType })
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

// ============================================================================
// ApiDocumentation transformer
// ============================================================================

function buildApiDocumentation(
  schema: EdmSchema,
  options: { baseUrl?: string; sourceUrl?: string; apiTitle: string }
): ApiDocumentation {
  const models: Record<string, ModelDocumentation> = {}
  for (const et of schema.entityTypes) {
    models[et.qualifiedName] = {
      name: et.name,
      type: 'object',
      description: `${et.qualifiedName} (OData entity, key: ${et.keys.join(', ')})`,
      properties: et.properties.map((p) => ({
        name: p.name,
        type: p.collection ? `Collection(${p.type})` : p.type,
        required: !p.nullable
      }))
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
  const schema = parseEdmxV4(content)
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
    tags: ['odata'],
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
