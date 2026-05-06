/**
 * Common structured documentation format for imported API specs.
 *
 * All import formats (Swagger, WSDL, gRPC, GraphQL, AsyncAPI, Postman, Insomnia, Bruno,
 * etc.) are transformed into this shape by dedicated transformers. The result is stored
 * once on the root `EnvironmentFolder.apiDocumentation`; per-route markdown is compiled
 * on the fly from this structure via Handlebars templates (see DocumentationCompiler).
 *
 * The format is intentionally extensible: the `extra` map on operations accommodates
 * protocol-specific data (Postman auth, Bruno scripts, etc.) without polluting the
 * common core, and new sub-types can be added without breaking existing consumers.
 */

/** Contact info for the API provider. */
export interface ApiContact {
  name?: string
  email?: string
  url?: string
}

/** License under which the API is distributed. */
export interface ApiLicense {
  name?: string
  url?: string
}

/** A pointer to external documentation for an API, group or operation. */
export interface ExternalDocs {
  description?: string
  url: string
}

/** Global API information (title, version, contact, license, etc.). */
export interface ApiInfo {
  title: string
  description?: string
  version?: string
  contact?: ApiContact
  license?: ApiLicense
  termsOfService?: string
  externalDocs?: ExternalDocs
}

/** Connection info: host, base path, schemes, XML namespace, etc. */
export interface ApiServer {
  host?: string
  basePath?: string
  schemes?: string[]
  /** WSDL target namespace. */
  namespace?: string
}

/** Validation / shape constraints carried over from the source schema.
 * Used for documentation only — the import pipeline does not enforce
 * them at runtime.
 *
 * `exclusiveMinimum` / `exclusiveMaximum` accept both `boolean` and
 * `number`: Swagger 2.0 + OAS 3.0 use a boolean flag *combined* with
 * the sibling `minimum` / `maximum`, while OAS 3.1 inlines the
 * threshold as a number. Both semantics are carried verbatim — the
 * doc renderer is responsible for interpreting them per the source
 * spec version (available on `ApiDocumentation.sourceType`). */
export interface SchemaConstraints {
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  exclusiveMinimum?: boolean | number
  exclusiveMaximum?: boolean | number
  pattern?: string
  multipleOf?: number
  uniqueItems?: boolean
}

/** A single property on a documented model (Swagger definition, gRPC message, GraphQL type...). */
export interface PropertyDocumentation {
  name: string
  type: string
  required: boolean
  description?: string
  /** Property is marked deprecated in the source spec, or carried
   * forward as deprecated across re-imports. */
  deprecated?: boolean
  /** Property no longer appears in the most recently fetched spec.
   * Cleared back to `false` (or removed) on reappearance. */
  removed?: boolean
  /** Name of the model referenced when the property's schema is a
   * direct `$ref` (`Pet`) or an array of `$ref`s (`array<Pet>`).
   * Drives the relationship diagram + clickable cross-references in
   * the documentation viewer. Undefined for primitive properties. */
  targetModelRef?: string
  /** When true, `targetModelRef` describes the array's element type
   * rather than the property itself — distinguishes `Pet` from
   * `array<Pet>` without needing to re-parse the type label. */
  isArrayOfRef?: boolean
  /** Schema-level nullability (Swagger 2.0 `x-nullable`, OAS 3.0
   * `nullable`, OAS 3.1 `type: ["X", "null"]`). */
  nullable?: boolean
  /** Read-only flag from the source schema. */
  readOnly?: boolean
  /** Single example value attached to the property's schema. */
  example?: unknown
  /** Enum values listed at the property's schema. */
  enumValues?: unknown[]
  /** Validation constraints from the source schema. */
  constraints?: SchemaConstraints
}

/** A global model / type definition referenced by operations. */
export interface ModelDocumentation {
  name: string
  description?: string
  properties: PropertyDocumentation[]
  /** Model marked deprecated in the source spec or carried forward. */
  deprecated?: boolean
  /** Model no longer appears in the most recently fetched spec. */
  removed?: boolean
}

/** A group of operations (Swagger tag, WSDL service, gRPC package, GraphQL root type...). */
export interface GroupDocumentation {
  name: string
  description?: string
  externalDocs?: ExternalDocs
}

