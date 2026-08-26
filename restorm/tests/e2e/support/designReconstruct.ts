/**
 * Data-driven reconstruction of a Restorm API design through the MCP tools, plus
 * an id-normalising canonicaliser so a reconstructed design can be compared to a
 * golden reference (TASK-468 e2e). The golden carries internal ids everywhere
 * (references, route responses, param links, identifiers, example value keys);
 * the MCP builders resolve cross-references by NAME, so reconstruction walks the
 * golden translating ids → names, and the canonicaliser does the same to both
 * sides so the only remaining differences would be genuine fidelity gaps.
 */
import type {
  ApiDesign,
  DesignModel,
  DesignProperty,
  DesignRoute,
  DesignRouteGroup
} from '../../../src/shared/types/apiDesign'

type Args = Record<string, unknown>
type Tool = (name: string, args: Args) => Promise<Record<string, unknown>>

// ── golden lookups ────────────────────────────────────────────────────

const modelById = (g: ApiDesign, id: string): DesignModel | undefined => g.models.find((m) => m.id === id)
const modelName = (g: ApiDesign, id: string): string => modelById(g, id)?.doc.name ?? id
const enumName = (g: ApiDesign, id: string): string => g.enums.find((e) => e.id === id)?.doc.name ?? id

/** The full property chain of a model (root ancestor first), following
 * `design.inheritsFrom`, so an example's inherited-property value keys resolve. */
function propChain(g: ApiDesign, model: DesignModel): DesignProperty[] {
  const chain: DesignModel[] = []
  const seen = new Set<string>()
  let cur: DesignModel | undefined = model
  while (cur !== undefined && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.unshift(cur)
    const parentId: string | undefined = cur.design?.inheritsFrom
    cur = parentId === undefined ? undefined : modelById(g, parentId)
  }
  return chain.flatMap((m) => m.properties)
}
const propNameInChain = (g: ApiDesign, model: DesignModel, id: string): string =>
  propChain(g, model).find((p) => p.id === id)?.doc.name ?? id
const ownPropName = (model: DesignModel, id: string): string =>
  model.properties.find((p) => p.id === id)?.doc.name ?? id

// ── reconstruction ────────────────────────────────────────────────────

