/**
 * Projection of an API design onto the documentation types — the
 * reassembly half of the composition contract in
 * `shared/types/apiDesign.ts`.
 *
 * A design stores each model property (and each route) in a wrapper that
 * carries a stable ID plus design extensions; the documentation viewers,
 * the served docs and the spec exporters consume plain
 * `ApiDocumentation` shapes. These helpers rebuild those shapes, and
 * re-derive the name-based reference fields (`targetModelRef`) from the
 * authoritative ID-based references.
 */

import type {
  ApiDocumentation,
  ModelDocumentation,
  PropertyDocumentation,
  OperationDocumentation,
  ParameterDocumentation
} from '../types/apiDocumentation'
import type { ApiDesign, DesignModel, DesignEnum, DesignRoute, DesignRouteGroup } from '../types/apiDesign'

/**
 * Resolvers from entity IDs to exported names. Kept as an interface so a
 * caller can rename-on-export (OpenAPI identifier constraints) without
 * the design noticing.
 */
export interface DesignNameResolver {
  modelName(modelId: string): string | undefined
  enumName(enumId: string): string | undefined
}

/** ID→name resolution over the design itself — the default resolver. */
export function designNameResolver(design: ApiDesign): DesignNameResolver {
  const models = new Map(design.models.map((m) => [m.id, m.doc.name]))
  const enums = new Map(design.enums.map((e) => [e.id, e.doc.name]))
  return {
    modelName: (id) => models.get(id),
    enumName: (id) => enums.get(id)
  }
}

/**
 * A model property as a plain `PropertyDocumentation`, with
 * `targetModelRef` re-derived from the design's ID-based reference (the
 * embedded doc's own value is not authoritative inside a design).
 */
export function designPropertyDoc(
  property: DesignModel['properties'][number],
  resolve: DesignNameResolver
): PropertyDocumentation {
  const reference = property.design?.reference
  if (reference === undefined) {
    // A canonical primitive array keeps its element type in design-only
    // `arrayItems`; fold it into the `array<elem>` label so doc consumers
    // (OpenAPI export → `items`, in-app doc view) don't emit a typeless array.
    // GraphQL/OData/gRPC and the codegen context read `design.arrayItems`
    // directly off the raw property and are unaffected by this.
    const itemType = property.design?.arrayItems?.type
    if (property.doc.type === 'array' && itemType !== undefined) {
      return { ...property.doc, type: `array<${itemType}>` }
    }
    return property.doc
  }
  const name = reference.target === 'model'
    ? resolve.modelName(reference.refId)
    : resolve.enumName(reference.refId)
  if (name === undefined) {
    // Dangling reference (validation reports it) — surface the doc
    // as-is rather than inventing a target name.
    return property.doc
  }
  return { ...property.doc, targetModelRef: name }
}

/** A design model as a plain `ModelDocumentation`. */
export function designModelDoc(model: DesignModel, resolve: DesignNameResolver): ModelDocumentation {
  return {
    ...model.doc,
    properties: model.properties.map((p) => designPropertyDoc(p, resolve))
  }
}

/** A design enum as a plain `ModelDocumentation` (enum-shaped). */
export function designEnumDoc(entry: DesignEnum): ModelDocumentation {
  return entry.doc
}

/**
 * A design route as a plain `OperationDocumentation` with its full URL
 * pattern composed from the design/group base paths. Placeholders keep
 * the Restorm `{{param}}` spelling — format-specific exporters translate
 * them.
 *
 * LINKED parameters resolve LIVE against their model property (the
 * ID-based `paramLinks` are the authority): type/format/example — and
 * the description while the mirror is auto — come from the property at
 * projection time, exactly what the route editor displays. The values
 * frozen into `doc.parameters` at generation time are only the
 * fallback for a dangling link (which validation reports).
 */
