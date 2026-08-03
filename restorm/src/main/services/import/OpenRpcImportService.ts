/**
 * Service for importing OpenRPC documents into Restorm collections.
 *
 * OpenRPC (https://spec.open-rpc.org/) is the OpenAPI-equivalent spec for
 * JSON-RPC 2.0 APIs: a JSON document declaring `methods` (name + params +
 * result, each described by a JSON Schema Content Descriptor) plus `servers`
 * (the endpoint(s) to call). This importer produces one `JsonRpcRequest` per
 * method, with a sample `params` value built from each method's schema.
 *
 * v1 scope (per the ticket's own risk note): primitive types + one level of
 * `$ref` resolution against `components.schemas`. Deeply nested / recursive
 * schemas fall back to `null` rather than looping — good enough for a
 * runnable starting point the user edits from, which is the same bar the
 * other schema-driven importers (gRPC's `buildSampleMessage`, GraphQL's
 * placeholder args) hold themselves to.
 */

import {
  Folder,
  EnvironmentFolder,
  Environment,
  JsonRpcRequest
} from '../../../shared/models'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'

// ============================================================================
// OpenRPC Types (subset — v1 scope)
// ============================================================================

interface JsonSchemaLike {
  $ref?: string
  type?: string
  properties?: Record<string, JsonSchemaLike>
  items?: JsonSchemaLike
  enum?: unknown[]
  default?: unknown
  example?: unknown
}

interface ContentDescriptorLike {
  name: string
  schema?: JsonSchemaLike
  required?: boolean
}

interface OpenRpcMethod {
  name: string
  summary?: string
  description?: string
  params?: ContentDescriptorLike[]
  result?: ContentDescriptorLike
  paramStructure?: 'by-position' | 'by-name' | 'either'
  deprecated?: boolean
}

interface OpenRpcServer {
  name?: string
  url: string
}

interface OpenRpcDocument {
  openrpc: string
  info?: { title?: string; version?: string }
  servers?: OpenRpcServer[]
  methods: OpenRpcMethod[]
  components?: { schemas?: Record<string, JsonSchemaLike> }
}

// ============================================================================
// Schema resolution + sample value generation
// ============================================================================

/** Follow one `#/components/schemas/<Name>` hop. OpenRPC (like OpenAPI) only
 * ever refs into `components.schemas`, so a single lookup — no general JSON
 * Pointer walk — covers the spec's actual ref shape. */
function resolveRef(schema: JsonSchemaLike | undefined, schemas: Record<string, JsonSchemaLike>): JsonSchemaLike | undefined {
  if (!schema?.$ref) return schema
  const name = schema.$ref.replace(/^#\/components\/schemas\//, '')
  return schemas[name]
}

/** Build a JSON-serialisable sample value from a schema — enough to produce
 * a runnable request body, not a full JSON Schema example generator.
 * `depth` guards self-referential / deeply nested object schemas: past the
 * cap, an object/array collapses to `null` rather than recursing forever. */
function sampleValueForSchema(schema: JsonSchemaLike | undefined, schemas: Record<string, JsonSchemaLike>, depth = 0): unknown {
  const resolved = resolveRef(schema, schemas)
  if (!resolved) return null
  if (resolved.example !== undefined) return resolved.example
  if (resolved.default !== undefined) return resolved.default
  if (resolved.enum && resolved.enum.length > 0) return resolved.enum[0]
  if (depth > 4) return null

  switch (resolved.type) {
    case 'string':
      return ''
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    case 'array':
      return resolved.items ? [sampleValueForSchema(resolved.items, schemas, depth + 1)] : []
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [key, propSchema] of Object.entries(resolved.properties ?? {})) {
        out[key] = sampleValueForSchema(propSchema, schemas, depth + 1)
      }
      return out
    }
    default:
      // No `type` (e.g. a bare `$ref` already resolved, or an
      // under-specified schema) — properties still drive an object
      // shape when present, else there's nothing to sample.
      return resolved.properties ? sampleValueForSchema({ ...resolved, type: 'object' }, schemas, depth) : null
  }
}

/** Compose a method's `params` as either a positional array or a named
 * object, per its `paramStructure` (defaulting to `by-position`, the
 * classic JSON-RPC shape, when the spec leaves it as `either` or unset). */