/**
 * Criteria used to match an OperationDocumentation to a concrete route at compile time.
 * The matching is intentionally dynamic — routes don't store any key back to the
 * documentation; instead the compiler resolves the route's URL + discriminants and looks
 * up the matching operation each time.
 */
export interface OperationMatchCriteria {
  /** URL pattern (e.g., `/pets/{petId}`). */
  urlPattern: string
  /** HTTP verb (GET, POST, etc.) for REST. */
  method?: string
  /** SOAPAction header — takes priority over `operationName` for SOAP matching. */
  soapAction?: string
  /** Operation name — SOAP fallback, gRPC method, GraphQL field. */
  operationName?: string
  /** Service name — SOAP, gRPC. */
  serviceName?: string
  /** GraphQL operation type: query / mutation / subscription. */
  operationType?: string
  /** AsyncAPI / WebSocket channel path. */
  event?: string
  /** AsyncAPI pub/sub direction. */
  direction?: 'publish' | 'subscribe'
}

/** A single parameter (query / path / header / body / argument / formData). */
export interface ParameterDocumentation {
  name: string
  location: string
  type: string
  required: boolean
  description?: string
  defaultValue?: string
  /** Single example value attached to the parameter's schema or
   * carried via `x-example` (Swagger 2.0). */
  example?: unknown
  /** Pluralised examples — keyed by content-type / variant name when
   * the source spec provides a map (`Record<string, unknown>`), or a
   * raw array if the spec lists positional examples. */
  examples?: Record<string, unknown> | unknown[]
  /** Enum values listed at the parameter's schema. */
  enumValues?: unknown[]
  /** Pluralised array-encoding hint (Swagger 2.0 `collectionFormat`):
   * csv / ssv / tsv / pipes / multi. Carried as-is for the doc
   * viewer; OAS 3.x uses `style` + `explode` instead. */
  collectionFormat?: string
  /** Swagger 2.0: parameter may be transmitted with an empty value
   * (typically only meaningful for `query` parameters). */
  allowEmptyValue?: boolean
  /** Validation constraints from the source schema. */
  constraints?: SchemaConstraints
}

/** A single response shape (by status code or name). */
export interface ResponseDocumentation {
  description?: string
  schema?: string
  headers?: Record<string, { type: string; description?: string }>
  /** Per-content-type examples (Swagger 2.0 `examples`), or any other
   * keyed example payloads the source spec provides. Stored raw so the
   * doc viewer can render JSON, YAML, plain text, etc. without
   * additional shaping. */
  examples?: Record<string, unknown>
}

/** A single operation (REST path+method, SOAP op, gRPC method, GraphQL field, etc.). */
export interface OperationDocumentation {
  match: OperationMatchCriteria
  group?: string
  summary?: string
  description?: string
  operationId?: string
  deprecated?: boolean
  externalDocs?: ExternalDocs
  consumes?: string[]
  produces?: string[]
  parameters?: ParameterDocumentation[]
  responses?: Record<string, ResponseDocumentation>
  security?: Record<string, string[]>[]
  /** Names of models referenced by this operation (keys in ApiDocumentation.models). */
  referencedModels?: string[]
  /** Protocol-specific fields (Postman auth, Bruno scripts, gRPC callType, etc.). */
  extra?: Record<string, unknown>
}

/** Source type discriminator — matches the import format. */
export type ApiDocumentationSourceType =
  | 'swagger'
  | 'openapi'
  | 'wsdl'
  | 'grpc'
  | 'graphql'
  | 'asyncapi'
  | 'postman'
  | 'insomnia'
  | 'bruno'
  | 'odata'

/** Root documentation structure stored on the EnvironmentFolder that owns the API. */
export interface ApiDocumentation {
  sourceType: ApiDocumentationSourceType
  /** Original spec URL if imported from URL — powers the "Refresh documentation" button. */
  sourceUrl?: string
  api: ApiInfo
  server?: ApiServer
  models: Record<string, ModelDocumentation>
  groups: Record<string, GroupDocumentation>
  operations: OperationDocumentation[]
}