export function designRouteDoc(
  route: DesignRoute,
  context: { designBasePath?: string; versionPrefix?: string; groupBasePath?: string },
  design?: ApiDesign
): OperationDocumentation {
  const full = composeRoutePath(context, route.doc.match.urlPattern)
  const links = route.design?.paramLinks
  const enumRefs = route.design?.paramEnumRefs
  let parameters = route.doc.parameters
  if (design !== undefined && parameters !== undefined && (links !== undefined || enumRefs !== undefined)) {
    parameters = parameters.map((parameter) => {
      const link = links?.[parameter.name]
      if (link !== undefined) {
        const model = design.models.find((m) => m.id === link.modelId)
        const property = model?.properties.find((p) => p.id === link.propertyId)
        if (property !== undefined) {
          const resolved = { ...parameter, type: property.doc.type }
          if (property.doc.format !== undefined) resolved.format = property.doc.format
          else delete resolved.format
          if (property.doc.example !== undefined) resolved.example = property.doc.example
          if (property.doc.constraints !== undefined) resolved.constraints = property.doc.constraints
          if (link.descriptionAuto === true) {
            if (property.doc.description !== undefined) resolved.description = property.doc.description
            else delete resolved.description
          }
          return resolved
        }
      }
      // A named-enum reference projects the param's type to the enum NAME so the
      // exporter emits a `$ref` to the enum component; the inline values (if any
      // lingered) give way to the component.
      const enumId = enumRefs?.[parameter.name]
      if (enumId !== undefined) {
        const enumEntity = design.enums.find((e) => e.id === enumId)
        if (enumEntity !== undefined) {
          const { enumValues: _dropped, ...rest } = parameter
          return { ...rest, type: enumEntity.doc.name }
        }
      }
      return parameter
    })
  }
  // Project the route's body contract back into the operation as the
  // virtual `location: 'body'` parameter (Swagger-2 spelling) plus
  // `consumes` — the exact shape the importers synthesize from an OAS
  // requestBody and that `apiDocumentationToOpenApi` turns back into one.
  // Without this the body silently vanishes on the design round-trip.
  const body = route.design?.body
  const bodyModel = body?.modelId !== undefined && design !== undefined
    ? design.models.find((m) => m.id === body.modelId)
    : undefined
  let consumes: string[] | undefined
  if (body !== undefined) {
    // A body with no resolvable model (an inline object, or a dangling ref that
    // validation reports) still projects a `body` row so the body is never
    // silently dropped — as `object`, keeping its `array<…>` wrapper when set.
    const bodyTypeName = bodyModel?.doc.name ?? 'object'
    const bodyParam: ParameterDocumentation = {
      name: 'body',
      location: 'body',
      type: body.list === true ? `array<${bodyTypeName}>` : bodyTypeName,
      required: true,
      ...(body.description !== undefined ? { description: body.description } : {})
    }
    parameters = [...(parameters ?? []), bodyParam]
    // Emit the FULL media-type set when the design preserved one, else
    // the single primary content type.
    const types = body.contentTypes
      ?? (body.contentType !== undefined && body.contentType !== '' ? [body.contentType] : undefined)
    if (types !== undefined && types.length > 0) consumes = types
  }
  return {
    ...route.doc,
    match: { ...route.doc.match, urlPattern: full },
    ...(parameters !== undefined ? { parameters } : {}),
    ...(consumes !== undefined ? { consumes } : {})
  }
}

/**
 * A base path is a path, so it must be rooted with `/` — but the user may type
 * `api/v1` without one. Add it silently at resolution/serve time (we never
 * rewrite what they typed in the field). Left untouched: an empty value, an
 * already-rooted path, a `{{variable}}` that didn't resolve (it carries its own
 * leading slash), and a full URL someone pasted.
 */
export function ensureLeadingSlash(path: string): string {
  if (path === '' || path.startsWith('/') || path.startsWith('{{')) return path
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path
  return `/${path}`
}

/**
 * The group's own ancestor chain, root → self (a group is always last). Follows
 * `parentId` in the flat `routeGroups` array; cycle- and orphan-guarded.
 */
export function groupAncestryChain(design: ApiDesign, group: DesignRouteGroup): DesignRouteGroup[] {
  const byId = new Map(design.routeGroups.map((g) => [g.id, g]))
  const chain: DesignRouteGroup[] = []
  const seen = new Set<string>()
  let current: DesignRouteGroup | undefined = group
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    current = current.parentId !== undefined ? byId.get(current.parentId) : undefined
  }
  return chain
}

