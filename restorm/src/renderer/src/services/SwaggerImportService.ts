/**
 * Service for importing Swagger/OpenAPI specifications into Restorm collections
 */

import Handlebars from 'handlebars'
import type {
  Folder,
  HTTPRequest,
  HTTPMethod,
  HTTPRequestBody,
  KeyValue
} from '../types/collections'

// Import templates as raw strings
import folderTemplate from '../resources/templates/swagger/folder.hbs?raw'
import requestTemplate from '../resources/templates/swagger/request.hbs?raw'
import tagTemplate from '../resources/templates/swagger/tag.hbs?raw'

// ============================================================================
// Swagger Types
// ============================================================================

interface SwaggerContact {
  name?: string
  email?: string
  url?: string
}

interface SwaggerLicense {
  name: string
  url?: string
}

interface SwaggerExternalDocs {
  description?: string
  url: string
}

interface SwaggerInfo {
  title: string
  description?: string
  version: string
  termsOfService?: string
  contact?: SwaggerContact
  license?: SwaggerLicense
}

interface SwaggerTag {
  name: string
  description?: string
  externalDocs?: SwaggerExternalDocs
}

interface SwaggerParameter {
  name: string
  in: 'query' | 'header' | 'path' | 'formData' | 'body'
  description?: string
  required?: boolean
  type?: string
  format?: string
  schema?: SwaggerSchema
}

interface SwaggerSchema {
  $ref?: string
  type?: string
  description?: string
  format?: string
  items?: SwaggerSchema
  additionalProperties?: SwaggerSchema
  properties?: Record<string, SwaggerSchema>
  required?: string[]
  enum?: string[]
}

interface SwaggerResponseHeader {
  type: string
  format?: string
  description?: string
}

interface SwaggerResponse {
  description: string
  schema?: SwaggerSchema
  headers?: Record<string, SwaggerResponseHeader>
}

interface SwaggerOperation {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  consumes?: string[]
  produces?: string[]
  parameters?: SwaggerParameter[]
  responses?: Record<string, SwaggerResponse>
  security?: Record<string, string[]>[]
  deprecated?: boolean
  externalDocs?: SwaggerExternalDocs
}

interface SwaggerPathItem {
  get?: SwaggerOperation
  post?: SwaggerOperation
  put?: SwaggerOperation
  delete?: SwaggerOperation
  patch?: SwaggerOperation
  head?: SwaggerOperation
  options?: SwaggerOperation
}

interface SwaggerSpec {
  swagger: string
  info: SwaggerInfo
  host?: string
  basePath?: string
  schemes?: string[]
  tags?: SwaggerTag[]
  paths: Record<string, SwaggerPathItem>
  definitions?: Record<string, SwaggerSchema>
  externalDocs?: SwaggerExternalDocs
}

// ============================================================================
// Compiled Templates
// ============================================================================

const compiledFolderTemplate = Handlebars.compile(folderTemplate)
const compiledRequestTemplate = Handlebars.compile(requestTemplate)
const compiledTagTemplate = Handlebars.compile(tagTemplate)

// ============================================================================
// Helper Functions
// ============================================================================

/** Resolve a JSON pointer reference (e.g. "#/definitions/Pet") into a schema */
function resolveSchemaRef(ref: string, spec: SwaggerSpec): SwaggerSchema | undefined {
  if (!ref.startsWith('#/')) return undefined

  const path = ref.slice(2).split('/')
  let current: unknown = spec as unknown

  for (const segment of path) {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }

  return current as SwaggerSchema
}

/** Extract a human‑readable name from a JSON reference (e.g. "#/definitions/User" -> "User") */
function getRefName(ref: string): string {
  const segments = ref.split('/')
  return segments[segments.length - 1] ?? ref
}

interface SchemaPropertyDocumentation {
  name: string
  type?: string | undefined
  description?: string | undefined
  required: boolean
}

