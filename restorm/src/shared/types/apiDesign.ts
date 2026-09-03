/**
 * API design entities — the data model behind the Design workbench tab.
 *
 * A design is authored in Restorm FIRST (design-first): models, enums,
 * route groups and routes are edited visually, then DERIVED into specs
 * (OpenAPI export), local design servers, database schemas and generated
 * code. The design is the single source of truth; every spec format is a
 * projection of it.
 *
 * ## Composition over the documentation objects
 *
 * Every design entity EMBEDS the corresponding documentation object from
 * `apiDocumentation.ts` under a `doc` key, and adds its own extensions
 * NEXT TO it — never inside it. The documentation types are shared with
 * the import pipeline and stay untouched:
 *
 * - what a spec can say about an entity lives in `doc` (name, types,
 *   constraints, descriptions, examples…);
 * - what only a design can say lives in the sibling extension bags:
 *   `intents` (intention metadata that feeds derivations: volumetry,
 *   PII, expected traffic) and `design` (structural design facts:
 *   identifiers, relations, lifecycle toggles, generators' inputs).
 *
 * This is what makes pre-filling a design from an imported API a direct
 * copy of its documentation objects, and serving a design's documentation
 * a direct read of them.
 *
 * ## Stable references
 *
 * Design entities reference each other by ID, never by name: a property
 * link on a route survives renaming the property. IDs follow the tree's
 * stable-id pattern (`shared/utils/stableId.ts`): persisted with the
 * document, derived deterministically when a file arrives without them.
 *
 * Inside an embedded `doc`, name-based reference fields
 * (`targetModelRef`) are NOT authoritative for a design — the sibling
 * extension's ID-based reference is. Derivations resolve IDs back to
 * names when they project the design into a spec or documentation view.
 *
 * ## Serialization
 *
 * A design serializes inside `collections` like any other tree item, in
 * arrays whose order is the author's order (deterministic, diff-able).
 * A document containing at least one design persists with file format
 * 1.1 (`shared/config/fileFormatVersion.ts`); one without stays at 1.
 */

import type { RuntimeId } from './baseTypes'
import type { TemplateVarValues } from '../design/templateVariables'
import type {
  ApiInfo,
  ApiServer,
  SecurityScheme,
  ModelDocumentation,
  PropertyDocumentation,
  GroupDocumentation,
  OperationDocumentation
} from './apiDocumentation'

/** Expected order of magnitude for a model's row count. Feeds the
 * database generator (index strategy, partitioning hints) and nothing
 * else — absent means "no expectation stated". */
export type ModelVolumetry = 'hundreds' | 'tenThousands' | 'millions'

/** Expected traffic on a route. Feeds derived database indexes and
 * design-server behaviour hints. */
export type RouteTraffic = 'low' | 'medium' | 'high'

/** Read/write profile of a resource — how a codegen template shapes caching,
 * read replicas, CQRS, index and append-only strategies. */
export type ModelAccessPattern = 'readHeavy' | 'writeHeavy' | 'balanced' | 'appendOnly'

/** Expected access frequency (traffic) on a resource — caching layer,
 * rate-limiting, pooling, dedicated infrastructure. */
export type ModelTraffic = RouteTraffic

/** How stale a resource may be served — whether a template caches it, and how
 * long. `strong` = must be fresh (no cache). */
export type ModelFreshness = 'strong' | 'shortCache' | 'longCache'

/** Data-classification of a resource — encryption at rest, audit, masking,
 * no-store headers. (Property-level `pii` marks a single field; this classifies
 * the whole resource.) */
export type ModelSensitivity = 'public' | 'internal' | 'confidential' | 'pii'

/** Retention / lifecycle of a resource — TTL, cold storage, purge. */
export type ModelRetention = 'permanent' | 'archivable' | 'ephemeral'

/** How a model's identifier is produced. Feeds column DDL, generated
 * code and the design server's object resolution. */
export type IdentifierStrategy = 'uuid' | 'autoIncrement' | 'ulid'

/** What happens to referrers when a referenced model instance is
 * deleted. Feeds foreign-key clauses and the design server. */
export type ReferenceOnDelete = 'restrict' | 'cascade' | 'setNull'

/** Authentication contract a route group declares (routes inherit it;
 * a route may override with its own value). */
export type DesignAuthKind = 'none' | 'bearer' | 'apiKeyHeader' | 'basic'

/** Protocols a design server can project the design onto. */
export type DesignProtocol = 'http' | 'graphql' | 'soap' | 'odata' | 'grpc'

/** List pagination concept — protocol-agnostic on purpose: each
 * projection maps it natively (HTTP query params + envelope, OData
 * `$skip`/`$top`, GraphQL arguments, SQL LIMIT/OFFSET). */
