/**
 * GraphQL projection of an API design.
 *
 * Models become object types, enums become GraphQL enums, and the
 * design's ROUTES drive the operation roots: bound GET routes become
 * queries (list routes take `limit`/`offset`, single routes take their
 * path parameters), bound write routes become mutations (POST/PUT/PATCH
 * carry an `input` built from the body model's writable properties,
 * DELETE answers `Boolean`). Everything derives from ONE operation
 * table — `designGraphqlOperations` — so the emitted SDL and the
 * serving resolvers can never drift apart.
 *
 * The resolvers are plain functions over the same serving kernel as the
 * HTTP projection ({@link ./designServing}) — named examples first,
 * seeded faker beyond them. Building the EXECUTABLE schema (graphql-yoga
 * `createSchema`) is main-process territory; this module stays pure.
 */

import type { ApiDesign, DesignEnum, DesignModel, DesignResponseMeta, DesignRoute } from '../types/apiDesign'
import { buildListPage, buildModelInstance, servedProperties } from './designServing'
import { routePathParams } from './designRoutes'

// ── Names ─────────────────────────────────────────────────────────────

/** Sanitize to a valid GraphQL name (`[_A-Za-z][_0-9A-Za-z]*`). */
export function sanitizeGraphqlName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^_0-9A-Za-z]+/g, '_').replace(/^_+|_+$/g, '')
  const named = cleaned === '' ? fallback : cleaned
  return /^[0-9]/.test(named) ? `_${named}` : named
}

/** A GraphQL enum VALUE additionally excludes the literal keywords. */
function sanitizeEnumValue(raw: string, index: number): string {
  const name = sanitizeGraphqlName(raw, `VALUE_${index}`)
  return name === 'true' || name === 'false' || name === 'null' ? `${name.toUpperCase()}_` : name
}

function upperFirst(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1)
}

/** Camel-join free text: `Delete a User` → `deleteAUser`. */
function camelize(text: string): string {
  const words = text.split(/[^0-9A-Za-z]+/).filter((w) => w !== '')
  if (words.length === 0) return 'operation'
  return words.map((word, i) => (i === 0 ? lowerFirst(word) : upperFirst(word))).join('')
}

/** The stable naming tables every projection consumer shares. */
export interface GraphqlNames {
  /** modelId → object type name. */
  models: Map<string, string>
  /** enumId → enum type name. */
  enums: Map<string, string>
  /** enumId → (raw design value → sanitized GraphQL enum value). */
  enumValues: Map<string, Map<string, string>>
}

/** Build collision-free PascalCase type names for models and enums. */
export function designGraphqlNames(design: ApiDesign): GraphqlNames {
  const taken = new Set<string>(['Query', 'Mutation', 'Subscription'])
  const claim = (base: string): string => {
    let name = base
    let n = 2
    while (taken.has(name)) { name = `${base}${n}`; n += 1 }
    taken.add(name)
    return name
  }
  const names: GraphqlNames = { models: new Map(), enums: new Map(), enumValues: new Map() }
  for (const model of design.models) {
    names.models.set(model.id, claim(upperFirst(sanitizeGraphqlName(model.doc.name, 'Model'))))
  }
  for (const enum_ of design.enums) {
    names.enums.set(enum_.id, claim(upperFirst(sanitizeGraphqlName(enum_.doc.name, 'Enum'))))
    const values = new Map<string, string>()
    ;(enum_.doc.enumValues ?? []).forEach((value, index) => {
      values.set(String(value), sanitizeEnumValue(String(value), index))
    })
    names.enumValues.set(enum_.id, values)
  }
  return names
}

// ── Field types ───────────────────────────────────────────────────────

/** Map a design property to its GraphQL field type (no null marker). */
function fieldType(names: GraphqlNames, property: DesignModel['properties'][number]): string {
  const reference = property.design?.reference
  if (reference !== undefined) {
    const target = reference.target === 'model'
      ? names.models.get(reference.refId)
      : names.enums.get(reference.refId)
    if (target !== undefined) {
      return property.doc.isArrayOfRef === true ? `[${target}!]` : target
    }
  }
  const label = property.doc.type
  const array = /^array<(.+)>$/.exec(label)
  if (array?.[1] !== undefined) return `[${scalarType(array[1])}!]`
  if (label === 'array') return `[${scalarType(property.design?.arrayItems?.type ?? 'string')}!]`
  return scalarType(label)
}