interface SchemaDefinitionDocumentation {
  ref: string
  name: string
  description?: string | undefined
  properties: SchemaPropertyDocumentation[]
  /** Mermaid classDiagram for this schema */
  mermaidDiagram?: string
}

/** Build a readable type label for a schema (used in documentation tables) */
function getSchemaTypeLabel(schema: SwaggerSchema, depth = 0): string {
  if (depth > 5) {
    return '...'
  }

  if (schema.$ref) {
    return getRefName(schema.$ref)
  }

  if (schema.type === 'array' && schema.items) {
    return `array<${getSchemaTypeLabel(schema.items, depth + 1)}>`
  }

  if (schema.type) {
    return schema.type
  }

  if (schema.properties) {
    return 'object'
  }

  return 'any'
}

/** Build documentation objects for all schemas referenced by an operation */
function buildSchemaDefinitionsForOperation(
  operation: SwaggerOperation,
  spec: SwaggerSpec
): SchemaDefinitionDocumentation[] {
  const refs = new Set<string>()

  for (const parameter of operation.parameters ?? []) {
    const ref = parameter.schema?.$ref
    if (ref) {
      refs.add(ref)
    }
  }

  for (const response of Object.values(operation.responses ?? {})) {
    const ref = response.schema?.$ref
    if (ref) {
      refs.add(ref)
    }
  }

  const definitions: SchemaDefinitionDocumentation[] = []

  for (const ref of refs) {
    const schema = resolveSchemaRef(ref, spec)
    if (!schema) continue

    const required = new Set(schema.required ?? [])
    const properties: SchemaPropertyDocumentation[] = []

    for (const [propName, propSchema] of Object.entries(schema.properties ?? {})) {
      properties.push({
        name: propName,
        type: getSchemaTypeLabel(propSchema),
        description: propSchema.description,
        required: required.has(propName)
      })
    }

    const definition: SchemaDefinitionDocumentation = {
      ref,
      name: getRefName(ref),
      description: schema.description,
      properties
    }

    // Build a Mermaid UML class diagram for this schema
    if (properties.length > 0) {
      const classLines: string[] = []
      classLines.push('classDiagram')
      classLines.push(`  class ${definition.name} {`)

      for (const prop of properties) {
        const typeLabel = prop.type ?? 'any'
        const visibility = prop.required ? '+' : '-'
        const optionalSuffix = prop.required ? '' : '?'
        // Example: "+ id : integer" (required) or "- username? : string" (optional)
        classLines.push(`    ${visibility} ${prop.name}${optionalSuffix} : ${typeLabel}`)
      }

      classLines.push('  }')
      definition.mermaidDiagram = classLines.join('\n')
    }

    definitions.push(definition)
  }

  return definitions
}

/** Build a sample JSON value matching the given schema (structure only, simple default values) */
function schemaToSample(
  schema: SwaggerSchema,
  spec: SwaggerSpec,
  depth = 0,
  seenRefs: Set<string> = new Set<string>()
): unknown {
  // Prevent infinite recursion on circular refs
  if (depth > 5) return null

  let workingSchema: SwaggerSchema = schema

  if (schema.$ref) {
    if (seenRefs.has(schema.$ref)) {
      return null
    }
    seenRefs.add(schema.$ref)
    const resolved = resolveSchemaRef(schema.$ref, spec)
    if (resolved) {
      workingSchema = resolved
    }
  }

  const inferredType =
    workingSchema.type ??
    (workingSchema.properties ? 'object' : workingSchema.items ? 'array' : 'string')

  switch (inferredType) {
    case 'object': {
      const result: Record<string, unknown> = {}
      const props = workingSchema.properties ?? {}
      for (const [propName, propSchema] of Object.entries(props)) {
        result[propName] = schemaToSample(propSchema, spec, depth + 1, new Set(seenRefs))
      }

      // If object has only additionalProperties, add a placeholder key
      if (!Object.keys(result).length && workingSchema.additionalProperties) {
        result['exampleKey'] = schemaToSample(
          workingSchema.additionalProperties,
          spec,
          depth + 1,
          new Set(seenRefs)
        )
      }

      return result
    }
    case 'array': {
      const itemSchema = workingSchema.items ?? { type: 'string' }
      return [schemaToSample(itemSchema, spec, depth + 1, new Set(seenRefs))]
    }
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'string':
    default: {
      if (workingSchema.enum && workingSchema.enum.length > 0) {
        return workingSchema.enum[0]
      }
      return ''
    }
  }
}

