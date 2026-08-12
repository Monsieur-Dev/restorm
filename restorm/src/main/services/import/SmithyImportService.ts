/**
 * Service for importing Smithy models (AWS's API modeling IDL) into Restorm
 * collections.
 *
 * Smithy ships two interchangeable representations of the same model:
 *   - the `.smithy` IDL (human-authored)
 *   - the JSON AST produced by `smithy build` (the `smithy/1.0` wire format)
 *
 * This service accepts either. Both parsers converge on the same `SmithyModel`
 * intermediate representation (a namespace + a map of shapes keyed by their
 * simple name) so the rest of the pipeline — HTTP request materialisation,
 * documentation, enum extraction — is written once and shared.
 *
 * The `.smithy` IDL is parsed with a minimal hand-rolled grammar rather than
 * delegating to `@smithy/smithy-to-openapi`: every other IDL-style importer in
 * this codebase (GraphQL SDL, gRPC `.proto`) already follows the
 * self-contained-parser precedent, it avoids taking on a new npm dependency,
 * and — critically — converting to OpenAPI first would throw away trait
 * access (`@httpLabel` / `@httpQuery` / `@httpHeader`, `@error`,
 * `@deprecated`, …) this importer needs to shape the generated requests.
 *
 * Scope (v1): REST-bound operations (the `@http` trait) become executable
 * HTTPRequests; operations without an HTTP binding are documentation-only
 * (they never overflow into a folder item, but are still listed in the
 * generated `apiDocumentation`). SigV4 auth, Smithy protocol tests, non-REST
 * protocol bindings (`awsJson1_1`, …), and shapes other than
 * structure/enum/intEnum/operation/resource/service (lists, maps, unions) are
 * out of scope for v1.
 */

import {
  Folder,
  EnvironmentFolder,
  Environment,
  HTTPRequest,
  KeyValue
} from '../../../shared/models'
import type { EnumDefinition } from '../../../shared/types/collections'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import { toHTTPMethod } from './httpMethodValidator'
import { smithyToApiDocumentation } from './transformers/smithyToApiDocumentation'
import { stableImportId as generateId } from './stableImportId'

// ============================================================================
// Smithy intermediate representation — shared by both parsers
// ============================================================================

interface SmithyHttpTrait {
  method: string
  uri: string
  code?: number
}

interface SmithyTraits {
  http?: SmithyHttpTrait
  httpLabel?: boolean
  httpQuery?: string
  httpHeader?: string
  required?: boolean
  deprecated?: boolean
  error?: 'client' | 'server'
  documentation?: string
  enumValue?: string | number
}

interface SmithyMember {
  name: string
  target: string
  traits: SmithyTraits
}

interface SmithyStructureShape {
  kind: 'structure'
  name: string
  members: SmithyMember[]
  traits: SmithyTraits
}

interface SmithyEnumShape {
  kind: 'enum' | 'intEnum'
  name: string
  members: { name: string; value?: string | number }[]
  traits: SmithyTraits
}

interface SmithyOperationShape {
  kind: 'operation'
  name: string
  input?: string
  output?: string
  errors: string[]
  traits: SmithyTraits
}

interface SmithyServiceShape {
  kind: 'service'
  name: string
  version?: string
  operations: string[]
  resources: string[]
  traits: SmithyTraits
}

interface SmithyResourceShape {
  kind: 'resource'
  name: string
  /** Lifecycle refs (create/read/update/delete/list) + the explicit
   * `operations` list, flattened — the folder builder doesn't need to
   * distinguish the CRUD verb from a custom operation. */
  operations: string[]
  resources: string[]
}

type SmithyShape =
  | SmithyStructureShape
  | SmithyEnumShape
  | SmithyOperationShape
  | SmithyServiceShape
  | SmithyResourceShape

interface SmithyModel {
  namespace?: string
  shapes: Map<string, SmithyShape>
}

// ============================================================================
// Trait parsing shared by the JSON AST + text IDL parsers
// ============================================================================

function findServiceShape(model: SmithyModel): SmithyServiceShape | undefined {
  for (const shape of model.shapes.values()) {
    if (shape.kind === 'service') return shape
  }
  return undefined
}