export interface DesignPagination {
  style: 'offset'
  defaultLimit?: number
  maxLimit?: number
}

/** A primitive type spelling, for the places `doc` cannot carry one:
 * the element type of a primitive array, the value type of a map. */
export interface DesignScalarType {
  /** Same vocabulary as `PropertyDocumentation.type`. */
  type: string
  /** Same vocabulary as `PropertyDocumentation.format`. */
  format?: string
}

/**
 * An ID-based reference from a property to another design entity. The
 * authoritative form of "this property is typed by that model/enum" —
 * `doc.targetModelRef` is derived from it, never the other way around.
 */
export interface PropertyReference {
  target: 'model' | 'enum'
  refId: RuntimeId
  /** Model references only: the relational delete behaviour. Absent
   * means `restrict` — the safe default for derivations. */
  onDelete?: ReferenceOnDelete
}

/** Intention metadata on a property. */
export interface PropertyIntents {
  /** Field-level sensitivity: masking in logs, encryption-at-rest
   * suggestions, GDPR handling in derivations. */
  pii?: boolean
}

/** Design-only structural facts on a property. */
export interface PropertyDesignMeta {
  /** Set when the property is typed by another design entity. The
   * array-ness of a reference lives on `doc.isArrayOfRef`. */
  reference?: PropertyReference
  /** Element type when `doc.type` is `array` and the elements are
   * primitives (a reference array uses `reference` + `doc.isArrayOfRef`). */
  arrayItems?: DesignScalarType
  /** Value type when the property is a string-keyed map. */
  mapValues?: DesignScalarType
  /** Never readable back through the API (passwords). The read-side
   * counterpart, `readOnly`, lives on `doc.readOnly`. */
  writeOnly?: boolean
  /** Derives a unique index / constraint. */
  unique?: boolean
  /** Set-once: no setter generated, excluded from updates. */
  immutable?: boolean
  /** Default applied when the property is omitted at creation. */
  defaultValue?: unknown
  /** Offers standard search routes on this property and derives a
   * database index. */
  searchable?: boolean
  /** Human message accompanying `doc.deprecated`. */
  deprecationMessage?: string
  /** Per-template PROPERTY-scope code-generation variable overrides for THIS
   * property: templateId → (variable name → Handlebars expression). Overrides
   * the template's global "Property" value; empty/absent inherits it. */
  codegenVars?: Record<RuntimeId, Record<string, string>>
}

/**
 * A property of a design model: the documentation property plus design
 * extensions. The wrapper carries the stable ID that route parameter
 * links point at.
 */
export interface DesignProperty {
  id: RuntimeId
  doc: PropertyDocumentation
  intents?: PropertyIntents
  design?: PropertyDesignMeta
}

/** Intention metadata on a model — the "operational profile" of the resource.
 * Every field is optional (absent = "no expectation stated") and feeds the code
 * generators via the codegen context; none affect the served mock except
 * {@link ModelVolumetry} (the served list total). */
export interface ModelIntents {
  /** Expected order of magnitude for the row count. */
  volumetry?: ModelVolumetry
  /** Read/write profile (read-heavy, write-heavy, balanced, append-only). */
  accessPattern?: ModelAccessPattern
  /** Expected access frequency / traffic. */
  traffic?: ModelTraffic
  /** How stale the resource may be served (freshness tolerance). */
  freshness?: ModelFreshness
  /** Data classification / sensitivity of the resource. */
  sensitivity?: ModelSensitivity
  /** Retention / lifecycle. */
  retention?: ModelRetention
}

/** Design-only structural facts on a model. */
export interface ModelDesignMeta {
  /** Which property identifies an instance, and how values are minted. */
  identifier?: { propertyId: RuntimeId; strategy: IdentifierStrategy }
  /** Maintain created/updated timestamps on derived storage and code. */
  timestamps?: boolean
  /** Soft delete: derived storage marks rows deleted instead of
   * removing them. */
  softDelete?: boolean
  /** Parent model this one inherits from. The child DISPLAYS the
   * parent's properties read-only; cycles are invalid. */
  inheritsFrom?: RuntimeId
  /** Per-template MODEL-scope code-generation variable overrides for THIS model:
   * templateId → (variable name → Handlebars expression). Overrides the
   * template's global "Models" value; empty/absent inherits it. */
  codegenVars?: Record<RuntimeId, Record<string, string>>
}

/**
 * A complete, named example instance of a model ("an admin User"),
 * reused by the design server's responses and the served documentation.
 */
export interface DesignExample {
  id: RuntimeId
  name: string
  description?: string
  /** Property ID → defined value. A property absent here gets a
   * seeded, reproducible faker value derived from its type/format. */
  values: Record<RuntimeId, unknown>
}