/** Generate a deterministic ID from a seed string using a simple hash */
function generateId(seed?: string): string {
  if (!seed) {
    return crypto.randomUUID()
  }
  // Simple hash function to create deterministic ID from seed
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  // Convert to hex and pad to ensure consistent format
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `${hex}-${seed.length.toString(16).padStart(4, '0')}-4000-8000-${hex}${hex.slice(0, 4)}`
}

/**
 * Build a global Mermaid class diagram for all models defined in the spec.
 * Shows one class per definition with its properties and relations for properties using $ref.
 */
function buildGlobalModelsDiagram(spec: SwaggerSpec): string | undefined {
  const definitions = spec.definitions ?? {}
  const entries = Object.entries(definitions)

  if (entries.length === 0) {
    return undefined
  }

  const lines: string[] = ['classDiagram']
  const relationLines = new Set<string>()

  for (const [name, schema] of entries) {
    const props = schema.properties ?? {}
    const required = new Set(schema.required ?? [])

    if (Object.keys(props).length > 0) {
      // Class with properties
      lines.push(`  class ${name} {`)

      for (const [propName, propSchema] of Object.entries(props)) {
        const typeLabel = getSchemaTypeLabel(propSchema)
        const isRequired = required.has(propName)
        const visibility = isRequired ? '+' : '-'
        const optionalSuffix = isRequired ? '' : '?'
        // Example: "+ id : integer" (required) or "- username? : string" (optional)
        lines.push(`    ${visibility} ${propName}${optionalSuffix} : ${typeLabel}`)

        // Track relations for referenced models
        if (propSchema.$ref) {
          const target = getRefName(propSchema.$ref)
          relationLines.add(`  ${name} --> ${target}`)
        } else if (propSchema.type === 'array' && propSchema.items?.$ref) {
          const target = getRefName(propSchema.items.$ref)
          relationLines.add(`  ${name} --> ${target}`)
        }
      }

      lines.push('  }')
    } else {
      // Class without explicit properties
      lines.push(`  class ${name}`)
    }
  }

  for (const rel of relationLines) {
    lines.push(rel)
  }

  return lines.join('\n')
}

/** Convert Swagger HTTP method to HTTPMethod type */
function toHTTPMethod(method: string): HTTPMethod {
  const upper = method.toUpperCase()
  const validMethods: HTTPMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  if (validMethods.includes(upper as HTTPMethod)) {
    return upper as HTTPMethod
  }
  return 'GET'
}

/** Extract body from Swagger parameters */
function extractBody(
  operation: SwaggerOperation,
  parameters: SwaggerParameter[],
  spec: SwaggerSpec
): HTTPRequestBody | undefined {
  // Check for body parameter (JSON/XML body)
  const bodyParam = parameters.find((p) => p.in === 'body')
  if (bodyParam) {
    let content = '{}'

    if (bodyParam.schema) {
      const sampleValue = schemaToSample(bodyParam.schema, spec)
      const json = JSON.stringify(sampleValue ?? {}, null, 2)
      content = json
    }

    return {
      type: 'text',
      content
    }
  }

  // Check for formData parameters
  const formDataParams = parameters.filter((p) => p.in === 'formData')
  if (formDataParams.length > 0) {
    const consumes = operation.consumes ?? []

    // Check if multipart/form-data
    if (consumes.includes('multipart/form-data')) {
      return {
        type: 'form-data',
        fields: formDataParams.map((p) => ({
          key: p.name,
          value: '',
          description: p.description
        }))
      }
    }

    // Default to x-www-form-urlencoded
    return {
      type: 'x-www-form-urlencoded',
      fields: formDataParams.map((p) => ({
        key: p.name,
        value: '',
        description: p.description
      }))
    }
  }

  return undefined
}