// ============================================================================
// JSON AST parser (smithy/1.0)
// ============================================================================

interface SmithyAstRef { target: string }
interface SmithyAstShape {
  type: string
  version?: string
  operations?: SmithyAstRef[]
  resources?: SmithyAstRef[]
  create?: SmithyAstRef
  read?: SmithyAstRef
  update?: SmithyAstRef
  delete?: SmithyAstRef
  list?: SmithyAstRef
  input?: SmithyAstRef
  output?: SmithyAstRef
  errors?: SmithyAstRef[]
  members?: Record<string, { target: string; traits?: Record<string, unknown> }>
  traits?: Record<string, unknown>
}

function simpleName(shapeId: string): string {
  const hashIdx = shapeId.indexOf('#')
  return hashIdx === -1 ? shapeId : shapeId.slice(hashIdx + 1)
}

function namespaceOf(shapeId: string): string | undefined {
  const hashIdx = shapeId.indexOf('#')
  return hashIdx === -1 ? undefined : shapeId.slice(0, hashIdx)
}

function extractTraitsFromJson(raw: Record<string, unknown> | undefined): SmithyTraits {
  if (!raw) return {}
  const traits: SmithyTraits = {}
  const http = raw['smithy.api#http'] as { method?: string; uri?: string; code?: number } | undefined
  if (http?.method && http.uri) {
    traits.http = { method: http.method, uri: http.uri, ...(http.code !== undefined ? { code: http.code } : {}) }
  }
  if ('smithy.api#httpLabel' in raw) traits.httpLabel = true
  if (typeof raw['smithy.api#httpQuery'] === 'string') traits.httpQuery = raw['smithy.api#httpQuery']
  if (typeof raw['smithy.api#httpHeader'] === 'string') traits.httpHeader = raw['smithy.api#httpHeader']
  if ('smithy.api#required' in raw) traits.required = true
  if ('smithy.api#deprecated' in raw) traits.deprecated = true
  const errorTrait = raw['smithy.api#error']
  if (errorTrait === 'client' || errorTrait === 'server') traits.error = errorTrait
  if (typeof raw['smithy.api#documentation'] === 'string') traits.documentation = raw['smithy.api#documentation']
  const enumValue = raw['smithy.api#enumValue']
  if (typeof enumValue === 'string' || typeof enumValue === 'number') traits.enumValue = enumValue
  return traits
}

/** Parse the JSON AST produced by `smithy build` (`smithy/1.0` namespace). */
function parseSmithyJsonAst(jsonText: string): SmithyModel {
  const ast = JSON.parse(jsonText) as { smithy: string; shapes?: Record<string, SmithyAstShape> }
  const shapes = new Map<string, SmithyShape>()
  let namespace: string | undefined

  for (const [shapeId, raw] of Object.entries(ast.shapes ?? {})) {
    const ns = namespaceOf(shapeId)
    if (namespace === undefined && ns !== undefined && ns !== 'smithy.api') namespace = ns
    const name = simpleName(shapeId)
    const traits = extractTraitsFromJson(raw.traits)

    switch (raw.type) {
      case 'service':
        shapes.set(name, {
          kind: 'service',
          name,
          ...(raw.version !== undefined ? { version: raw.version } : {}),
          operations: (raw.operations ?? []).map((r) => simpleName(r.target)),
          resources: (raw.resources ?? []).map((r) => simpleName(r.target)),
          traits
        })
        break
      case 'resource': {
        const operations: string[] = []
        for (const key of ['create', 'read', 'update', 'delete', 'list'] as const) {
          const ref = raw[key]
          if (ref) operations.push(simpleName(ref.target))
        }
        operations.push(...(raw.operations ?? []).map((r) => simpleName(r.target)))
        shapes.set(name, {
          kind: 'resource',
          name,
          operations,
          resources: (raw.resources ?? []).map((r) => simpleName(r.target))
        })
        break
      }
      case 'operation':
        shapes.set(name, {
          kind: 'operation',
          name,
          ...(raw.input !== undefined ? { input: simpleName(raw.input.target) } : {}),
          ...(raw.output !== undefined ? { output: simpleName(raw.output.target) } : {}),
          errors: (raw.errors ?? []).map((r) => simpleName(r.target)),
          traits
        })
        break
      case 'structure':
        shapes.set(name, {
          kind: 'structure',
          name,
          members: Object.entries(raw.members ?? {}).map(([memberName, member]) => ({
            name: memberName,
            target: simpleName(member.target),
            traits: extractTraitsFromJson(member.traits)
          })),
          traits
        })
        break
      case 'enum':
      case 'intEnum':
        shapes.set(name, {
          kind: raw.type,
          name,
          members: Object.entries(raw.members ?? {}).map(([memberName, member]) => {
            const memberTraits = extractTraitsFromJson(member.traits)
            return { name: memberName, ...(memberTraits.enumValue !== undefined ? { value: memberTraits.enumValue } : {}) }
          }),
          traits
        })
        break
      default:
        // Scalars, lists, maps, unions — not modeled as first-class shapes in v1.
        break
    }
  }

  return { namespace, shapes }
}