export async function reconstructDesign(callTool: Tool, g: ApiDesign): Promise<string> {
  const created = await callTool('create_design', {
    name: g.name,
    title: g.info.title,
    ...(g.server?.basePath !== undefined ? { basePath: g.server.basePath } : {})
  })
  const designId = String(created['id'])

  const upd: Args = { designId }
  if (g.info.version !== undefined) upd['version'] = g.info.version
  if (g.info.description !== undefined) upd['description'] = g.info.description
  if (g.defaultAuth !== undefined) upd['defaultAuth'] = g.defaultAuth
  if (g.serving?.protocols !== undefined) upd['protocols'] = g.serving.protocols
  if (g.serving?.port !== undefined) upd['port'] = g.serving.port
  if (g.serving?.grpcPort !== undefined) upd['grpcPort'] = g.serving.grpcPort
  if (g.serving?.latencyMs !== undefined) upd['latencyMs'] = g.serving.latencyMs
  if (g.serving?.stateful === true) upd['stateful'] = true
  if (Object.keys(upd).length > 1) await callTool('update_design', upd)

  for (const e of g.enums) {
    await callTool('create_design_enum', {
      designId, name: e.doc.name, values: e.doc.enumValues ?? [],
      ...(e.doc.description !== undefined ? { description: e.doc.description } : {})
    })
  }

  // Models: create all bare first (so inheritance + references resolve), then
  // fill inheritance / properties / identifier / examples.
  for (const m of g.models) {
    await callTool('create_design_model', {
      designId, name: m.doc.name,
      ...(m.doc.description !== undefined ? { description: m.doc.description } : {}),
      ...(m.intents?.volumetry !== undefined ? { volumetry: m.intents.volumetry } : {}),
      ...(m.design?.timestamps === true ? { timestamps: true } : {}),
      ...(m.design?.softDelete === true ? { softDelete: true } : {})
    })
  }
  for (const m of g.models) {
    if (m.design?.inheritsFrom !== undefined) {
      await callTool('update_design_model', { designId, model: m.doc.name, inheritsFrom: modelName(g, m.design.inheritsFrom) })
    }
    for (const p of m.properties) {
      const doc = p.doc
      const d = p.design
      const ref = d?.reference
      const args: Args = { designId, model: m.doc.name, name: doc.name }
      if (ref?.target === 'enum') {
        args['enumRef'] = enumName(g, ref.refId)
        if (doc.isArrayOfRef === true) args['isArray'] = true
      } else if (ref?.target === 'model') {
        args['modelRef'] = modelName(g, ref.refId)
        if (doc.isArrayOfRef === true) args['isArray'] = true
        if (ref.onDelete !== undefined) args['onDelete'] = ref.onDelete
      } else {
        args['type'] = doc.type
      }
      if (doc.format !== undefined) args['format'] = doc.format
      args['required'] = doc.required
      if (doc.description !== undefined) args['description'] = doc.description
      if (doc.example !== undefined) args['example'] = doc.example
      if (doc.nullable === true) args['nullable'] = true
      if (doc.readOnly === true) args['readOnly'] = true
      if (doc.deprecated === true) args['deprecated'] = true
      if (doc.constraints !== undefined && Object.keys(doc.constraints).length > 0) args['constraints'] = doc.constraints
      if (d?.unique === true) args['unique'] = true
      if (d?.searchable === true) args['searchable'] = true
      if (d?.immutable === true) args['immutable'] = true
      if (d?.writeOnly === true) args['writeOnly'] = true
      if (p.intents?.pii === true) args['pii'] = true
      if (d?.defaultValue !== undefined) args['defaultValue'] = d.defaultValue
      await callTool('set_design_property', args)
    }
    if (m.design?.identifier !== undefined) {
      await callTool('update_design_model', {
        designId, model: m.doc.name,
        identifierProperty: ownPropName(m, m.design.identifier.propertyId),
        identifierStrategy: m.design.identifier.strategy
      })
    }
    for (const ex of m.examples ?? []) {
      const values: Args = {}
      for (const [pid, val] of Object.entries(ex.values)) values[propNameInChain(g, m, pid)] = val
      await callTool('set_design_example', {
        designId, model: m.doc.name, name: ex.name, values,
        ...(ex.description !== undefined ? { description: ex.description } : {})
      })
    }
  }

  for (const grp of g.routeGroups) {
    await callTool('create_design_route_group', {
      designId, name: grp.doc.name,
      ...(grp.design?.basePath !== undefined ? { basePath: grp.design.basePath } : {}),
      ...(grp.design?.versionPrefix !== undefined ? { versionPrefix: grp.design.versionPrefix } : {}),
      ...(grp.design?.auth !== undefined ? { auth: grp.design.auth } : {}),
      ...(grp.doc.description !== undefined ? { description: grp.doc.description } : {})
    })
  }
  for (const grp of g.routeGroups) {
    for (const r of grp.routes) {
      const rc = await callTool('create_design_route', {
        designId, group: grp.doc.name, method: r.doc.match.method ?? 'GET', urlPattern: r.doc.match.urlPattern,
        ...(r.doc.summary !== undefined ? { summary: r.doc.summary } : {}),
        ...(r.doc.description !== undefined ? { description: r.doc.description } : {}),
        ...(r.doc.operationId !== undefined ? { operationId: r.doc.operationId } : {})
      })
      const route = typeof rc['id'] === 'string' ? rc['id'] : (r.doc.summary ?? '')
      const meta = r.design
      const u: Args = { designId, route }
      const docResponses = r.doc.responses ?? {}
      const metaResponses = meta?.responses ?? {}
      const codes = new Set([...Object.keys(docResponses), ...Object.keys(metaResponses)])
      if (codes.size > 0) {
        const responses: Args = {}
        for (const code of codes) {
          const docR = docResponses[code]
          const metaR = metaResponses[code]
          const entry: Args = {}
          if (docR?.description !== undefined) entry['description'] = docR.description
          if (metaR?.modelId !== undefined) {
            const mm = modelById(g, metaR.modelId)
            entry['modelRef'] = mm?.doc.name
            if (metaR.list === true) entry['list'] = true
            if (metaR.paginated === true) entry['paginated'] = true
            if (metaR.exampleId !== undefined && mm !== undefined) {
              entry['exampleName'] = (mm.examples ?? []).find((e) => e.id === metaR.exampleId)?.name
            }
          }
          responses[code] = entry
        }
        u['responses'] = responses
      }
      if (meta?.body?.modelId !== undefined) {
        u['body'] = { modelRef: modelById(g, meta.body.modelId)?.doc.name, ...(meta.body.contentType !== undefined ? { contentType: meta.body.contentType } : {}) }
      }
      if (meta?.paramLinks !== undefined) {
        const links: Args = {}
        for (const [pn, link] of Object.entries(meta.paramLinks)) {
          const mm = modelById(g, link.modelId)
          links[pn] = { modelRef: mm?.doc.name, propertyRef: mm !== undefined ? ownPropName(mm, link.propertyId) : undefined, ...(link.descriptionAuto === true ? { descriptionAuto: true } : {}) }
        }
        u['paramLinks'] = links
      }
      if (meta?.pagination !== undefined) u['pagination'] = meta.pagination
      if (typeof meta?.cacheSeconds === 'number') u['cacheSeconds'] = meta.cacheSeconds
      if (meta?.idempotent === true) u['idempotent'] = true
      if (meta?.authOverride !== undefined) u['authOverride'] = meta.authOverride
      if (r.doc.deprecated === true) u['deprecated'] = true
      if (Object.keys(u).length > 2) await callTool('update_design_route', u)
    }
  }

  return designId
}