/** Scalar label → GraphQL scalar (unmapped shapes serve as String). */
function scalarType(label: string): string {
  if (label === 'integer') return 'Int'
  if (label === 'number') return 'Float'
  if (label === 'boolean') return 'Boolean'
  return 'String'
}

/** The model's identifier property id, when declared. */
function identifierPropertyId(model: DesignModel): string | undefined {
  return model.design?.identifier?.propertyId
}

// ── Operation table ───────────────────────────────────────────────────

export interface GraphqlOperation {
  kind: 'query' | 'mutation'
  fieldName: string
  /** SDL argument list, e.g. `[['id', 'ID!'], ['limit', 'Int']]`. */
  args: [string, string][]
  /** SDL return type, e.g. `[User!]!` or `User`. */
  returnType: string
  route: DesignRoute
  /** Response model (absent on DELETE-shaped mutations). */
  model?: DesignModel
  /** Body model whose writable properties form the `input` argument. */
  inputModel?: DesignModel
  list: boolean
}

/**
 * Derive the GraphQL operations from the design's routes. Only routes
 * with a bound success-response model (or, for writes, a bound body
 * model) project — an unbound route has no shape to answer with.
 */
export function designGraphqlOperations(design: ApiDesign): GraphqlOperation[] {
  const names = designGraphqlNames(design)
  const operations: GraphqlOperation[] = []
  const takenFields = new Set<string>()
  const claimField = (base: string): string => {
    let name = base
    let n = 2
    while (takenFields.has(name)) { name = `${base}${n}`; n += 1 }
    takenFields.add(name)
    return name
  }

  for (const group of design.routeGroups) {
    for (const route of group.routes) {
      const method = (route.doc.match.method ?? 'GET').toUpperCase()
      const responseMeta = successResponseMeta(route)
      const responseModel = responseMeta?.modelId !== undefined
        ? design.models.find((m) => m.id === responseMeta.modelId)
        : undefined
      const bodyModel = route.design?.body?.modelId !== undefined
        ? design.models.find((m) => m.id === route.design?.body?.modelId)
        : undefined
      const params = routePathParams(route.doc.match.urlPattern)

      if (method === 'GET') {
        if (responseModel === undefined) continue
        const typeName = names.models.get(responseModel.id) ?? 'String'
        const list = responseMeta?.list === true
        const base = lowerFirst(sanitizeGraphqlName(
          route.doc.operationId ?? (list ? `${typeName}List` : typeName),
          list ? 'list' : 'item'
        ))
        const args: [string, string][] = params.map((p) => [sanitizeGraphqlName(p, 'id'), 'ID!'])
        if (list) args.push(['limit', 'Int'], ['offset', 'Int'])
        operations.push({
          kind: 'query',
          fieldName: claimField(base),
          args,
          returnType: list ? `[${typeName}!]!` : typeName,
          route,
          model: responseModel,
          list
        })
        continue
      }

      if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
        const model = responseModel ?? bodyModel
        if (method !== 'DELETE' && model === undefined) continue
        const typeName = model !== undefined ? names.models.get(model.id) ?? 'String' : 'Boolean'
        // A model-less DELETE names off its summary (`Delete a User` →
        // `deleteAUser`) — `deleteBoolean` would name the return type.
        const fallback = model !== undefined
          ? `${method.toLowerCase()}${typeName}`
          : camelize(route.doc.summary ?? `${method.toLowerCase()}Item`)
        const base = lowerFirst(sanitizeGraphqlName(route.doc.operationId ?? fallback, 'mutate'))
        const args: [string, string][] = params.map((p) => [sanitizeGraphqlName(p, 'id'), 'ID!'])
        const inputModel = method === 'DELETE' ? undefined : bodyModel ?? model
        if (inputModel !== undefined) {
          const inputName = names.models.get(inputModel.id)
          if (inputName !== undefined) args.push(['input', `${inputName}Input`])
        }
        const operation: GraphqlOperation = {
          kind: 'mutation',
          fieldName: claimField(base),
          args,
          returnType: method === 'DELETE' ? 'Boolean' : typeName,
          route,
          list: false
        }
        if (model !== undefined && method !== 'DELETE') operation.model = model
        if (inputModel !== undefined) operation.inputModel = inputModel
        operations.push(operation)
      }
    }
  }
  return operations
}