/**
 * The composed group base-path segment for `group` INCLUDING its ancestors:
 * each group on the chain (root → self) contributes its `versionPrefix` then its
 * `basePath`. Feed the result as {@link composeRoutePath}'s `groupBasePath` — a
 * root group yields exactly `versionPrefix/basePath` as before, so flat designs
 * are unchanged.
 */
export function groupChainBasePath(design: ApiDesign, group: DesignRouteGroup): string {
  const parts: string[] = []
  const push = (segment: string | undefined): void => {
    if (segment === undefined) return
    const trimmed = segment.replace(/^\/+|\/+$/g, '')
    if (trimmed !== '') parts.push(trimmed)
  }
  for (const g of groupAncestryChain(design, group)) {
    push(g.design?.versionPrefix)
    push(g.design?.basePath)
  }
  return parts.join('/')
}

/** Compose base paths + a relative pattern into one normalized path. */
export function composeRoutePath(
  context: { designBasePath?: string; versionPrefix?: string; groupBasePath?: string },
  relativePattern: string
): string {
  const segments = [context.designBasePath, context.versionPrefix, context.groupBasePath, relativePattern]
  const joined = segments
    .filter((s): s is string => typeof s === 'string' && s !== '')
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s !== '')
    .join('/')
  return `/${joined}`
}

/**
 * The whole design as a plain `ApiDocumentation` — what the Docs
 * section serves and what exporters start from. Groups project onto
 * `groups`; routes flatten onto `operations` with composed paths;
 * enums join `models` under their own names (the shape importers use
 * for standalone enum schemas).
 */
/**
 * ⚠ ORDER CONTRACT: `operations` stacks `routeGroups[]` in declaration
 * order, each group's `routes[]` in order — no sort, no filter. The
 * design Documentation section's edit links rely on it to map
 * `operations[i]` back to the i-th flattened route id
 * (`DesignDocumentationSection`), and a unit test pins it. Don't
 * reorder, filter or clone here without updating that consumer.
 */
/** The deduplicated union of a group's shared tags and a route's own tags,
 * group tags first (so a shared tag reads as the primary one). Trims blanks. */
export function unionTags(groupTags: string[] | undefined, routeTags: string[] | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const tag of [...(groupTags ?? []), ...(routeTags ?? [])]) {
    const trimmed = tag.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export function designToApiDocumentation(design: ApiDesign): ApiDocumentation {
  const resolve = designNameResolver(design)
  const models: Record<string, ModelDocumentation> = {}
  for (const model of design.models) {
    models[model.doc.name] = designModelDoc(model, resolve)
  }
  for (const entry of design.enums) {
    models[entry.doc.name] = designEnumDoc(entry)
  }
  const groups: ApiDocumentation['groups'] = {}
  const operations: OperationDocumentation[] = []
  for (const group of design.routeGroups) {
    groups[group.doc.name] = group.doc
    for (const route of group.routes) {
      const projected = designRouteDoc(route, { groupBasePath: groupChainBasePath(design, group) }, design)
      // A route's effective tags are the UNION of its group's shared tags and
      // its own — deduplicated, group tags first so a shared tag reads as the
      // primary. Absent on both sides leaves the operation untagged (the OAS
      // export then falls back to the group name as the sole tag).
      const merged = unionTags(group.doc.tags, route.doc.tags)
      operations.push({
        // The design's base path is NOT composed into operation paths:
        // it belongs to the base URL and travels in `server.basePath`
        // (exactly where the spec importers put it) — composing it here
        // too would double-count it on a re-import round-trip. Serving
        // is different: `compileDesignRoutes` binds full paths.
        // The group base path folds the whole ancestor chain (version+base per
        // group), so a nested group composes under its parents.
        ...projected,
        group: group.doc.name,
        ...(merged.length > 0 ? { tags: merged } : {})
      })
    }
  }
  return {
    // The design IS the source; `openapi` is the closest spec dialect
    // consumers of this projection expect.
    sourceType: 'openapi',
    api: design.info,
    ...(design.server !== undefined && { server: design.server }),
    models,
    groups,
    operations,
    ...(design.securitySchemes !== undefined && { securitySchemes: design.securitySchemes }),
    ...(design.defaultSecurity !== undefined && { defaultSecurity: design.defaultSecurity })
  }
}