function buildSampleParams(method: OpenRpcMethod, schemas: Record<string, JsonSchemaLike>): unknown {
  const params = method.params ?? []
  if (method.paramStructure === 'by-name') {
    const out: Record<string, unknown> = {}
    for (const p of params) out[p.name] = sampleValueForSchema(p.schema, schemas)
    return out
  }
  return params.map((p) => sampleValueForSchema(p.schema, schemas))
}

// ============================================================================
// Request construction
// ============================================================================

function methodToRequest(method: OpenRpcMethod, url: string, schemas: Record<string, JsonSchemaLike>, collectionName: string): JsonRpcRequest {
  const params = buildSampleParams(method, schemas)
  return JsonRpcRequest.fromPlain({
    id: generateId(`${collectionName}:jsonrpc:${method.name}`),
    name: method.name,
    documentation: method.description ?? method.summary ?? '',
    url,
    headers: [],
    method: method.name,
    params: JSON.stringify(params, null, 2),
    rpcId: '',
    deprecated: method.deprecated === true,
    // Anchor for the idempotent refresh pipeline (see `OpenRpcAdapter`);
    // naturalKey is the method name — OpenRPC's own uniqueness constraint
    // makes it the spec's natural dispatch key, same role `service/method`
    // plays for gRPC.
    importOrigin: {
      format: 'openrpc',
      naturalKey: method.name
    }
  })
}

// ============================================================================
// Main Service
// ============================================================================

export interface OpenRpcImportOptions {
  /** Base URL override — falls back to the document's first `servers[].url`. */
  baseUrl?: string
  /** Name for the imported collection — falls back to `info.title`. */
  name?: string
  /** Original URL the document was fetched from. */
  sourceUrl?: string
}

/** Import an OpenRPC JSON document and convert it to an `EnvironmentFolder`
 * of one `JsonRpcRequest` per method, grouped under a single "Methods"
 * folder (OpenRPC has no service/namespace concept to group by). */
export function importOpenRpc(content: string, options: OpenRpcImportOptions = {}): EnvironmentFolder {
  const doc = JSON.parse(content) as OpenRpcDocument
  const name = options.name ?? doc.info?.title ?? 'JSON-RPC API'
  const baseUrl = options.baseUrl ?? doc.servers?.[0]?.url ?? '{{baseUrl}}'
  const schemas = doc.components?.schemas ?? {}
  const methods = doc.methods

  const methodsFolder: Folder = {
    id: generateId(`${name}:folder:jsonrpc:methods`),
    name: 'Methods',
    tags: [],
    configuration: {},
    items: methods.map((m) => methodToRequest(m, baseUrl, schemas, name))
  }

  const environment: Environment = {
    id: generateId(`${name}:env:jsonrpc:Default`),
    name: 'Default',
    variables: [
      createTypedKeyValue({ key: 'baseUrl', value: options.baseUrl ?? doc.servers?.[0]?.url ?? 'http://localhost:8080', enabled: true })
    ]
  }

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    importSource: 'openrpc',
    id: generateId(`${name}:folder:jsonrpc:root`),
    name,
    tags: [],
    configuration: {},
    environments: [environment],
    items: [methodsFolder]
  }

  return rootFolder
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Generate a deterministic ID from a seed string — same scheme every other
 * `*ImportService.ts` uses, so re-importing the same document is idempotent
 * at the id level (a request keeps its id across refreshes). */
function generateId(seed?: string): string {
  if (!seed) {
    return crypto.randomUUID()
  }
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `${hex}-${seed.length.toString(16).padStart(4, '0')}-4000-8000-${hex}${hex.slice(0, 4)}`
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function canImport(content: string, filePath?: string, parsed?: unknown): boolean {
  if (filePath?.endsWith('openrpc.json')) return true
  try {
    const json: unknown = parsed !== undefined ? parsed : JSON.parse(content)
    return !!json && typeof json === 'object' && 'openrpc' in json && 'methods' in json
  } catch {
    return false
  }
}

importProviders.push({ format: 'openrpc', canImport, parse: (content, opts) => importOpenRpc(content, opts) })