function successResponseMeta(route: DesignRoute): DesignResponseMeta | undefined {
  const responses = route.design?.responses ?? {}
  const codes = Object.keys(responses).filter((code) => code.startsWith('2')).sort()
  const first = codes[0]
  return first === undefined ? undefined : responses[first]
}

// ── SDL emission ──────────────────────────────────────────────────────

/** Emit the design's GraphQL SDL (schema definition language). */
export function designToGraphqlSdl(design: ApiDesign): string {
  const names = designGraphqlNames(design)
  const operations = designGraphqlOperations(design)
  const lines: string[] = []

  for (const enum_ of design.enums) {
    const name = names.enums.get(enum_.id)
    const values = enum_.doc.enumValues ?? []
    if (name === undefined || values.length === 0) continue
    pushDescription(lines, enum_.doc.description)
    lines.push(`enum ${name} {`)
    for (const value of values) {
      lines.push(`  ${names.enumValues.get(enum_.id)?.get(String(value)) ?? String(value)}`)
    }
    lines.push('}', '')
  }

  for (const model of design.models) {
    const name = names.models.get(model.id)
    if (name === undefined) continue
    const properties = servedProperties(design, model)
    if (properties.length === 0) continue
    pushDescription(lines, model.doc.description)
    lines.push(`type ${name} {`)
    for (const { property } of properties) {
      if (property.doc.name === '') continue
      const marker = property.doc.required && property.doc.nullable !== true ? '!' : ''
      lines.push(`  ${sanitizeGraphqlName(property.doc.name, 'field')}: ${fieldType(names, property)}${marker}`)
    }
    lines.push('}', '')
  }

  // Input types: one per model used as a mutation input — the writable
  // scalar/enum surface (readOnly properties and model references stay
  // out; a reference travels as its identifier).
  const inputModels = new Map<string, DesignModel>()
  for (const operation of operations) {
    if (operation.inputModel !== undefined) inputModels.set(operation.inputModel.id, operation.inputModel)
  }
  for (const model of inputModels.values()) {
    const name = names.models.get(model.id)
    if (name === undefined) continue
    lines.push(`input ${name}Input {`)
    for (const { property } of servedProperties(design, model)) {
      if (property.doc.name === '' || property.doc.readOnly === true) continue
      const reference = property.design?.reference
      const type = reference?.target === 'model'
        ? (property.doc.isArrayOfRef === true ? '[ID!]' : 'ID')
        : fieldType(names, property)
      lines.push(`  ${sanitizeGraphqlName(property.doc.name, 'field')}: ${type}`)
    }
    lines.push('}', '')
  }

  const queries = operations.filter((o) => o.kind === 'query')
  lines.push('type Query {')
  if (queries.length === 0) {
    lines.push('  _status: String')
  }
  for (const operation of queries) {
    pushDescription(lines, operation.route.doc.summary, '  ')
    lines.push(`  ${fieldSdl(operation)}`)
  }
  lines.push('}')

  const mutations = operations.filter((o) => o.kind === 'mutation')
  if (mutations.length > 0) {
    lines.push('', 'type Mutation {')
    for (const operation of mutations) {
      pushDescription(lines, operation.route.doc.summary, '  ')
      lines.push(`  ${fieldSdl(operation)}`)
    }
    lines.push('}')
  }

  return `${lines.join('\n')}\n`
}

function fieldSdl(operation: GraphqlOperation): string {
  const args = operation.args.length > 0
    ? `(${operation.args.map(([name, type]) => `${name}: ${type}`).join(', ')})`
    : ''
  return `${operation.fieldName}${args}: ${operation.returnType}`
}

function pushDescription(lines: string[], text: string | undefined, indent = ''): void {
  if (text === undefined || text.trim() === '' || text.includes('"""')) return
  lines.push(`${indent}"""${text.trim()}"""`)
}

// ── Resolvers ─────────────────────────────────────────────────────────

/** graphql-yoga's resolver-map shape (mirrors `graphqlMockSchema`). */
export type DesignResolverMap = Record<string, Record<string, unknown>>

/**
 * Build the resolver map serving the design's data: list queries page
 * through the serving kernel, single queries match a named example by
 * identifier (seeded instance otherwise), mutations echo their input
 * over a served instance. Values of enum-typed properties are mapped to
 * their sanitized GraphQL spelling on the way out.
 */