/** Extract headers from Swagger parameters */
function extractHeaders(parameters: SwaggerParameter[]): KeyValue[] {
  return parameters
    .filter((p) => p.in === 'header')
    .map((p) => ({
      key: p.name,
      value: '',
      description: p.description
    }))
}

/** Extract query params from Swagger parameters */
function extractParams(parameters: SwaggerParameter[]): KeyValue[] {
  const result: KeyValue[] = []

  for (const param of parameters) {
    if (param.in !== 'query') {
      continue
    }

    // Avoid duplicate keys if the same parameter is defined multiple times
    if (result.some((existing) => existing.key === param.name)) {
      continue
    }

    result.push({
      key: param.name,
      value: '',
      description: param.description
    })
  }

  return result
}

/** Extract path params from Swagger parameters */
function extractPathParams(parameters: SwaggerParameter[]): KeyValue[] {
  const result: KeyValue[] = []

  for (const param of parameters) {
    if (param.in !== 'path') {
      continue
    }

    // Avoid duplicate keys if the same parameter is defined multiple times
    if (result.some((existing) => existing.key === param.name)) {
      continue
    }

    result.push({
      key: param.name,
      value: '',
      description: param.description
    })
  }

  return result
}

/** Build URL with path parameters as placeholders */
function buildUrl(basePath: string, path: string, parameters: SwaggerParameter[]): string {
  let url = `{{baseUrl}}${basePath}${path}`

  // Replace path parameters with environment variable placeholders
  const pathParams = parameters.filter((p) => p.in === 'path')
  for (const param of pathParams) {
    url = url.replace(`{${param.name}}`, `{{${param.name}}}`)
  }

  return url
}