// ============================================================================
// Text IDL parser — minimal grammar covering namespace / traits / structure /
// enum / intEnum / operation / resource / service declarations
// ============================================================================

const BLOCK_KEYWORDS = new Set(['structure', 'operation', 'resource', 'service', 'enum', 'intEnum'])
const SIMPLE_KEYWORDS = new Set([
  'string', 'integer', 'long', 'short', 'byte', 'boolean', 'double', 'float',
  'blob', 'timestamp', 'document', 'bigInteger', 'bigDecimal', 'list', 'map', 'union'
])

function parseTraitLines(lines: string[]): SmithyTraits {
  const traits: SmithyTraits = {}
  for (const line of lines) {
    const match = /^@([\w.#]+)(?:\((.*)\))?$/.exec(line)
    if (!match?.[1]) continue
    const traitName = match[1].split('#').pop() ?? match[1]
    const args = match[2] ?? ''
    switch (traitName) {
      case 'http': {
        const method = /method\s*:\s*"([^"]+)"/.exec(args)?.[1]
        const uri = /uri\s*:\s*"([^"]+)"/.exec(args)?.[1]
        const code = /code\s*:\s*(\d+)/.exec(args)?.[1]
        if (method && uri) traits.http = { method, uri, ...(code !== undefined ? { code: Number(code) } : {}) }
        break
      }
      case 'httpLabel':
        traits.httpLabel = true
        break
      case 'httpQuery': {
        const value = /^"(.*)"$/.exec(args.trim())?.[1]
        if (value !== undefined) traits.httpQuery = value
        break
      }
      case 'httpHeader': {
        const value = /^"(.*)"$/.exec(args.trim())?.[1]
        if (value !== undefined) traits.httpHeader = value
        break
      }
      case 'required':
        traits.required = true
        break
      case 'deprecated':
        traits.deprecated = true
        break
      case 'error': {
        const value = /^"(.*)"$/.exec(args.trim())?.[1]
        if (value === 'client' || value === 'server') traits.error = value
        break
      }
      case 'documentation': {
        const value = /^"([\s\S]*)"$/.exec(args.trim())?.[1]
        if (value !== undefined) traits.documentation = value
        break
      }
      default:
        // Unsupported trait (@pattern, @length, @paginated, @readonly, …) —
        // silently ignored, documented as a known limitation.
        break
    }
  }
  return traits
}

function parseMembers(bodyLines: string[]): SmithyMember[] {
  const members: SmithyMember[] = []
  let pending: string[] = []
  for (const raw of bodyLines) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    if (trimmed.startsWith('///')) {
      pending.push(`@documentation("${trimmed.slice(3).trim()}")`)
      continue
    }
    if (trimmed.startsWith('//')) continue
    if (trimmed.startsWith('@')) {
      pending.push(trimmed)
      continue
    }
    const match = /^(\w+)\s*:\s*([\w.]+)\s*,?\s*$/.exec(trimmed)
    if (match?.[1] && match[2]) {
      members.push({ name: match[1], target: match[2], traits: parseTraitLines(pending) })
      pending = []
    }
  }
  return members
}

