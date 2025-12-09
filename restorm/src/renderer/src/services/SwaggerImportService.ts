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
  items?: SwaggerSchema
  additionalProperties?: SwaggerSchema
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

/** Generate a unique ID */
function generateId(): string {
  return crypto.randomUUID()
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
  parameters: SwaggerParameter[]
): HTTPRequestBody | undefined {
  // Check for body parameter (JSON/XML body)
  const bodyParam = parameters.find((p) => p.in === 'body')
  if (bodyParam) {
    return {
      type: 'text',
      content: bodyParam.schema?.$ref
        ? `// Reference: ${bodyParam.schema.$ref}\n{}`
        : '{}'
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
          value: ''
        }))
      }
    }

    // Default to x-www-form-urlencoded
    return {
      type: 'x-www-form-urlencoded',
      fields: formDataParams.map((p) => ({
        key: p.name,
        value: ''
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
      value: ''
    }))
}

/** Extract query params from Swagger parameters */
function extractParams(parameters: SwaggerParameter[]): KeyValue[] {
  return parameters
    .filter((p) => p.in === 'query')
    .map((p) => ({
      key: p.name,
      value: ''
    }))
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
  basePath: string
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
    security: operation.security
  })

  const request: HTTPRequest = {
    type: 'http',
    id: generateId(),
    name: operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${path}`,
    documentation: documentation.trim(),
    tags: operation.tags ?? [],
    method: toHTTPMethod(method),
    url: buildUrl(basePath, path, parameters),
    headers: extractHeaders(parameters),
    params: extractParams(parameters)
  }

  const body = extractBody(operation, parameters)
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
    schemes: spec.schemes
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
      id: generateId(),
      name: tag.name,
      documentation: tagDocumentation.trim(),
      tags: [tag.name],
      configuration: { environments: [] },
      items: []
    })
  }

  // Folder for untagged requests
  const untaggedFolder: Folder = {
    id: generateId(),
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

      const request = operationToRequest(path, method, operation, basePath)
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
            id: generateId(),
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
    id: generateId(),
    name: spec.info.title,
    documentation: rootDocumentation.trim(),
    tags: [],
    configuration: {
      environments: [
        {
          id: generateId(),
          name: 'Default',
          variables: [{ key: 'baseUrl', value: defaultBaseUrl }]
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

