/**
 * The doc→design prefill: build an editable `ApiDesign` from an env
 * folder's imported `ApiDocumentation` — the reverse of the
 * `apiDesignDoc` projection. Doc objects are carried VERBATIM into the
 * design entities (a design embeds doc shapes by construction), so no
 * doc field is lost; the design-only extensions are DERIVED where the
 * doc carries the fact (references from `targetModelRef`, bodies and
 * response models from the documented schemas). One derivation gap:
 * a response whose schema names an ENUM-shaped component keeps its
 * doc `schema` string but gets no design-side model link (the meta
 * only points at models) — the projection still emits the schema.
 */

import type {
  ApiDesign,
  DesignAuthKind,
  DesignEnum,
  DesignModel,
  DesignProperty,
  DesignResponseMeta,
  DesignRoute,
  DesignRouteGroup
} from '../types/apiDesign'
import type {
  ApiDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  SecurityScheme
} from '../types/apiDocumentation'

/** `{param}` (spec spelling) → `{{param}}` (Restorm request spelling).
 * Already-doubled braces are left alone. */
export function specPathToRestorm(urlPattern: string): string {
  return urlPattern.replace(/\{\{?([^{}]+?)\}?\}/g, '{{$1}}')
}

/** A model schema whose top level is an enum (values, no properties)
 * becomes a design ENUM, not a model. */
export function isEnumShapedModel(model: ModelDocumentation): boolean {
  return Array.isArray(model.enumValues) && model.enumValues.length > 0 && model.properties.length === 0
}

/** `array<Pet>` → { name: 'Pet', isArray: true }; `Pet` → plain. */
function parseTypeLabel(label: string): { name: string; isArray: boolean } {
  const array = /^array<(.+)>$/.exec(label)
  if (array?.[1] !== undefined) return { name: array[1], isArray: true }
  return { name: label, isArray: false }
}

/** The design-level default auth a spec's security setup implies. */
export function defaultAuthFromSecurity(
  defaultSecurity: Record<string, string[]>[] | undefined,
  schemes: Record<string, SecurityScheme> | undefined
): DesignAuthKind | undefined {
  const firstRequirement = defaultSecurity?.[0]
  if (firstRequirement === undefined || schemes === undefined) return undefined
  const schemeName = Object.keys(firstRequirement)[0]
  if (schemeName === undefined) return undefined
  const scheme = schemes[schemeName]
  if (scheme === undefined) return undefined
  if (scheme.type === 'http' && scheme.scheme === 'bearer') return 'bearer'
  if (scheme.type === 'http' && scheme.scheme === 'basic') return 'basic'
  if (scheme.type === 'basic') return 'basic'
  if (scheme.type === 'apiKey' && scheme.in === 'header') return 'apiKeyHeader'
  return undefined
}

export function designFromDocumentation(
  name: string,
  doc: ApiDocumentation,
  newId: () => string
): ApiDesign {
  // ── Components: models vs enums. Two passes — ids are registered
  // for EVERY name first, so property references can point at models
  // and enums declared later in the map.
  const modelIdByName = new Map<string, string>()
  const enumIdByName = new Map<string, string>()
  const componentEntries = Object.entries(doc.models)
  for (const [componentName, model] of componentEntries) {
    if (isEnumShapedModel(model)) enumIdByName.set(componentName, newId())
    else modelIdByName.set(componentName, newId())
  }

  const wrapProperty = (property: ModelDocumentation['properties'][number]): DesignProperty => {
    const wrapped: DesignProperty = { id: newId(), doc: property }
    const target = property.targetModelRef
    if (target !== undefined) {
      const modelId = modelIdByName.get(target)
      const enumId = modelId === undefined ? enumIdByName.get(target) : undefined
      if (modelId !== undefined) {
        wrapped.design = { reference: { target: 'model', refId: modelId } }
      } else if (enumId !== undefined) {
        wrapped.design = { reference: { target: 'enum', refId: enumId } }
      }
    }
    return wrapped
  }

  const models: DesignModel[] = []
  const enums: DesignEnum[] = []
  for (const [componentName, model] of componentEntries) {
    const enumId = enumIdByName.get(componentName)
    if (enumId !== undefined) {
      enums.push({ id: enumId, doc: model })
      continue
    }
    const modelId = modelIdByName.get(componentName)
    if (modelId === undefined) continue
    const { properties, ...modelDoc } = model
    models.push({ id: modelId, doc: modelDoc, properties: properties.map(wrapProperty) })
  }

  // ── Operations → route groups.
  const groups: DesignRouteGroup[] = []
  const groupByName = new Map<string, DesignRouteGroup>()

  const groupFor = (operation: OperationDocumentation): DesignRouteGroup => {
    const groupName = operation.group ?? operation.tags?.[0] ?? doc.api.title
    const existing = groupByName.get(groupName)
    if (existing !== undefined) return existing
    const fresh: DesignRouteGroup = {
      id: newId(),
      doc: doc.groups[groupName] ?? { name: groupName },
      routes: []
    }
    groupByName.set(groupName, fresh)
    groups.push(fresh)
    return fresh
  }

  for (const operation of doc.operations) {
    const group = groupFor(operation)

    // The virtual `body` parameter row (Swagger 2.0 spelling, and what
    // the OAS3 transformers synthesize) becomes the route's body
    // contract; it is NOT kept as a parameter row — the route editor
    // has no body location, the combo carries the fact.
    const parameters = operation.parameters ?? []
    const bodyParam = parameters.find((p) => p.location === 'body')
    const keptParameters = parameters.filter((p) => p.location !== 'body')

    const routeDesign: NonNullable<DesignRoute['design']> = {}
    if (bodyParam !== undefined) {
      const { name: bodyModelName } = parseTypeLabel(bodyParam.type)
      const modelId = modelIdByName.get(bodyModelName)
      routeDesign.body = {
        ...(modelId !== undefined ? { modelId } : {}),
        contentType: operation.consumes?.[0] ?? 'application/json'
      }
    }

    const responses: Record<string, DesignResponseMeta> = {}
    for (const [code, response] of Object.entries(operation.responses ?? {})) {
      if (response.schema === undefined) continue
      const { name: responseModelName, isArray } = parseTypeLabel(response.schema)
      const modelId = modelIdByName.get(responseModelName)
      if (modelId === undefined) continue
      responses[code] = { modelId, ...(isArray ? { list: true } : {}) }
    }
    if (Object.keys(responses).length > 0) routeDesign.responses = responses

    const route: DesignRoute = {
      id: newId(),
      doc: {
        ...operation,
        match: { ...operation.match, urlPattern: specPathToRestorm(operation.match.urlPattern) },
        parameters: keptParameters
      }
    }
    if (Object.keys(routeDesign).length > 0) route.design = routeDesign
    group.routes.push(route)
  }

  const defaultAuth = defaultAuthFromSecurity(doc.defaultSecurity, doc.securitySchemes)

  return {
    type: 'design',
    id: newId(),
    name,
    tags: [],
    info: doc.api,
    ...(doc.server !== undefined ? { server: doc.server } : {}),
    ...(doc.securitySchemes !== undefined ? { securitySchemes: doc.securitySchemes } : {}),
    ...(doc.defaultSecurity !== undefined ? { defaultSecurity: doc.defaultSecurity } : {}),
    ...(defaultAuth !== undefined ? { defaultAuth } : {}),
    models,
    enums,
    routeGroups: groups
  }
}
