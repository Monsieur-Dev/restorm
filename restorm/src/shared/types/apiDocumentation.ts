/**
 * Common structured documentation format for imported API specs.
 *
 * All import formats (Swagger, WSDL, gRPC, GraphQL, AsyncAPI, Postman, Insomnia, Bruno,
 * etc.) are transformed into this shape by dedicated transformers. The result is stored
 * once on the root `EnvironmentFolder.apiDocumentation`; the documentation viewer
 * (see `components/documentation/DocumentationHost`) consumes this structure directly.
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

/** XML serialisation hints carried over from a Swagger 2.0 / OpenAPI
 * 3.x `xml` block. Surfaced verbatim by the doc viewer so the reader
 * can spot the difference between, e.g. `<photoUrls>` wrapping a
 * `<photoUrl>` list and a flat list of `<photoUrls>` siblings.
 *
 * Same shape on both `PropertyDocumentation.xml` and
 * `ModelDocumentation.xml` — the spec uses identical fields at both
 * levels, just narrower semantics for models (root element name +
 * namespace, no attribute / wrapped flag). */
export interface XmlHints {
  name?: string
  attribute?: boolean
  wrapped?: boolean
  prefix?: string
  namespace?: string
}

/** A single property on a documented model (Swagger definition, gRPC message, GraphQL type...). */
export interface PropertyDocumentation {
  name: string
  type: string
  /** Source-spec `format` hint (`int64`, `date-time`, `byte`,
   * `binary`, …). Surfaced in the docs viewer as a small badge
   * alongside the type. */
  format?: string
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
  /** XML serialisation hints (Swagger 2.0 + OpenAPI 3.x `xml`). */
  xml?: XmlHints
}

/** Polymorphism / composition descriptor — captures `oneOf` /
 * `anyOf` / `discriminator` from the source schema. The doc viewer
 * surfaces these as a list of cross-linkable variants under the
 * model card. `discriminator.propertyName` is the field whose value
 * picks the variant; `discriminator.mapping` maps that value to a
 * concrete model name. */
export interface ModelComposition {
  oneOf?: string[]
  anyOf?: string[]
  discriminator?: {
    propertyName: string
    mapping?: Record<string, string>
  }
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
  /** Polymorphism descriptor (`oneOf` / `anyOf` / `discriminator`).
   * Undefined for plain object models. */
  composition?: ModelComposition
  /** XML serialisation hints (Swagger 2.0 + OpenAPI 3.x `xml`).
   * Defines the root element's name + optional namespace. */
  xml?: XmlHints
  /** Enum values declared at the model schema's top level (e.g.
   * `{ type: "string", enum: ["A","B"] }` referenced as `$ref:
   * "#/components/schemas/Foo"`). Present when the schema is an
   * enum rather than an object — `properties` is empty in that
   * case and consumers should render the values directly. */
  enumValues?: unknown[]
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
  /** Parameter marked deprecated in the source spec (OpenAPI 3.x
   * carries this on every parameter). Triggers strikethrough
   * rendering in the docs table. */
  deprecated?: boolean
  /** Source-spec `format` hint — `int64`, `date-time`, `byte`,
   * `binary`, … Carried verbatim so the doc viewer can display the
   * encoding and the runtime layer can pick the right serialiser
   * once we wire upload / binary-body support. */
  format?: string
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

/** OAuth2 flow shape, normalised across Swagger 2.0 + OpenAPI 3.x.
 *
 * Swagger 2.0 uses `implicit` / `password` / `application` /
 * `accessCode`. OpenAPI 3.x renames `application` →
 * `clientCredentials` and `accessCode` → `authorizationCode`, but
 * the underlying URLs + scope map are the same. We keep the
 * Swagger-2.0 vocabulary as the canonical form and the OpenAPI
 * importer maps its 3.x flow keys onto these. */
export interface OAuth2Flow {
  type: 'implicit' | 'password' | 'application' | 'accessCode'
  authorizationUrl?: string
  tokenUrl?: string
  /** OpenAPI 3.x only — the URL clients can hit to refresh the
   * access token. Swagger 2.0 has no equivalent so this is
   * `undefined` for 2.0 imports. */
  refreshUrl?: string
  /** Map of scope name → human-readable description. Empty when
   * the spec defines no scopes. */
  scopes: Record<string, string>
}

/** Security scheme entry, version-agnostic. Populated by the
 * Swagger / OpenAPI transformers from `securityDefinitions` (2.0)
 * or `components.securitySchemes` (3.x). The `type` discriminator
 * matches the source vocabulary so the doc viewer can render
 * version-correct labels (`basic` is 2.0-only; `http` is 3.x-only,
 * etc.). */
export type SecuritySchemeType = 'apiKey' | 'basic' | 'http' | 'oauth2' | 'openIdConnect'

export interface SecurityScheme {
  type: SecuritySchemeType
  description?: string
  /** apiKey: header / query / cookie parameter name. */
  name?: string
  /** apiKey: where the key travels. Cookie is OpenAPI 3.x only. */
  in?: 'header' | 'query' | 'cookie'
  /** http (3.x): the HTTP auth scheme — `basic`, `bearer`, … For
   * Swagger 2.0 `basic` we set this to `'basic'` so the viewer
   * + auth pre-wiring don't have to special-case the version. */
  scheme?: string
  /** http (3.x): bearer-format hint (e.g. `JWT`). */
  bearerFormat?: string
  /** oauth2: one entry per declared flow. Swagger 2.0 has a single
   * flow per scheme; 3.x supports multiple flows in one block. */
  flows?: OAuth2Flow[]
  /** openIdConnect (3.x): the OIDC discovery document URL. */
  openIdConnectUrl?: string
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
  | 'smithy'
  | 'raml'
  | 'wadl'
  | 'api-blueprint'
  | 'thrift'

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
  /** Named security schemes (Swagger 2.0 `securityDefinitions` /
   * OpenAPI 3.x `components.securitySchemes`). Empty when the
   * spec declares none. */
  securitySchemes?: Record<string, SecurityScheme>
  /** Spec-level `security` requirement — operations without their
   * own `security` field inherit this. Top-level `[]` (empty
   * array) means the spec explicitly opts every operation OUT of
   * auth, so the viewer / pre-wirer must distinguish "absent"
   * from "explicitly empty". */
  defaultSecurity?: Record<string, string[]>[]
}
