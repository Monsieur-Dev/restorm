/**
 * Route-side helpers of the design: path-parameter mechanics (the
 * `{{param}}` Restorm request syntax) and the declarative generators —
 * CRUD from a model, search parameters from searchable properties, the
 * standard Error model. Generators produce NORMAL, editable design
 * entities; the design server and the code templates implement what
 * the design describes, never a hidden convention.
 */

import type {
  ApiDesign,
  DesignModel,
  DesignProperty,
  DesignRoute,
  DesignRouteGroup,
  DesignParamLink
} from '../types/apiDesign'
import type { ParameterDocumentation } from '../types/apiDocumentation'

/** `{{param}}` names of a pattern, in order, deduplicated. */
export function routePathParams(urlPattern: string): string[] {
  const names: string[] = []
  for (const match of urlPattern.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const name = match[1]
    if (name !== undefined && name !== '' && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Reconcile a route's parameter rows with its path pattern — the same
 * mechanic as the request editor's path-parameter table: typing a
 * `{{param}}` creates its row, removing it drops the row (and its
 * model link). Non-path parameters are untouched. Pure.
 */
export function syncPathParams(route: DesignRoute, urlPattern: string): DesignRoute {
  const wanted = routePathParams(urlPattern)
  const parameters = route.doc.parameters ?? []
  // Names are the paramLinks keys, so they must stay UNIQUE across
  // locations: a `{{status}}` typed into the pattern claims the name —
  // a query/header parameter spelling it is dropped rather than left
  // sharing one link entry with the new path row.
  const kept = parameters.filter((p) =>
    p.location === 'path' ? wanted.includes(p.name) : !wanted.includes(p.name))
  const existingNames = new Set(kept.filter((p) => p.location === 'path').map((p) => p.name))
  const added: ParameterDocumentation[] = wanted
    .filter((name) => !existingNames.has(name))
    .map((name) => ({ name, location: 'path', type: 'string', required: true }))

  // Path params render grouped first, in pattern order.
  const pathRows = wanted
    .map((name) => [...kept, ...added].find((p) => p.location === 'path' && p.name === name))
    .filter((p): p is ParameterDocumentation => p !== undefined)
  const otherRows = kept.filter((p) => p.location !== 'path')
  const nextParameters = [...pathRows, ...otherRows]

  const links = route.design?.paramLinks ?? {}
  const keptNames = new Set(nextParameters.map((p) => p.name))
  const nextLinks: Record<string, DesignParamLink> = {}
  for (const [name, link] of Object.entries(links)) {
    if (keptNames.has(name)) nextLinks[name] = link
  }

  const { paramLinks: _oldLinks, ...designRest } = route.design ?? {}
  const design = Object.keys(nextLinks).length > 0 ? { ...designRest, paramLinks: nextLinks } : designRest

  const { design: _oldDesign, ...routeRest } = route
  const next: DesignRoute = {
    ...routeRest,
    doc: { ...route.doc, match: { ...route.doc.match, urlPattern }, parameters: nextParameters }
  }
  if (Object.keys(design).length > 0) next.design = design
  return next
}

/** Naive English plural — good enough for generated group names, and
 * the user renames freely afterwards. */
export function pluralize(name: string): string {
  if (name === '') return name
  if (/[sxz]$/i.test(name) || /[cs]h$/i.test(name)) return `${name}es`
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`
  return `${name}s`
}

/** The property a generated `{{id}}` links to: the declared identifier
 * first, then a property literally named `id`, then nothing. */
export function identifierProperty(model: DesignModel): DesignProperty | undefined {
  const declaredId = model.design?.identifier?.propertyId
  if (declaredId !== undefined) {
    const declared = model.properties.find((p) => p.id === declaredId)
    if (declared !== undefined) return declared
  }
  return model.properties.find((p) => p.doc.name === 'id')
}

/** Build the doc row of a parameter linked to a property. The link is
 * the authority: the UI AND `designRouteDoc` re-derive type/format/
 * example/description from the property live — these frozen values are
 * only the fallback for a dangling link (which validation reports). */
function linkedParamDoc(name: string, location: 'path' | 'query', property: DesignProperty): ParameterDocumentation {
  return {
    name,
    location,
    type: property.doc.type,
    required: location === 'path',
    ...(property.doc.format !== undefined ? { format: property.doc.format } : {}),
    ...(property.doc.description !== undefined ? { description: property.doc.description } : {})
  }
}

export interface GeneratedCrud {
  group: DesignRouteGroup
}

/**
 * The CRUD convention (Yoann, 2026-08-16): a group named after the
 * model's plural (base `/users`) carrying five routes — list
 * (paginated), read, create, update, delete — every `{{id}}` linked to
 * the model's identifier property. `newId` mints entity ids (the caller
 * passes its id factory so shared code stays free of environment
 * randomness).
 */
export function generateCrud(_design: ApiDesign, model: DesignModel, newId: () => string): GeneratedCrud {
  const plural = pluralize(model.doc.name)
  const basePath = `/${plural.toLowerCase()}`
  const idProperty = identifierProperty(model)

  const idParamDoc = (): ParameterDocumentation[] =>
    idProperty !== undefined
      ? [linkedParamDoc('id', 'path', idProperty)]
      : [{ name: 'id', location: 'path', type: 'string', required: true }]
  const idLinks: Record<string, DesignParamLink> | undefined =
    idProperty !== undefined
      ? { id: { modelId: model.id, propertyId: idProperty.id, descriptionAuto: true } }
      : undefined
  /** Attach the id link when there is one, keeping the bag shape
   * exactOptionalPropertyTypes-clean. */
  const withIdLink = (meta: NonNullable<DesignRoute['design']>): NonNullable<DesignRoute['design']> =>
    idLinks !== undefined ? { ...meta, paramLinks: idLinks } : meta

  const list: DesignRoute = {
    id: newId(),
    doc: {
      match: { urlPattern: '/', method: 'GET' },
      summary: `List ${plural}`,
      responses: { '200': { description: `A page of ${plural}.` } }
    },
    design: {
      responses: { '200': { modelId: model.id, list: true, paginated: true } },
      pagination: { style: 'offset', defaultLimit: 20, maxLimit: 100 },
      idempotent: true
    }
  }

  const read: DesignRoute = {
    id: newId(),
    doc: {
      match: { urlPattern: '/{{id}}', method: 'GET' },
      summary: `Get one ${model.doc.name}`,
      parameters: idParamDoc(),
      responses: {
        '200': { description: `The ${model.doc.name}.` },
        '404': { description: 'Not found.' }
      }
    },
    design: withIdLink({
      responses: { '200': { modelId: model.id } },
      idempotent: true
    })
  }

  const create: DesignRoute = {
    id: newId(),
    doc: {
      match: { urlPattern: '/', method: 'POST' },
      summary: `Create a ${model.doc.name}`,
      responses: { '201': { description: 'Created.' } }
    },
    design: {
      body: { modelId: model.id, contentType: 'application/json' },
      responses: { '201': { modelId: model.id } }
    }
  }

  const update: DesignRoute = {
    id: newId(),
    doc: {
      match: { urlPattern: '/{{id}}', method: 'PUT' },
      summary: `Update a ${model.doc.name}`,
      parameters: idParamDoc(),
      responses: {
        '200': { description: `The updated ${model.doc.name}.` },
        '404': { description: 'Not found.' }
      }
    },
    design: withIdLink({
      body: { modelId: model.id, contentType: 'application/json' },
      responses: { '200': { modelId: model.id } },
      idempotent: true
    })
  }

  const remove: DesignRoute = {
    id: newId(),
    doc: {
      match: { urlPattern: '/{{id}}', method: 'DELETE' },
      summary: `Delete a ${model.doc.name}`,
      parameters: idParamDoc(),
      responses: {
        '204': { description: 'Deleted.' },
        '404': { description: 'Not found.' }
      }
    },
    design: withIdLink({
      idempotent: true
    })
  }

  // The group name joins the model/enum component namespace visually
  // (Swagger tags) — collide-and-rename is the user's call; validation
  // reports duplicates.
  const group: DesignRouteGroup = {
    id: newId(),
    doc: { name: plural, description: `${model.doc.name} management.` },
    design: { basePath },
    routes: [list, read, create, update, remove]
  }
  return { group }
}

/** The standard Error model — created on first use of the standard-
 * errors action, then a normal editable model. */
export function buildErrorModel(newId: () => string): DesignModel {
  return {
    id: newId(),
    doc: { name: 'Error', description: 'Standard error envelope.' },
    properties: [
      { id: newId(), doc: { name: 'code', type: 'string', required: true } },
      { id: newId(), doc: { name: 'message', type: 'string', required: true } },
      { id: newId(), doc: { name: 'details', type: 'string', required: false } }
    ]
  }
}

/** Find the design's Error model (by its conventional name). */
export function findErrorModel(design: ApiDesign): DesignModel | undefined {
  return design.models.find((m) => m.doc.name === 'Error')
}

export const STANDARD_ERROR_CODES = ['400', '401', '404', '500'] as const

const STANDARD_ERROR_DESCRIPTIONS: Record<(typeof STANDARD_ERROR_CODES)[number], string> = {
  '400': 'Invalid request.',
  '401': 'Authentication required.',
  '404': 'Not found.',
  '500': 'Internal error.'
}

/** Add the standard error responses (400/401/404/500 → Error model) to
 * a route, keeping any code the route already declares. Pure. */
export function withStandardErrorResponses(route: DesignRoute, errorModelId: string): DesignRoute {
  const docResponses = { ...(route.doc.responses ?? {}) }
  const designResponses = { ...(route.design?.responses ?? {}) }
  let added = false
  for (const code of STANDARD_ERROR_CODES) {
    // A code the route ALREADY declares keeps its contract untouched —
    // the action only fills the gaps.
    if (code in docResponses) continue
    docResponses[code] = { description: STANDARD_ERROR_DESCRIPTIONS[code] }
    designResponses[code] = { modelId: errorModelId }
    added = true
  }
  // Nothing to add → nothing to rewrite (and no empty bag minted).
  if (!added) return route
  return {
    ...route,
    doc: { ...route.doc, responses: docResponses },
    design: { ...(route.design ?? {}), responses: designResponses }
  }
}

/**
 * The search-routes proposal: ensure the model's group carries a LIST
 * route (`GET /`), then add one linked query parameter per searchable
 * property not already present on it. Returns the next routeGroups
 * array (and whether anything changed). Pure.
 */
export function generateSearchParams(
  design: ApiDesign,
  model: DesignModel,
  newId: () => string
): { routeGroups: DesignRouteGroup[]; changed: boolean } {
  const searchable = model.properties.filter((p) => p.design?.searchable === true)
  if (searchable.length === 0) return { routeGroups: design.routeGroups, changed: false }

  const plural = pluralize(model.doc.name)
  const basePath = `/${plural.toLowerCase()}`

  // The model's group: the one whose list route already returns the
  // model, else the conventional base path, else a fresh group.
  let groups = design.routeGroups
  let groupIndex = groups.findIndex((g) =>
    g.routes.some((r) => r.doc.match.method === 'GET' &&
      Object.values(r.design?.responses ?? {}).some((resp) => resp.modelId === model.id && resp.list === true)))
  if (groupIndex === -1) groupIndex = groups.findIndex((g) => g.design?.basePath === basePath)
  if (groupIndex === -1) {
    groups = [...groups, {
      id: newId(),
      doc: { name: plural, description: `${model.doc.name} management.` },
      design: { basePath },
      routes: []
    }]
    groupIndex = groups.length - 1
  }

  const group = groups[groupIndex]
  if (group === undefined) return { routeGroups: design.routeGroups, changed: false }

  let routes = group.routes
  let listIndex = routes.findIndex((r) => r.doc.match.method === 'GET' &&
    Object.values(r.design?.responses ?? {}).some((resp) => resp.modelId === model.id && resp.list === true))
  if (listIndex === -1) listIndex = routes.findIndex((r) => r.doc.match.method === 'GET' && routePathParams(r.doc.match.urlPattern).length === 0)
  if (listIndex === -1) {
    routes = [...routes, {
      id: newId(),
      doc: {
        match: { urlPattern: '/', method: 'GET' },
        summary: `List ${plural}`,
        responses: { '200': { description: `A page of ${plural}.` } }
      },
      design: {
        responses: { '200': { modelId: model.id, list: true, paginated: true } },
        pagination: { style: 'offset', defaultLimit: 20, maxLimit: 100 },
        idempotent: true
      }
    }]
    listIndex = routes.length - 1
  }

  const listRoute = routes[listIndex]
  if (listRoute === undefined) return { routeGroups: design.routeGroups, changed: false }

  const parameters = [...(listRoute.doc.parameters ?? [])]
  const links: Record<string, DesignParamLink> = { ...(listRoute.design?.paramLinks ?? {}) }
  let added = false
  for (const property of searchable) {
    const name = property.doc.name
    if (name === '' || parameters.some((p) => p.name === name && p.location === 'query')) continue
    parameters.push({ ...linkedParamDoc(name, 'query', property), required: false })
    links[name] = { modelId: model.id, propertyId: property.id, descriptionAuto: true }
    added = true
  }

  const changed = added || groups !== design.routeGroups || routes !== group.routes
  if (!changed) return { routeGroups: design.routeGroups, changed: false }

  const nextRoute: DesignRoute = {
    ...listRoute,
    doc: { ...listRoute.doc, parameters },
    design: { ...(listRoute.design ?? {}), paramLinks: links }
  }
  const nextRoutes = routes.map((r, i) => (i === listIndex ? nextRoute : r))
  const nextGroups = groups.map((g, i) => (i === groupIndex ? { ...g, routes: nextRoutes } : g))
  return { routeGroups: nextGroups, changed: true }
}
