/**
 * gRPC projection of an API design.
 *
 * Models become protobuf messages, list responses get a `<Model>List`
 * wrapper, and every ROUTE becomes a unary rpc on one service — the
 * natural gRPC reading of the design. The emitted `.proto` (proto3) is
 * loadable by `@grpc/proto-loader`, and the served messages are built on
 * the same serving kernel as every other projection (named examples
 * first, seeded faker beyond them), so a gRPC call returns the same
 * deterministic data an HTTP/OData/SOAP call would.
 *
 * Enum-typed fields are projected as `string` (with the allowed values
 * documented in a leading comment) rather than proto enums: it keeps the
 * served value identical to the other projections (`"active"`, not a
 * remapped `STATUS_ACTIVE` constant) and sidesteps proto3's package-wide
 * enum-constant scoping.
 */

import type { ApiDesign, DesignModel, DesignRoute, DesignRouteGroup } from '../types/apiDesign'
import { buildListPage, buildModelInstance, resolvePageWindow, servedProperties } from './designServing'

type Property = DesignModel['properties'][number]

// ── Names ─────────────────────────────────────────────────────────────

/** Sanitize to a proto identifier (`[A-Za-z_][A-Za-z0-9_]*`). */
function protoIdent(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  const named = cleaned === '' ? fallback : cleaned
  return /^[0-9]/.test(named) ? `_${named}` : named
}

function upperFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1)
}

/** Coerce a scalar design value to a string, dropping non-scalars. */
function scalarToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return ''
}

/** A PascalCase proto message/service/method name — every alphanumeric
 * run becomes a capitalised word (`"List users"` → `ListUsers`). */
function protoTypeName(raw: string, fallback: string): string {
  const joined = raw.split(/[^A-Za-z0-9]+/).filter((part) => part !== '').map(upperFirst).join('')
  const named = joined === '' ? fallback : joined
  return /^[0-9]/.test(named) ? `_${named}` : named
}

/** The proto package the design projects into. */
export function designProtoPackage(design: ApiDesign): string {
  const base = design.info.title !== '' ? design.info.title : design.name
  return protoIdent(base, 'design').toLowerCase()
}

/** The single service name. */
export function designProtoServiceName(design: ApiDesign): string {
  return `${protoTypeName(design.info.title !== '' ? design.info.title : design.name, 'Design')}Service`
}

// ── Field typing ──────────────────────────────────────────────────────

function protoScalar(label: string, format: string | undefined): string {
  if (label === 'integer') return format === 'int64' ? 'int64' : 'int32'
  if (label === 'number') return 'double'
  if (label === 'boolean') return 'bool'
  return 'string'
}

interface FieldType {
  type: string
  repeated: boolean
  /** Allowed enum values, when the field references a design enum. */
  enumValues?: string[]
  /** The referenced model, when the field is a message (model ref). */
  model?: DesignModel
}

/** The proto field type for a design property. */
function protoFieldType(design: ApiDesign, property: Property): FieldType {
  const reference = property.design?.reference
  if (reference !== undefined) {
    if (reference.target === 'enum') {
      const enum_ = design.enums.find((e) => e.id === reference.refId)
      const values = (enum_?.doc.enumValues ?? []).map(scalarToString).filter((v) => v !== '')
      return { type: 'string', repeated: property.doc.isArrayOfRef === true, enumValues: values }
    }
    const model = design.models.find((m) => m.id === reference.refId)
    if (model !== undefined) {
      return { type: protoTypeName(model.doc.name, 'Message'), repeated: property.doc.isArrayOfRef === true, model }
    }
  }
  const label = property.doc.type
  const array = /^array<(.+)>$/.exec(label)
  if (array?.[1] !== undefined) return { type: protoScalar(array[1], undefined), repeated: true }
  if (label === 'array') {
    return { type: protoScalar(property.design?.arrayItems?.type ?? 'string', undefined), repeated: true }
  }
  return { type: protoScalar(label, property.doc.format), repeated: false }
}