export function designGraphqlResolvers(design: ApiDesign): DesignResolverMap {
  const names = designGraphqlNames(design)
  const operations = designGraphqlOperations(design)
  const query: Record<string, unknown> = {}
  const mutation: Record<string, unknown> = {}

  for (const operation of operations) {
    const target = operation.kind === 'query' ? query : mutation
    target[operation.fieldName] = buildResolver(design, names, operation)
  }
  if (Object.keys(query).length === 0) {
    query['_status'] = () => 'ok'
  }

  const map: DesignResolverMap = { Query: query }
  if (Object.keys(mutation).length > 0) map['Mutation'] = mutation
  return map
}

type ResolverArgs = Record<string, unknown>

function buildResolver(design: ApiDesign, names: GraphqlNames, operation: GraphqlOperation) {
  return (_parent: unknown, rawArgs: ResolverArgs | undefined): unknown => {
    const args = rawArgs ?? {}
    const model = operation.model
    if (operation.kind === 'mutation' && model === undefined) return true

    if (model === undefined) return null
    if (operation.list) {
      const page = buildListPage(design, model, operation.route, {
        ...(typeof args['limit'] === 'number' ? { limit: String(args['limit']) } : {}),
        ...(typeof args['offset'] === 'number' ? { offset: String(args['offset']) } : {})
      })
      return page.items.map((item) => sanitizeInstanceEnums(design, names, model, item))
    }

    const idArg = firstIdArgument(operation, args)
    let instance = idArg !== undefined
      ? identifiedInstance(design, model, idArg)
      : buildModelInstance(design, model, { seedKey: 'single' })
    const input = args['input']
    if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
      instance = { ...instance, ...(input as Record<string, unknown>) }
    }
    return sanitizeInstanceEnums(design, names, model, instance)
  }
}

function firstIdArgument(operation: GraphqlOperation, args: ResolverArgs): string | undefined {
  for (const [name, type] of operation.args) {
    if (type !== 'ID!' && type !== 'ID') continue
    const value = args[name]
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
  }
  return undefined
}

/** The "GET /res/{id} → the matching named example" contract, shared
 * with the HTTP projection: an identifier value matching a named
 * example serves that example; anything else serves a seeded instance
 * keyed by the value. */
function identifiedInstance(design: ApiDesign, model: DesignModel, idValue: string): Record<string, unknown> {
  const identifierId = identifierPropertyId(model)
  const identifierName = identifierId !== undefined
    ? model.properties.find((p) => p.id === identifierId)?.doc.name
    : undefined
  if (identifierName !== undefined) {
    for (const example of model.examples ?? []) {
      const instance = buildModelInstance(design, model, { exampleId: example.id, seedKey: idValue })
      if (String(instance[identifierName]) === idValue) return instance
    }
  }
  return buildModelInstance(design, model, { seedKey: idValue })
}

/** Rewrite enum-typed property values to their sanitized GraphQL
 * spelling (a served `in-progress` must leave as `in_progress` or the
 * schema rejects its own data). */
function sanitizeInstanceEnums(
  design: ApiDesign,
  names: GraphqlNames,
  model: DesignModel,
  instance: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...instance }
  for (const { property } of servedProperties(design, model)) {
    const name = property.doc.name
    const reference = property.design?.reference
    if (reference?.target === 'enum') {
      const values = names.enumValues.get(reference.refId)
      const raw = out[name]
      if (values !== undefined && typeof raw === 'string' && values.has(raw)) {
        out[name] = values.get(raw)
      }
      continue
    }
    // A nested model instance sanitizes recursively (its own enum and
    // map values face the same serializers).
    if (reference?.target === 'model') {
      const target = design.models.find((m) => m.id === reference.refId)
      const nested = out[name]
      if (target !== undefined && nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
        out[name] = sanitizeInstanceEnums(design, names, target, nested as Record<string, unknown>)
      }
      continue
    }
    // `map`/`any` project as String — an object value must leave as its
    // JSON text or the scalar serializer rejects the served row.
    if ((property.doc.type === 'map' || property.doc.type === 'any') && typeof out[name] === 'object' && out[name] !== null) {
      out[name] = JSON.stringify(out[name])
    }
  }
  return out
}

/** Referenced for enum typing in `fieldType`; exported for tests. */
export function designEnumByRef(design: ApiDesign, refId: string): DesignEnum | undefined {
  return design.enums.find((e) => e.id === refId)
}