// ── canonicalisation (id-free, name-based, template-free) ─────────────

/** Strip `undefined` and empty objects, sort object keys, for a stable compare. */
function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean)
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const cv = clean((v as Record<string, unknown>)[k])
      const emptyObj = cv !== null && typeof cv === 'object' && !Array.isArray(cv) && Object.keys(cv).length === 0
      if (cv !== undefined && !emptyObj) out[k] = cv
    }
    return out
  }
  return v
}

const trueOrU = (b: boolean | undefined): true | undefined => (b === true ? true : undefined)

// Arrays have two equivalent encodings across build paths: MCP stores the
// element in the type (`array<Agency>`) and omits `arrayItems`; the GUI stores a
// bare `array` plus `arrayItems: { type: 'string' }` (the default) or an
// `isArrayOfRef` reference. Normalise both to a bare `array` type and drop the
// default `arrayItems` so a GUI reconstruction compares equal to the golden.
function normalizeType(type: unknown): unknown {
  return typeof type === 'string' ? type.replace(/<.*>$/, '') : type
}
function normalizeArrayItems(arrayItems: unknown): unknown {
  if (arrayItems !== null && typeof arrayItems === 'object') {
    const keys = Object.keys(arrayItems as Record<string, unknown>)
    if (keys.length === 1 && (arrayItems as { type?: unknown }).type === 'string') return undefined
  }
  return arrayItems
}

function canonicalProperty(g: ApiDesign, p: DesignProperty): Record<string, unknown> {
  const doc = p.doc
  const d = p.design
  const ref = d?.reference
  return {
    name: doc.name,
    type: normalizeType(doc.type),
    format: doc.format,
    required: trueOrU(doc.required),
    nullable: trueOrU(doc.nullable),
    readOnly: trueOrU(doc.readOnly),
    deprecated: trueOrU(doc.deprecated),
    description: doc.description,
    example: doc.example,
    isArrayOfRef: trueOrU(doc.isArrayOfRef),
    constraints: doc.constraints,
    reference: ref !== undefined
      ? { target: ref.target, ref: ref.target === 'enum' ? enumName(g, ref.refId) : modelName(g, ref.refId), onDelete: ref.onDelete }
      : undefined,
    arrayItems: normalizeArrayItems(d?.arrayItems),
    unique: trueOrU(d?.unique),
    searchable: trueOrU(d?.searchable),
    immutable: trueOrU(d?.immutable),
    writeOnly: trueOrU(d?.writeOnly),
    defaultValue: d?.defaultValue,
    pii: trueOrU(p.intents?.pii)
  }
}