function parseEnumMembers(bodyLines: string[]): { name: string; value?: string | number }[] {
  const members: { name: string; value?: string | number }[] = []
  for (const raw of bodyLines) {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('//')) continue
    const match = /^(\w+)(?:\s*=\s*"([^"]*)")?\s*,?\s*$/.exec(trimmed)
    if (match?.[1]) members.push({ name: match[1], ...(match[2] !== undefined ? { value: match[2] } : {}) })
  }
  return members
}

function parseOperationBody(bodyLines: string[]): { input?: string; output?: string; errors: string[] } {
  let input: string | undefined
  let output: string | undefined
  let errors: string[] = []
  for (const raw of bodyLines) {
    const trimmed = raw.trim()
    const inputMatch = /^input\s*:\s*(\w+)/.exec(trimmed)
    if (inputMatch?.[1]) { input = inputMatch[1]; continue }
    const outputMatch = /^output\s*:\s*(\w+)/.exec(trimmed)
    if (outputMatch?.[1]) { output = outputMatch[1]; continue }
    const errorsMatch = /^errors\s*:\s*\[([^\]]*)\]/.exec(trimmed)
    if (errorsMatch?.[1] !== undefined) {
      errors = errorsMatch[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    }
  }
  return { ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}), errors }
}

function parseServiceBody(bodyLines: string[]): { version?: string; operations: string[]; resources: string[] } {
  let version: string | undefined
  let operations: string[] = []
  let resources: string[] = []
  for (const raw of bodyLines) {
    const trimmed = raw.trim()
    const versionMatch = /^version\s*:\s*"([^"]*)"/.exec(trimmed)
    if (versionMatch?.[1] !== undefined) { version = versionMatch[1]; continue }
    const opsMatch = /^operations\s*:\s*\[([^\]]*)\]/.exec(trimmed)
    if (opsMatch?.[1] !== undefined) { operations = opsMatch[1].split(',').map((s) => s.trim()).filter(Boolean); continue }
    const resMatch = /^resources\s*:\s*\[([^\]]*)\]/.exec(trimmed)
    if (resMatch?.[1] !== undefined) { resources = resMatch[1].split(',').map((s) => s.trim()).filter(Boolean) }
  }
  return { ...(version !== undefined ? { version } : {}), operations, resources }
}

function parseResourceBody(bodyLines: string[]): { operations: string[]; resources: string[] } {
  const operations: string[] = []
  const resources: string[] = []
  for (const raw of bodyLines) {
    const trimmed = raw.trim()
    const singularMatch = /^(create|read|update|delete|list)\s*:\s*(\w+)/.exec(trimmed)
    if (singularMatch?.[2]) { operations.push(singularMatch[2]); continue }
    const opsMatch = /^operations\s*:\s*\[([^\]]*)\]/.exec(trimmed)
    if (opsMatch?.[1] !== undefined) { operations.push(...opsMatch[1].split(',').map((s) => s.trim()).filter(Boolean)); continue }
    const resMatch = /^resources\s*:\s*\[([^\]]*)\]/.exec(trimmed)
    if (resMatch?.[1] !== undefined) { resources.push(...resMatch[1].split(',').map((s) => s.trim()).filter(Boolean)) }
  }
  return { operations, resources }
}

function registerShape(shapes: Map<string, SmithyShape>, keyword: string, name: string, bodyLines: string[], traits: SmithyTraits): void {
  switch (keyword) {
    case 'structure':
      shapes.set(name, { kind: 'structure', name, members: parseMembers(bodyLines), traits })
      break
    case 'enum':
    case 'intEnum':
      shapes.set(name, { kind: keyword, name, members: parseEnumMembers(bodyLines), traits })
      break
    case 'operation':
      shapes.set(name, { kind: 'operation', name, ...parseOperationBody(bodyLines), traits })
      break
    case 'service':
      shapes.set(name, { kind: 'service', name, ...parseServiceBody(bodyLines), traits })
      break
    case 'resource':
      shapes.set(name, { kind: 'resource', name, ...parseResourceBody(bodyLines) })
      break
    default:
      break
  }
}

