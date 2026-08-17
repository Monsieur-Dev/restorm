/**
 * The pure half of the design server: route compilation + matching,
 * effective auth, served instance construction (named examples first,
 * seeded faker for the rest), the pagination envelope and the inbound
 * body validation. The main-side `DesignServerService` is a thin HTTP
 * shell around these — everything here is deterministic and unit-tested,
 * and the doc projection (`designToApiDocumentation`) stays the single
 * source the served `/swagger.json` derives from.
 */

import type {
  ApiDesign,
  DesignAuthKind,
  DesignModel,
  DesignRoute,
  DesignRouteGroup
} from '../types/apiDesign'
import { composeRoutePath } from './apiDesignDoc'
import { resolveExampleValue, violatedConstraint } from './designExampleValues'

// ── Route table ───────────────────────────────────────────────────────

export interface CompiledRoute {
  group: DesignRouteGroup
  route: DesignRoute
  method: string
  /** Composed full pattern, `{{param}}` spelling. */
  pattern: string
  /** Pattern split into literal / param segments. */
  segments: { literal?: string; param?: string }[]
}

/** Compile every route of the design into a matchable table. */
export function compileDesignRoutes(design: ApiDesign): CompiledRoute[] {
  const compiled: CompiledRoute[] = []
  for (const group of design.routeGroups) {
    for (const route of group.routes) {
      const pattern = composeRoutePath({
        ...(design.server?.basePath !== undefined ? { designBasePath: design.server.basePath } : {}),
        ...(group.design?.versionPrefix !== undefined ? { versionPrefix: group.design.versionPrefix } : {}),
        ...(group.design?.basePath !== undefined ? { groupBasePath: group.design.basePath } : {})
      }, route.doc.match.urlPattern)
      const segments = pattern
        .split('/')
        .filter((s) => s !== '')
        .map((segment) => {
          const param = /^\{\{(.+)\}\}$/.exec(segment)
          return param?.[1] !== undefined ? { param: param[1] } : { literal: segment }
        })
      compiled.push({ group, route, method: route.doc.match.method ?? 'GET', pattern, segments })
    }
  }
  return compiled
}

export interface RouteMatch {
  entry: CompiledRoute
  params: Record<string, string>
}

/** Match an inbound method+path against the compiled table. Exact
 * literal segments win over parameter segments when both match. */
export function matchDesignRoute(table: CompiledRoute[], method: string, path: string): RouteMatch | null {
  const parts = path.split('/').filter((s) => s !== '')
  let best: RouteMatch | null = null
  let bestLiterals = -1
  for (const entry of table) {
    if (entry.method !== method.toUpperCase()) continue
    if (entry.segments.length !== parts.length) continue
    const params: Record<string, string> = {}
    let literals = 0
    let ok = true
    for (let i = 0; i < parts.length; i++) {
      const segment = entry.segments[i]
      const part = parts[i]
      if (segment === undefined || part === undefined) { ok = false; break }
      if (segment.literal !== undefined) {
        if (segment.literal !== part) { ok = false; break }
        literals += 1
      } else if (segment.param !== undefined) {
        params[segment.param] = decodeURIComponent(part)
      }
    }
    if (ok && literals > bestLiterals) {
      best = { entry, params }
      bestLiterals = literals
    }
  }
  return best
}

// ── Auth ──────────────────────────────────────────────────────────────

/** The auth contract a route actually enforces: its own override, else
 * the group's, else the design default, else none. */
export function effectiveAuth(design: ApiDesign, group: DesignRouteGroup, route: DesignRoute): DesignAuthKind {
  return route.design?.authOverride ?? group.design?.auth ?? design.defaultAuth ?? 'none'
}

/** The header an apiKeyHeader contract reads — the first apiKey scheme's
 * declared header name, `X-API-Key` when the design declares none. */
export function apiKeyHeaderName(design: ApiDesign): string {
  for (const scheme of Object.values(design.securitySchemes ?? {})) {
    if (scheme.type === 'apiKey' && scheme.in === 'header' && typeof scheme.name === 'string' && scheme.name !== '') {
      return scheme.name
    }
  }
  return 'X-API-Key'
}

/**
 * PRESENCE check (Yoann, 2026-08-16): the served design requires a
 * credential of the right SHAPE but accepts any non-empty value —
 * 401 only when absent or malformed.
 */
export function authSatisfied(kind: DesignAuthKind, headers: Record<string, string | string[] | undefined>, design: ApiDesign): boolean {
  if (kind === 'none') return true
  const header = (name: string): string => {
    const raw = headers[name.toLowerCase()] ?? headers[name]
    if (Array.isArray(raw)) return raw[0] ?? ''
    return raw ?? ''
  }
  // RFC 7235: the auth-scheme token is case-insensitive — a client
  // sending `bearer abc` carries a present credential.
  if (kind === 'bearer') return /^Bearer\s+\S+/i.test(header('authorization'))
  if (kind === 'basic') return /^Basic\s+\S+/i.test(header('authorization'))
  return header(apiKeyHeaderName(design)).trim() !== ''
}

// ── Served instances ──────────────────────────────────────────────────

/** Model properties in serving order: inherited chain first (root
 * ancestor first), then own — an instance carries them all. */
export function servedProperties(design: ApiDesign, model: DesignModel): { owner: DesignModel; property: DesignModel['properties'][number] }[] {
  const chain: DesignModel[] = []
  const visited = new Set<string>()
  let current: DesignModel | undefined = model
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id)
    chain.unshift(current)
    const parentId: string | undefined = current.design?.inheritsFrom
    current = parentId === undefined ? undefined : design.models.find((m) => m.id === parentId)
  }
  return chain.flatMap((owner) => owner.properties.map((property) => ({ owner, property })))
}