function canonicalModel(g: ApiDesign, m: DesignModel): Record<string, unknown> {
  const id = m.design?.identifier
  return {
    name: m.doc.name,
    description: m.doc.description,
    inherits: m.design?.inheritsFrom !== undefined ? modelName(g, m.design.inheritsFrom) : undefined,
    volumetry: m.intents?.volumetry,
    timestamps: trueOrU(m.design?.timestamps),
    softDelete: trueOrU(m.design?.softDelete),
    identifier: id !== undefined ? { property: ownPropName(m, id.propertyId), strategy: id.strategy } : undefined,
    properties: m.properties.map((p) => canonicalProperty(g, p)),
    examples: (m.examples ?? []).map((ex) => ({
      name: ex.name,
      description: ex.description,
      values: Object.fromEntries(Object.entries(ex.values).map(([pid, val]) => [propNameInChain(g, m, pid), val]))
    }))
  }
}

function canonicalRoute(g: ApiDesign, r: DesignRoute): Record<string, unknown> {
  const meta = r.design
  const docResponses = r.doc.responses ?? {}
  const metaResponses = meta?.responses ?? {}
  const responses: Record<string, unknown> = {}
  for (const code of new Set([...Object.keys(docResponses), ...Object.keys(metaResponses)])) {
    const docR = docResponses[code]
    const metaR = metaResponses[code]
    const mm = metaR?.modelId !== undefined ? modelById(g, metaR.modelId) : undefined
    responses[code] = {
      description: docR?.description,
      model: mm?.doc.name,
      list: trueOrU(metaR?.list),
      paginated: trueOrU(metaR?.paginated),
      example: metaR?.exampleId !== undefined && mm !== undefined ? (mm.examples ?? []).find((e) => e.id === metaR.exampleId)?.name : undefined
    }
  }
  let paramLinks: Record<string, unknown> | undefined
  if (meta?.paramLinks !== undefined) {
    paramLinks = {}
    for (const [pn, link] of Object.entries(meta.paramLinks)) {
      const mm = modelById(g, link.modelId)
      paramLinks[pn] = { model: mm?.doc.name, property: mm !== undefined ? ownPropName(mm, link.propertyId) : undefined, descriptionAuto: trueOrU(link.descriptionAuto) }
    }
  }
  return {
    method: r.doc.match.method,
    path: r.doc.match.urlPattern,
    summary: r.doc.summary,
    description: r.doc.description,
    operationId: r.doc.operationId,
    deprecated: trueOrU(r.doc.deprecated),
    responses,
    body: meta?.body?.modelId !== undefined ? { model: modelById(g, meta.body.modelId)?.doc.name, contentType: meta.body.contentType } : undefined,
    paramLinks,
    pagination: meta?.pagination,
    cacheSeconds: typeof meta?.cacheSeconds === 'number' ? meta.cacheSeconds : undefined,
    idempotent: trueOrU(meta?.idempotent),
    authOverride: meta?.authOverride
  }
}

/**
 * A design reduced to a comparable, id-free, name-based shape: internal ids and
 * codegen templates are dropped, and every id cross-reference is rewritten to
 * the referenced entity's NAME. Applied to both the golden and the reconstruction.
 */
export function canonicalizeDesign(g: ApiDesign): unknown {
  const group = (grp: DesignRouteGroup): Record<string, unknown> => ({
    name: grp.doc.name,
    basePath: grp.design?.basePath,
    versionPrefix: grp.design?.versionPrefix,
    auth: grp.design?.auth,
    description: grp.doc.description,
    // Route order within a group is a UI convenience (drag-reorder), not design
    // semantics — a GUI reconstruction that generates routes gets a different
    // order than a hand-reordered golden. Sort both sides by method+path so the
    // comparison is order-independent.
    routes: grp.routes
      .map((r) => canonicalRoute(g, r))
      .sort((a, b) => `${String(a.method)} ${String(a.path)}`.localeCompare(`${String(b.method)} ${String(b.path)}`))
  })
  return clean({
    name: g.name,
    title: g.info.title,
    version: g.info.version,
    description: g.info.description,
    basePath: g.server?.basePath,
    defaultAuth: g.defaultAuth,
    protocols: g.serving?.protocols,
    enums: g.enums.map((e) => ({ name: e.doc.name, values: e.doc.enumValues, description: e.doc.description })),
    models: g.models.map((m) => canonicalModel(g, m)),
    groups: g.routeGroups.map(group)
  })
}