/**
 * Parse a `.smithy` IDL document into the shared `SmithyModel`. Line comments
 * inside string literals aren't supported (a `//` anywhere ends the line) —
 * acceptable for the URIs / trait values this importer needs to read.
 */
function parseSmithyIdl(idl: string): SmithyModel {
  const shapes = new Map<string, SmithyShape>()
  let namespace: string | undefined
  const lines = idl.split(/\r?\n/)
  let pendingTraitLines: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    if (trimmed === '' || trimmed.startsWith('use ') || trimmed.startsWith('$version') || trimmed.startsWith('metadata ') || trimmed === '}') {
      i++
      continue
    }

    const namespaceMatch = /^namespace\s+([\w.]+)/.exec(trimmed)
    if (namespaceMatch?.[1]) { namespace = namespaceMatch[1]; i++; continue }

    if (trimmed.startsWith('///')) {
      pendingTraitLines.push(`@documentation("${trimmed.slice(3).trim()}")`)
      i++
      continue
    }
    if (trimmed.startsWith('//')) { i++; continue }
    if (trimmed.startsWith('@')) { pendingTraitLines.push(trimmed); i++; continue }

    const emptyBodyMatch = /^(\w+)\s+(\w+)\s*\{\s*\}\s*$/.exec(trimmed)
    if (emptyBodyMatch?.[1] && BLOCK_KEYWORDS.has(emptyBodyMatch[1]) && emptyBodyMatch[2]) {
      registerShape(shapes, emptyBodyMatch[1], emptyBodyMatch[2], [], parseTraitLines(pendingTraitLines))
      pendingTraitLines = []
      i++
      continue
    }

    const openMatch = /^(\w+)\s+(\w+)\s*\{\s*$/.exec(trimmed)
    if (openMatch?.[1] && BLOCK_KEYWORDS.has(openMatch[1]) && openMatch[2]) {
      const keyword = openMatch[1]
      const name = openMatch[2]
      const traits = parseTraitLines(pendingTraitLines)
      pendingTraitLines = []

      // Depth-count forward to find the matching close brace — handles
      // single-line nested blocks (e.g. a resource's `identifiers: { … }`).
      let depth = 1
      const bodyLines: string[] = []
      let j = i + 1
      while (j < lines.length && depth > 0) {
        const bodyLine = lines[j] ?? ''
        const opens = (bodyLine.match(/\{/g) ?? []).length
        const closes = (bodyLine.match(/\}/g) ?? []).length
        depth += opens - closes
        if (depth > 0) {
          bodyLines.push(bodyLine)
        } else {
          const closeIdx = bodyLine.lastIndexOf('}')
          const before = bodyLine.slice(0, closeIdx)
          if (before.trim() !== '') bodyLines.push(before)
        }
        j++
      }
      registerShape(shapes, keyword, name, bodyLines, traits)
      i = j
      continue
    }

    const simpleMatch = /^(\w+)\s+(\w+)\s*$/.exec(trimmed)
    if (simpleMatch?.[1] && SIMPLE_KEYWORDS.has(simpleMatch[1])) {
      // Scalars (string/integer/…) aren't modeled as first-class shapes in
      // v1 — only their traits would matter, and none of the traits this
      // importer reads (@http, @required, …) apply to a scalar shape itself.
      pendingTraitLines = []
      i++
      continue
    }

    // Unrecognised construct (`apply`, deeper list/map/union bodies, …) — skip.
    pendingTraitLines = []
    i++
  }

  return { namespace, shapes }
}

// ============================================================================
// Helper Functions — request materialisation
// ============================================================================

function sampleValueForTarget(target: string): unknown {
  switch (target) {
    case 'String': return ''
    case 'Integer': case 'Long': case 'Short': case 'Byte': return 0
    case 'Float': case 'Double': return 0
    case 'Boolean': return false
    case 'Timestamp': return ''
    default: return null
  }
}