// ── Method derivation ─────────────────────────────────────────────────

export interface GrpcMethod {
  /** rpc name, e.g. `ListUsers`. */
  name: string
  requestType: string
  responseType: string
  route: DesignRoute
  group: DesignRouteGroup
  /** Bound success-response model (absent = Empty reply). */
  model?: DesignModel
  list: boolean
  /** Named example the success response serves (single reply only). */
  exampleId?: string
  /** Path-parameter field names carried on the request message. */
  pathParams: string[]
}

/** `{{id}}` / `{id}` path-parameter names, in path order. */
function pathParamNames(urlPattern: string): string[] {
  const names: string[] = []
  const re = /\{\{?([A-Za-z0-9_]+)\}?\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(urlPattern)) !== null) {
    const name = m[1]
    if (name !== undefined) names.push(name)
  }
  return names
}

/** Derive the gRPC methods — one unary rpc per route, collision-free. */
export function designGrpcMethods(design: ApiDesign): GrpcMethod[] {
  const taken = new Set<string>()
  const methods: GrpcMethod[] = []
  for (const group of design.routeGroups) {
    for (const route of group.routes) {
      const method = (route.doc.match.method ?? 'GET').toUpperCase()
      const seed = route.doc.operationId
        ?? route.doc.summary
        ?? `${upperFirst(method.toLowerCase())}${protoTypeName(route.doc.match.urlPattern, 'Route')}`
      const base = protoTypeName(seed, 'Call')
      let name = base
      let n = 2
      while (taken.has(name)) { name = `${base}${n}`; n += 1 }
      taken.add(name)

      const responses = route.design?.responses ?? {}
      const codes = Object.keys(responses).filter((c) => c.startsWith('2')).sort()
      const meta = codes[0] !== undefined ? responses[codes[0]] : undefined
      const model = meta?.modelId !== undefined ? design.models.find((m) => m.id === meta.modelId) : undefined
      const list = meta?.list === true

      const entry: GrpcMethod = {
        name,
        requestType: `${name}Request`,
        responseType: model === undefined
          ? 'Empty'
          : list
            ? `${protoTypeName(model.doc.name, 'Message')}List`
            : protoTypeName(model.doc.name, 'Message'),
        route,
        group,
        list,
        pathParams: pathParamNames(route.doc.match.urlPattern).map((p) => protoIdent(p, 'param'))
      }
      if (model !== undefined) entry.model = model
      if (meta?.exampleId !== undefined) entry.exampleId = meta.exampleId
      methods.push(entry)
    }
  }
  return methods
}

// ── .proto emission ───────────────────────────────────────────────────

/** A name allocator that suffixes collisions (`Foo`, `Foo2`, `Foo3`). */
function makeUniquifier(reserved: readonly string[]): (base: string) => string {
  const taken = new Set<string>(reserved)
  return (base) => {
    let name = base
    let n = 2
    while (taken.has(name)) { name = `${base}${String(n)}`; n += 1 }
    taken.add(name)
    return name
  }
}

/**
 * Collision-free proto type names for one design. Message, list-wrapper
 * and per-method request names are allocated from ONE pool (reserving the
 * built-in `Empty`), so two models that sanitize to the same identifier —
 * or a model literally named `Empty`, or a request that shadows a message
 * — never emit a duplicate `message` (which would make proto-loader throw
 * and silently disable the whole gRPC projection).
 */
interface ProtoNames {
  /** model.id → message name. */
  message: Map<string, string>
  /** model.id → `<Message>List` wrapper name. */
  list: Map<string, string>
  /** request message name per method (index-aligned with `methods`). */
  request: string[]
}