/** Convert a Swagger operation to an HTTPRequest */
function operationToRequest(
  path: string,
  method: string,
  operation: SwaggerOperation,
  basePath: string,
  spec: SwaggerSpec
): HTTPRequest {
  const parameters = operation.parameters ?? []

  const documentation = compiledRequestTemplate({
    summary: operation.summary ?? `${method.toUpperCase()} ${path}`,
    description: operation.description,
    operationId: operation.operationId,
    deprecated: operation.deprecated,
    externalDocs: operation.externalDocs,
    consumes: operation.consumes,
    produces: operation.produces,
    parameters: parameters,
    responses: operation.responses,
    security: operation.security,
    schemaDefinitions: buildSchemaDefinitionsForOperation(operation, spec)
  })

  const request: HTTPRequest = {
    type: 'http',
    id: generateId(`request:${method}:${path}`),
    name: operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${path}`,
    documentation: documentation.trim(),
    tags: operation.tags ?? [],
    method: toHTTPMethod(method),
    url: buildUrl(basePath, path, parameters),
    headers: extractHeaders(parameters),
    params: extractParams(parameters),
    pathParams: extractPathParams(parameters)
  }

  const body = extractBody(operation, parameters, spec)
  if (body) {
    request.body = body
  }

  return request
}

// ============================================================================
// Main Service
// ============================================================================

export interface SwaggerImportOptions {
  /** Base URL to use for requests (defaults to scheme + host from spec) */
  baseUrl?: string
}

/**
 * Import a Swagger/OpenAPI 2.0 specification and convert it to a Folder structure
 */
export function importSwagger(spec: SwaggerSpec, options: SwaggerImportOptions = {}): Folder {
  const basePath = spec.basePath ?? ''
  const defaultScheme = spec.schemes?.[0] ?? 'https'
  const defaultHost = spec.host ?? 'localhost'
  const defaultBaseUrl = options.baseUrl ?? `${defaultScheme}://${defaultHost}`

  // Build documentation for root folder
  const rootDocumentation = compiledFolderTemplate({
    title: spec.info.title,
    description: spec.info.description,
    version: spec.info.version,
    termsOfService: spec.info.termsOfService,
    contact: spec.info.contact,
    license: spec.info.license,
    externalDocs: spec.externalDocs,
    host: spec.host,
    basePath: spec.basePath,
    schemes: spec.schemes,
    modelsDiagram: buildGlobalModelsDiagram(spec)
  })

  // Create tag folders map
  const tagFolders = new Map<string, Folder>()

  // Create folders for each tag
  for (const tag of spec.tags ?? []) {
    const tagDocumentation = compiledTagTemplate({
      name: tag.name,
      description: tag.description,
      externalDocs: tag.externalDocs
    })

    tagFolders.set(tag.name, {
      id: generateId(`folder:tag:${tag.name}`),
      name: tag.name,
      documentation: tagDocumentation.trim(),
      tags: [tag.name],
      configuration: { environments: [] },
      items: []
    })
  }

  // Folder for untagged requests
  const untaggedFolder: Folder = {
    id: generateId('folder:untagged:Other'),
    name: 'Other',
    documentation: 'Requests without tags',
    tags: [],
    configuration: { environments: [] },
    items: []
  }

  // Process all paths and operations
  const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of httpMethods) {
      const operation = pathItem[method]
      if (!operation) continue

      const request = operationToRequest(path, method, operation, basePath, spec)
      const tags = operation.tags ?? []

      if (tags.length === 0) {
        // Add to untagged folder
        untaggedFolder.items.push(request)
      } else {
        // Add to the first tag's folder (create if doesn't exist)
        const tagName = tags[0]
        if (!tagName) continue

        let folder = tagFolders.get(tagName)

        if (!folder) {
          // Create folder for tag not defined in tags array
          folder = {
            id: generateId(`folder:tag:${tagName}`),
            name: tagName,
            documentation: `# ${tagName}`,
            tags: [tagName],
            configuration: { environments: [] },
            items: []
          }
          tagFolders.set(tagName, folder)
        }

        folder.items.push(request)
      }
    }
  }

  // Build root folder items
  const items: Folder['items'] = []

  // Add tag folders with requests
  for (const folder of tagFolders.values()) {
    if (folder.items.length > 0) {
      items.push(folder)
    }
  }

  // Add untagged folder if it has requests
  if (untaggedFolder.items.length > 0) {
    items.push(untaggedFolder)
  }

  // Create root folder with environment for baseUrl
  const rootFolder: Folder = {
    id: generateId(`folder:root:${spec.info.title}`),
    name: spec.info.title,
    documentation: rootDocumentation.trim(),
    tags: [],
    configuration: {
      environments: [
        {
          id: generateId(`env:root:Default`),
          name: 'Default',
          variables: [{ key: 'baseUrl', value: defaultBaseUrl }],
          subEnvironments:
            spec.info.title === 'Swagger Petstore'
              ? [
                  {
                    id: generateId('env:root:Default:Production'),
                    name: 'Production',
                    variables: [{ key: 'baseUrl', value: 'https://petstore.com' }]
                  }
                ]
              : []
        }
      ]
    },
    items
  }

  return rootFolder
}

/**
 * Fetch and import a Swagger specification from a URL
 */
export async function importSwaggerFromUrl(
  url: string,
  options: SwaggerImportOptions = {}
): Promise<Folder> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch Swagger spec: ${response.status} ${response.statusText}`)
  }

  const spec = (await response.json()) as SwaggerSpec
  return importSwagger(spec, options)
}

/**
 * Import a Swagger specification from a JSON string
 */
export function importSwaggerFromJson(json: string, options: SwaggerImportOptions = {}): Folder {
  const spec = JSON.parse(json) as SwaggerSpec
  return importSwagger(spec, options)
}