/**
 * A design model. `doc` carries everything a spec can say about the
 * model EXCEPT its properties, which are wrapped individually so each
 * carries its own ID and extensions. `designModelDoc` in
 * `shared/design` reassembles the plain `ModelDocumentation` view.
 */
export interface DesignModel {
  id: RuntimeId
  doc: Omit<ModelDocumentation, 'properties'>
  properties: DesignProperty[]
  examples?: DesignExample[]
  intents?: ModelIntents
  design?: ModelDesignMeta
  /** Free-form notes (the model card's Notes tab) — working notes,
   * distinct from `doc.description` which is published. */
  notes?: string
}

/**
 * A design enum: a closed set of values usable as a property type.
 * `doc` is an enum-shaped `ModelDocumentation` (top-level `enumValues`
 * filled, `properties` empty) — the exact shape importers produce for a
 * standalone enum schema, so pre-fill and export are direct copies.
 * Lives in the design, deliberately separate from an env-folder's
 * custom value lists (the editing UI is shared, the data is not).
 */
export interface DesignEnum {
  id: RuntimeId
  doc: ModelDocumentation
  /**
   * Optional code-identifier NAME per value, aligned by index with
   * `doc.enumValues`. Design-only (never leaves via the shared
   * `enumValues`): it feeds code generation (member identifiers) and the
   * OpenAPI `x-enum-varnames` extension. Absent / empty → the name defaults
   * to the rendered value, so value-only enums keep working unchanged.
   */
  memberNames?: string[]
}

/** A link binding a route parameter to a model property: the parameter
 * inherits the property's type, format, validation and examples. */
export interface DesignParamLink {
  modelId: RuntimeId
  propertyId: RuntimeId
  /** The parameter's `doc` description mirrors the property's while
   * `true`; editing it detaches the mirror. */
  descriptionAuto?: boolean
}

/** Design extensions of one response (keyed by the same status code as
 * `doc.responses`). */
export interface DesignResponseMeta {
  /** Model shaping the response body. Absent = empty response. */
  modelId?: RuntimeId
  /** The response is a list of the model rather than a single one. */
  list?: boolean
  /** A list response wrapped in the pagination envelope. */
  paginated?: boolean
  /** Named example (of the response's model) the design server serves
   * for this code. Absent = seeded faker instance. */
  exampleId?: RuntimeId
}

/** Intention metadata on a route. */
export interface RouteIntents {
  traffic?: RouteTraffic
}

/** Design-only facts on a route. */
export interface RouteDesignMeta {
  /** Parameter name → model-property link. Keys match the `name` of
   * entries in `doc.parameters`; the editor renames keys in lockstep
   * with the path's `{{param}}` placeholders. */
  paramLinks?: Record<string, DesignParamLink>
  /** Request body contract for methods that carry one. `contentType` is
   * the primary media type the editor shows; `contentTypes` preserves the
   * FULL set an imported spec declared (a body can accept several) so a
   * design→spec round-trip is lossless; `description` is the body-level
   * doc text. */
  body?: { modelId?: RuntimeId; contentType?: string; contentTypes?: string[]; description?: string }
  /** Status code → response design extensions. */
  responses?: Record<string, DesignResponseMeta>
  /** Pagination of list responses on this route. */
  pagination?: DesignPagination
  idempotent?: boolean
  /** Cache lifetime in seconds; absent = not cacheable. */
  cacheSeconds?: number
  /** Overrides the group's auth contract; absent = inherited. */
  authOverride?: DesignAuthKind
  /** Per-template ROUTE-scope code-generation variable overrides for THIS route:
   * templateId → (variable name → Handlebars expression). Overrides the
   * template's global "Routes" value; empty/absent inherits it. */
  codegenVars?: Record<RuntimeId, Record<string, string>>
}

/**
 * A design route. `doc.match.urlPattern` holds the path RELATIVE to
 * the owning group, spelled with Restorm request syntax (`{{param}}`);
 * projections compose the full path from the design's base path, the
 * group's base path and this pattern, and translate placeholders to the
 * target format (`{param}` for OpenAPI).
 */
export interface DesignRoute {
  id: RuntimeId
  doc: OperationDocumentation
  intents?: RouteIntents
  design?: RouteDesignMeta
  /** Free-form notes (the route card's Notes tab). */
  notes?: string
}

/** Design-only facts on a route group. */
export interface RouteGroupDesignMeta {
  /** Base path segment of every route in the group (e.g. `/users`). */
  basePath?: string
  /** Auth contract routes inherit. Absent = `none`. */
  auth?: DesignAuthKind
  /** Contract headers shared by the group's routes. */
  headers?: { name: string; example?: string; description?: string }[]
  /** Version prefix composed into the full path (e.g. `/v1`). */
  versionPrefix?: string
}