function buildProtoNames(design: ApiDesign, methods: GrpcMethod[]): ProtoNames {
  const uniq = makeUniquifier(['Empty'])
  const message = new Map<string, string>()
  for (const model of design.models) {
    message.set(model.id, uniq(protoTypeName(model.doc.name, 'Message')))
  }
  const list = new Map<string, string>()
  for (const m of methods) {
    if (m.list && m.model !== undefined && !list.has(m.model.id)) {
      const base = message.get(m.model.id) ?? protoTypeName(m.model.doc.name, 'Message')
      list.set(m.model.id, uniq(`${base}List`))
    }
  }
  const request = methods.map((m) => uniq(`${m.name}Request`))
  return { message, list, request }
}

/** Emit a message's fields, deduping field names within the message
 * (an inherited property re-declared by a child, or two names that
 * sanitize alike, would otherwise repeat a field name → invalid proto). */
function messageFields(design: ApiDesign, model: DesignModel, names: ProtoNames): string[] {
  const lines: string[] = []
  const takenFields = new Set<string>()
  let n = 1
  for (const { property } of servedProperties(design, model)) {
    const ft = protoFieldType(design, property)
    let field = protoIdent(property.doc.name, `field_${String(n)}`)
    if (takenFields.has(field)) {
      let k = 2
      while (takenFields.has(`${field}_${String(k)}`)) k += 1
      field = `${field}_${String(k)}`
    }
    takenFields.add(field)
    const type = ft.model !== undefined ? (names.message.get(ft.model.id) ?? ft.type) : ft.type
    if (ft.enumValues !== undefined && ft.enumValues.length > 0) {
      lines.push(`  // enum: ${ft.enumValues.join(' | ')}`)
    }
    lines.push(`  ${ft.repeated ? 'repeated ' : ''}${type} ${field} = ${String(n)};`)
    n += 1
  }
  return lines
}

/** Emit the design's `.proto` (proto3). */
export function designToProto(design: ApiDesign): string {
  const pkg = designProtoPackage(design)
  const methods = designGrpcMethods(design)
  const names = buildProtoNames(design, methods)
  const out: string[] = ['syntax = "proto3";', '', `package ${pkg};`, '', 'message Empty {}', '']

  // One message per model.
  for (const model of design.models) {
    out.push(`message ${names.message.get(model.id) ?? protoTypeName(model.doc.name, 'Message')} {`)
    out.push(...messageFields(design, model, names))
    out.push('}', '')
  }

  // A List wrapper for every model returned as a list.
  const emittedWrappers = new Set<string>()
  for (const m of methods) {
    if (!m.list || m.model === undefined) continue
    const wrapper = names.list.get(m.model.id)
    if (wrapper === undefined || emittedWrappers.has(wrapper)) continue
    emittedWrappers.add(wrapper)
    const item = names.message.get(m.model.id) ?? protoTypeName(m.model.doc.name, 'Message')
    out.push(
      `message ${wrapper} {`,
      `  repeated ${item} items = 1;`,
      '  int32 total = 2;',
      '  int32 limit = 3;',
      '  int32 offset = 4;',
      '}',
      ''
    )
  }

  // One request message per method: path params, pagination (lists), body —
  // deduping field names (a path param literally named `limit`/`offset`/
  // `body` would otherwise collide with the ones added here).
  methods.forEach((m, i) => {
    out.push(`message ${names.request[i]} {`)
    const takenFields = new Set<string>()
    let n = 1
    const emit = (type: string, base: string): void => {
      let field = base
      if (takenFields.has(field)) {
        let k = 2
        while (takenFields.has(`${field}_${String(k)}`)) k += 1
        field = `${field}_${String(k)}`
      }
      takenFields.add(field)
      out.push(`  ${type} ${field} = ${String(n)};`)
      n += 1
    }
    for (const p of m.pathParams) emit('string', p)
    if (m.list) { emit('int32', 'limit'); emit('int32', 'offset') }
    const bodyId = m.route.design?.body?.modelId
    const bodyModel = bodyId !== undefined ? design.models.find((md) => md.id === bodyId) : undefined
    if (bodyModel !== undefined) {
      emit(names.message.get(bodyModel.id) ?? protoTypeName(bodyModel.doc.name, 'Message'), 'body')
    }
    out.push('}', '')
  })

  // The service.
  out.push(`service ${designProtoServiceName(design)} {`)
  methods.forEach((m, i) => {
    const response = m.model === undefined
      ? 'Empty'
      : m.list
        ? (names.list.get(m.model.id) ?? 'Empty')
        : (names.message.get(m.model.id) ?? 'Empty')
    out.push(`  rpc ${m.name} (${names.request[i]}) returns (${response});`)
  })
  out.push('}', '')
  return out.join('\n')
}