/**
 * One served instance of a model. `exampleId` picks a NAMED example
 * (its defined values win, the rest seed); otherwise `seedKey`
 * disambiguates instances (list index, default) so every generated
 * object is reproducible.
 */
export function buildModelInstance(design: ApiDesign, model: DesignModel, options: { exampleId?: string; seedKey: string }): Record<string, unknown> {
  const example = options.exampleId !== undefined
    ? (model.examples ?? []).find((e) => e.id === options.exampleId)
    : undefined
  const virtual = example ?? { id: options.seedKey, values: {} }
  const instance: Record<string, unknown> = {}
  for (const { property } of servedProperties(design, model)) {
    const name = property.doc.name
    if (name === '') continue
    // A property typed by another MODEL nests one level of that model
    // (seeded off this property) — deeper nesting stays flat to keep
    // recursive shapes (Pet.friends: Pet) from looping.
    const reference = property.design?.reference
    if (reference?.target === 'model' && property.doc.isArrayOfRef !== true) {
      const target = design.models.find((m) => m.id === reference.refId)
      if (target !== undefined && target.id !== model.id) {
        instance[name] = shallowInstance(design, target, `${options.seedKey}/${property.id}`)
        continue
      }
    }
    const resolved = property.doc.example !== undefined && example === undefined
      ? { value: property.doc.example }
      : resolveExampleValue(design, model, virtual, property)
    instance[name] = resolved.value
  }
  return instance
}

/** One nesting level only — every property from its own doc/seed. */
function shallowInstance(design: ApiDesign, model: DesignModel, seedKey: string): Record<string, unknown> {
  const instance: Record<string, unknown> = {}
  for (const { property } of servedProperties(design, model)) {
    if (property.doc.name === '') continue
    if (property.design?.reference?.target === 'model') continue
    const resolved = property.doc.example !== undefined
      ? { value: property.doc.example }
      : resolveExampleValue(design, model, { id: seedKey, values: {} }, property)
    instance[property.doc.name] = resolved.value
  }
  return instance
}

// ── Pagination ────────────────────────────────────────────────────────

/** The volumetry intent → the TOTAL the served list envelope reports.
 * Items are generated per page only; the total is the declared scale. */
export function servedTotal(model: DesignModel): number {
  switch (model.intents?.volumetry) {
    case 'hundreds': return 100
    case 'tenThousands': return 10_000
    case 'millions': return 1_000_000
    default: return 25
  }
}

export interface ServedPage {
  items: Record<string, unknown>[]
  total: number
  limit: number
  offset: number
}

/** The clamped `{limit, offset}` for a list route: the request's values
 * bounded by the route's pagination (`defaultLimit`/`maxLimit`). Shared
 * by the stateless {@link buildListPage} and the stateful store so both
 * honour the same envelope and ceilings. */
export function resolvePageWindow(
  route: DesignRoute,
  query: { offset?: string; limit?: string }
): { limit: number; offset: number } {
  const pagination = route.design?.pagination
  const defaultLimit = pagination?.defaultLimit ?? 20
  const maxLimit = pagination?.maxLimit ?? 100
  const requestedLimit = Number(query.limit ?? defaultLimit)
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : defaultLimit, maxLimit))
  const requestedOffset = Number(query.offset ?? 0)
  const offset = Math.max(0, Number.isFinite(requestedOffset) ? requestedOffset : 0)
  return { limit, offset }
}

/** A page of served instances: named examples first (in order), then
 * seeded instances up to the page size. */
export function buildListPage(
  design: ApiDesign,
  model: DesignModel,
  route: DesignRoute,
  query: { offset?: string; limit?: string }
): ServedPage {
  const { limit, offset } = resolvePageWindow(route, query)
  const total = Math.max(servedTotal(model), (model.examples ?? []).length)

  const items: Record<string, unknown>[] = []
  const examples = model.examples ?? []
  for (let i = offset; i < Math.min(offset + limit, total); i++) {
    const named = examples[i]
    items.push(named !== undefined
      ? buildModelInstance(design, model, { exampleId: named.id, seedKey: `list:${i}` })
      : buildModelInstance(design, model, { seedKey: `list:${i}` }))
  }
  return { items, total, limit, offset }
}

// ── Inbound body validation ───────────────────────────────────────────

export interface ServedBodyIssue {
  property: string
  code: 'required' | 'constraint' | 'notAnObject'
  detail?: string
}

/** Validate an inbound JSON body against the route's body model:
 * required properties present, defined values within constraints. */
export function validateBodyAgainstModel(design: ApiDesign, model: DesignModel, body: unknown): ServedBodyIssue[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return [{ property: '', code: 'notAnObject' }]
  }
  const record = body as Record<string, unknown>
  const issues: ServedBodyIssue[] = []
  for (const { property } of servedProperties(design, model)) {
    const name = property.doc.name
    if (name === '') continue
    const value = record[name]
    if (value === undefined) {
      if (property.doc.required && property.doc.readOnly !== true) {
        issues.push({ property: name, code: 'required' })
      }
      continue
    }
    const violated = violatedConstraint(property, value)
    if (violated !== null) {
      issues.push({ property: name, code: 'constraint', detail: violated })
    }
  }
  return issues
}

// ── Response selection ────────────────────────────────────────────────

/** The status code a route serves by default: its lowest declared 2xx,
 * else 200. */
export function defaultResponseCode(route: DesignRoute): string {
  const codes = Object.keys(route.doc.responses ?? {})
    .filter((code) => code.startsWith('2'))
    .sort()
  return codes[0] ?? '200'
}