/** Convert an operation shape bound to `@http` into an executable
 * HTTPRequest. Returns `undefined` when the operation carries no HTTP
 * binding — those stay documentation-only (surfaced via `apiDocumentation`,
 * never materialised as a folder item). */
function operationToRequest(model: SmithyModel, opName: string, baseUrl: string, collectionName: string): HTTPRequest | undefined {
  const op = model.shapes.get(opName)
  if (op?.kind !== 'operation') return undefined
  const http = op.traits.http
  if (!http) return undefined

  const inputShape = op.input ? model.shapes.get(op.input) : undefined
  const members = inputShape?.kind === 'structure' ? inputShape.members : []

  const pathParams: KeyValue[] = []
  const queryParams: KeyValue[] = []
  const headers: KeyValue[] = []
  const bodyFields: Record<string, unknown> = {}
  let url = `${baseUrl}${http.uri}`

  for (const member of members) {
    if (member.traits.httpLabel) {
      url = url.replace(`{${member.name}}`, `{{${member.name}}}`)
      pathParams.push(createTypedKeyValue({ key: member.name, value: '', enabled: true }))
    } else if (member.traits.httpQuery) {
      queryParams.push(createTypedKeyValue({ key: member.traits.httpQuery, value: '', enabled: true }))
    } else if (member.traits.httpHeader) {
      headers.push(createTypedKeyValue({ key: member.traits.httpHeader, value: '', enabled: true }))
    } else {
      bodyFields[member.name] = sampleValueForTarget(member.target)
    }
  }

  const method = toHTTPMethod(http.method)
  const request: HTTPRequest = {
    type: 'http',
    id: generateId(`${collectionName}:request:smithy:${opName}`),
    name: opName,
    tags: [],
    method,
    url,
    headers,
    params: queryParams,
    pathParams,
    // Anchor for the idempotent refresh pipeline (see `SmithyAdapter`);
    // naturalKey matches `${METHOD} ${uri}` — the spec's own routing key.
    importOrigin: {
      format: 'smithy',
      naturalKey: `${method} ${http.uri}`,
      operationId: opName
    }
  }

  if (op.traits.deprecated) request.deprecated = true

  if (Object.keys(bodyFields).length > 0 && method !== 'GET' && method !== 'HEAD') {
    request.body = { type: 'text', content: JSON.stringify(bodyFields, null, 2) }
  }

  return request
}

function buildResourceFolder(model: SmithyModel, resourceName: string, baseUrl: string, collectionName: string, visited: Set<string>): Folder | undefined {
  if (visited.has(resourceName)) return undefined
  visited.add(resourceName)
  const resource = model.shapes.get(resourceName)
  if (resource?.kind !== 'resource') return undefined

  const items: Folder['items'] = []
  for (const opName of resource.operations) {
    const request = operationToRequest(model, opName, baseUrl, collectionName)
    if (request) items.push(request)
  }
  for (const childName of resource.resources) {
    const childFolder = buildResourceFolder(model, childName, baseUrl, collectionName, visited)
    if (childFolder) items.push(childFolder)
  }
  if (items.length === 0) return undefined

  return { id: generateId(`${collectionName}:folder:smithy:resource:${resourceName}`), name: resourceName, tags: ['resource'], configuration: {}, items }
}

function buildServiceItems(model: SmithyModel, service: SmithyServiceShape, baseUrl: string, collectionName: string): Folder['items'] {
  const items: Folder['items'] = []
  const directRequests = service.operations
    .map((opName) => operationToRequest(model, opName, baseUrl, collectionName))
    .filter((request): request is HTTPRequest => request !== undefined)
  if (directRequests.length > 0) {
    items.push({ id: generateId(`${collectionName}:folder:smithy:operations`), name: 'Operations', tags: [], configuration: {}, items: directRequests })
  }
  const visited = new Set<string>()
  for (const resourceName of service.resources) {
    const folder = buildResourceFolder(model, resourceName, baseUrl, collectionName, visited)
    if (folder) items.push(folder)
  }
  return items
}

/** No `service` shape in the model (a partial import) — surface every
 * standalone operation shape in a flat "Operations" folder. */
