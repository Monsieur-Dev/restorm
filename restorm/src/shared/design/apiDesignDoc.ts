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
  OperationDocumentation
} from '../types/apiDocumentation'
import type { ApiDesign, DesignModel, DesignEnum, DesignRoute } from '../types/apiDesign'

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
  if (reference === undefined) return property.doc
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
  let parameters = route.doc.parameters
  if (design !== undefined && links !== undefined && parameters !== undefined) {
    parameters = parameters.map((parameter) => {
      const link = links[parameter.name]
      if (link === undefined) return parameter
      const model = design.models.find((m) => m.id === link.modelId)
      const property = model?.properties.find((p) => p.id === link.propertyId)
      if (property === undefined) return parameter
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
    })
  }
  return {
    ...route.doc,
    match: { ...route.doc.match, urlPattern: full },
    ...(parameters !== undefined ? { parameters } : {})
  }
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
      operations.push({
        // The design's base path is NOT composed into operation paths:
        // it belongs to the base URL and travels in `server.basePath`
        // (exactly where the spec importers put it) — composing it here
        // too would double-count it on a re-import round-trip. Serving
        // is different: `compileDesignRoutes` binds full paths.
        ...designRouteDoc(route, {
          ...(group.design?.versionPrefix !== undefined && { versionPrefix: group.design.versionPrefix }),
          ...(group.design?.basePath !== undefined && { groupBasePath: group.design.basePath })
        }, design),
        group: group.doc.name
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