// ── Response resolution ───────────────────────────────────────────────

/** A plain object (not an array). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Coerce one served scalar/message value to its proto field type — the
 * JSON-shaped kernel output must satisfy protobuf's strict wire types
 * (an object for a message, a number for an int, a string for the rest,
 * with a non-scalar folded to JSON). */
function protoScalarOrMessage(design: ApiDesign, ft: FieldType, value: unknown): unknown {
  if (ft.model !== undefined) return isObject(value) ? toProtoShape(design, ft.model, value) : {}
  switch (ft.type) {
    case 'bool':
      return value === true
    case 'int32':
    case 'int64': {
      if (typeof value === 'number') return value
      const n = typeof value === 'string' ? Number(value) : NaN
      return Number.isFinite(n) ? n : 0
    }
    case 'double': {
      if (typeof value === 'number') return value
      const d = typeof value === 'string' ? Number(value) : NaN
      return Number.isFinite(d) ? d : 0
    }
    default:
      return isObject(value) || Array.isArray(value) ? JSON.stringify(value) : scalarToString(value)
  }
}

/** Coerce one served value to its (possibly repeated) proto field type. */
function protoValue(design: ApiDesign, ft: FieldType, value: unknown): unknown {
  if (ft.repeated) {
    const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
    return items.map((item) => protoScalarOrMessage(design, ft, item))
  }
  return protoScalarOrMessage(design, ft, value)
}

/** Re-key a served instance onto the sanitized proto field names, with
 * each value coerced to the field's proto wire type. */
function toProtoShape(design: ApiDesign, model: DesignModel, instance: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const { property } of servedProperties(design, model)) {
    const ft = protoFieldType(design, property)
    out[protoIdent(property.doc.name, 'field')] = protoValue(design, ft, instance[property.doc.name])
  }
  return out
}

/**
 * Resolve the reply for a gRPC method, honouring the same example-then-
 * faker contract as the HTTP serving. `request` is the decoded call
 * message (path params, limit/offset for lists).
 */
export function buildGrpcResponse(
  design: ApiDesign,
  method: GrpcMethod,
  request: Record<string, unknown>
): Record<string, unknown> {
  if (method.model === undefined) return {}
  const model = method.model
  if (method.list) {
    const query: Record<string, string> = {}
    if (typeof request['limit'] === 'number' && request['limit'] > 0) query['limit'] = String(request['limit'])
    if (typeof request['offset'] === 'number' && request['offset'] >= 0) query['offset'] = String(request['offset'])
    const window = resolvePageWindow(method.route, query)
    const page = buildListPage(design, model, method.route, query)
    return {
      items: page.items.map((row) => toProtoShape(design, model, row)),
      total: page.total,
      limit: window.limit,
      offset: window.offset
    }
  }
  // A single instance: the bound named example when the route declares
  // one, else a faker instance seeded by the path params so the same id
  // is stable across calls.
  const idSeed = method.pathParams.map((p) => scalarToString(request[p])).join(':')
  const seedKey = `grpc:${method.name}:${idSeed}`
  const instance = method.exampleId !== undefined
    ? buildModelInstance(design, model, { exampleId: method.exampleId, seedKey })
    : buildModelInstance(design, model, { seedKey })
  return toProtoShape(design, model, instance)
}