function buildFlatItems(model: SmithyModel, baseUrl: string, collectionName: string): Folder['items'] {
  const requests: HTTPRequest[] = []
  for (const shape of model.shapes.values()) {
    if (shape.kind !== 'operation') continue
    const request = operationToRequest(model, shape.name, baseUrl, collectionName)
    if (request) requests.push(request)
  }
  if (requests.length === 0) return []
  return [{ id: generateId(`${collectionName}:folder:smithy:operations`), name: 'Operations', tags: [], configuration: {}, items: requests }]
}

function buildEnumDefinitions(model: SmithyModel): EnumDefinition[] {
  const definitions: EnumDefinition[] = []
  for (const shape of model.shapes.values()) {
    if (shape.kind !== 'enum' && shape.kind !== 'intEnum') continue
    const values = shape.members.map((m) => (m.value !== undefined ? String(m.value) : m.name))
    if (values.length === 0) continue
    definitions.push({ id: generateId(`enum:smithy:${shape.name}`), name: shape.name, values, matchingRules: [] })
  }
  return definitions
}

// ============================================================================
// Main Service
// ============================================================================

export interface SmithyImportOptions {
  /** Base URL for the modeled service. */
  baseUrl?: string
  /** Name for the imported collection (defaults to the service shape's name). */
  name?: string
  /** Original URL the Smithy model was fetched from (stored on ApiDocumentation.sourceUrl). */
  sourceUrl?: string
}

/** Build an `EnvironmentFolder` from an already-parsed `SmithyModel`. */
function importSmithyModel(model: SmithyModel, options: SmithyImportOptions = {}): EnvironmentFolder {
  const service = findServiceShape(model)
  const name = options.name ?? service?.name ?? model.namespace ?? 'Smithy API'
  const baseUrl = options.baseUrl ?? '{{baseUrl}}'

  const items = service ? buildServiceItems(model, service, baseUrl, name) : buildFlatItems(model, baseUrl, name)
  const enumDefinitions = buildEnumDefinitions(model)

  const environment: Environment = {
    id: generateId(`${name}:env:smithy:Default`),
    name: 'Default',
    variables: [createTypedKeyValue({ key: 'baseUrl', value: options.baseUrl ?? 'https://api.example.com', enabled: true })]
  }

  const apiDocumentation = smithyToApiDocumentation(model, {
    name,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {})
  })

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    importSource: 'smithy',
    id: generateId(`${name}:folder:smithy:root`),
    name,
    tags: [],
    configuration: {},
    environments: [environment],
    items,
    apiDocumentation,
    ...(enumDefinitions.length > 0 ? { enumDefinitions } : {})
  }

  return rootFolder
}

function isJsonAstContent(content: string, parsed?: unknown): boolean {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const json = (parsed !== undefined ? parsed : JSON.parse(trimmed)) as Record<string, unknown>
    return typeof json.smithy === 'string'
  } catch {
    return false
  }
}

/** Import a Smithy model — either the JSON AST or the `.smithy` IDL — from a string. */
export function importSmithy(content: string, options: SmithyImportOptions = {}): EnvironmentFolder {
  const model = isJsonAstContent(content) ? parseSmithyJsonAst(content) : parseSmithyIdl(content)
  return importSmithyModel(model, options)
}

/** Alias kept for parity with the other IDL importers (`importGraphQLFromString`, `importGrpcFromString`). */
export function importSmithyFromString(content: string, options: SmithyImportOptions = {}): EnvironmentFolder {
  return importSmithy(content, options)
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function canImport(content: string, filePath?: string, parsed?: unknown): boolean {
  if (filePath?.endsWith('.smithy')) return true
  const trimmed = content.trim()
  if (trimmed.startsWith('{')) return isJsonAstContent(trimmed, parsed)
  return /^\s*\$version\s*:/m.test(trimmed) ||
    (/\bnamespace\s+[\w.]+/.test(trimmed) && /\b(operation|resource|service)\s+\w+\s*\{/.test(trimmed))
}

importProviders.push({ format: 'smithy', canImport, parse: (content, opts) => importSmithy(content, opts) })