/**
 * A group of routes ("resource folder"): carries the base path and the
 * contract routes inherit. Projected to tags in OpenAPI, to folders
 * when materialized into test requests.
 *
 * Groups nest: `parentId` points at another group in the SAME flat
 * `routeGroups` array (absent = a root group). A nested group's base path
 * COMPOSES under its ancestors — the full served path is
 * `serverBasePath + [ancestors' versionPrefix+basePath, root→self] + routePattern`.
 * The group's display NAME (a tag) stays independent of its `basePath`.
 */
export interface DesignRouteGroup {
  id: RuntimeId
  doc: GroupDocumentation
  design?: RouteGroupDesignMeta
  routes: DesignRoute[]
  /** Parent group id (same `routeGroups` array); absent = a root group. */
  parentId?: RuntimeId
}

/** Design-server configuration carried by the design root. */
/** Where the Code section's template comes from. */
export type DesignTemplateSource =
  | { kind: 'repo'; repo: string; ref?: string }
  | { kind: 'local'; path: string }

/** One configured code-generation target: a template source plus the output
 * folder it writes to. A design carries a LIST of these so a single design can
 * be generated into several projects (the app, then the DB, then the backend…),
 * each from its own template and into its own folder. */
export interface DesignCodegenTemplate {
  id: RuntimeId
  source: DesignTemplateSource
  /** Output folder — absolute, or relative to the project file. */
  outputDir?: string
  /** Friendly label shown on the list row (official title / repo name / folder
   * basename). Optional — the UI derives a fallback from the source. */
  label?: string
  /** GLOBAL values for the variables this template declares — one map per scope
   * (varName → Handlebars expression), applied to every entity of that scope.
   * A per-entity value ({@link ModelDesignMeta.codegenVars} /
   * {@link RouteDesignMeta.codegenVars}) overrides it; the manifest default is
   * the base. */
  variables?: TemplateVarValues
}

/** Code-generation configuration, persisted with the design. */
export interface DesignCodegen {
  /** The configured template targets, in author order (TASK-468.20). */
  templates?: DesignCodegenTemplate[]
  /** Legacy pre-468.20 single-source shape. Read-migrated into a one-entry
   * `templates` list on load and never re-emitted (see ApiDesign.fromPlain). */
  templateSource?: DesignTemplateSource
  /** Legacy pre-468.20 single output folder. Migrated onto the sole
   * `templates` entry. */
  outputDir?: string
}

export interface DesignServing {
  /** Protocols the design server projects onto. Absent = HTTP only. */
  protocols?: DesignProtocol[]
  /** Fixed listen port; absent = picked at spin time. A string carries a
   * `{{variable}}` expression resolved (against the design's env-folder)
   * to a number right before the server binds. */
  port?: number | string
  /** Fixed port for the gRPC projection's separate HTTP/2 server (gRPC
   * cannot share the HTTP/1.1 port the other projections ride). Absent =
   * a default adjacent to `port`. Only used when `protocols` enables
   * 'grpc'. */
  grpcPort?: number
  /** Simulated latency added to every served response, in ms.
   * Absent or 0 = answer immediately. */
  latencyMs?: number
  /** Stateful mode (TASK-468.16): POST/PUT/DELETE mutate an ephemeral
   * in-memory store seeded from the named examples, reset on restart.
   * Absent/false = the default STATELESS mode (468.6). */
  stateful?: boolean
}

/**
 * The design root — a workbench tree item, placeable at the document
 * root or inside an env-folder (a design inside an env-folder resolves
 * variables like a request does). A leaf in tree terms: its sub-
 * entities are sections of the Design tab, never tree children.
 */
export interface ApiDesign {
  /** Discriminates a design inside `FolderItem`. */
  type: 'design'
  id: RuntimeId
  /** Sidebar / tab label. Distinct from `info.title`, the API's
   * published title. */
  name: string
  /** Free-form notes (the Notes section). */
  notes?: string
  /** The API's published identity — the same doc object importers
   * produce (`ApiDocumentation.api`). */
  info: ApiInfo
  /** Published connection info (host, base path, schemes). */
  server?: ApiServer
  /** Named security schemes, same shape as
   * `ApiDocumentation.securitySchemes`. */
  securitySchemes?: Record<string, SecurityScheme>
  /** Spec-level security requirement, same semantics as
   * `ApiDocumentation.defaultSecurity`. */
  defaultSecurity?: Record<string, string[]>[]
  /** Default auth contract for the whole design — the fallback a route
   * group inherits when it declares none. Absent = `none`. */
  defaultAuth?: DesignAuthKind
  serving?: DesignServing
  codegen?: DesignCodegen
  models: DesignModel[]
  enums: DesignEnum[]
  routeGroups: DesignRouteGroup[]
}
