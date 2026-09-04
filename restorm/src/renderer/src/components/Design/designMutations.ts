/**
 * The one mutation door of the Design tab: write a top-level design
 * section through the REACTIVE proxy — its set trap emits
 * `DESIGN_UPDATED` into the standard dirty / autosave pipeline. Every
 * design editing surface routes here; a mutation done any other way
 * (deep in-place write) would be stored silently and lost on close.
 */

import type { ApiDesign, DesignModel, DesignProperty, DesignRoute, DesignRouteGroup } from '../../../../shared/types/collections'
import type { TemplateVariableScope, TemplateVarValues } from '../../../../shared/design/templateVariables'

export function assignDesignSection<K extends keyof ApiDesign>(design: ApiDesign, key: K, value: ApiDesign[K]): void {
  design[key] = value
}

/**
 * Find an existing enum whose values match `values` exactly (same length, same
 * order, string-compared), or mint a new named enum seeded from `seed`. Shared
 * by "Extract to a named enum" on both a model property and a route parameter —
 * the dedup is what keeps a repeated extraction from minting duplicate enums.
 * Returns the target enum's id and whether it was newly created.
 */
export function findOrCreateEnumForValues(
  design: ApiDesign,
  values: unknown[],
  seed: string,
  generateId: () => string
): { refId: string; created: boolean } {
  const sameValues = (a: unknown[], b: unknown[]): boolean =>
    a.length === b.length && a.every((v, i) => String(v) === String(b[i]))
  const existing = design.enums.find((e) => sameValues(e.doc.enumValues ?? [], values))
  if (existing !== undefined) return { refId: existing.id, created: false }
  const refId = generateId()
  const name = uniqueComponentName(design, seed !== '' ? seed : 'Enum')
  assignDesignSection(design, 'enums', [...design.enums, { id: refId, doc: { name, properties: [], enumValues: values } }])
  return { refId, created: true }
}

/** Replace one model (by id) in the design's `models` array. */
export function replaceModel(design: ApiDesign, modelId: string, next: DesignModel): void {
  assignDesignSection(design, 'models', design.models.map((m) => (m.id === modelId ? next : m)))
}

/** Patch one model (by id) — shallow merge of top-level model fields. */
export function patchModel(design: ApiDesign, modelId: string, patch: Partial<DesignModel>): void {
  assignDesignSection(design, 'models', design.models.map((m) => (m.id === modelId ? { ...m, ...patch } : m)))
}

/** Replace one property (by id) inside its model's `properties` array. */
export function replaceProperty(design: ApiDesign, modelId: string, propertyId: string, next: DesignProperty): void {
  assignDesignSection(design, 'models', design.models.map((m) => (
    m.id === modelId ? { ...m, properties: m.properties.map((p) => (p.id === propertyId ? next : p)) } : m
  )))
}

/** Replace one route group (by id) in the design's `routeGroups`. */
export function replaceGroup(design: ApiDesign, groupId: string, next: DesignRouteGroup): void {
  assignDesignSection(design, 'routeGroups', design.routeGroups.map((g) => (g.id === groupId ? next : g)))
}

/** Replace one route (by id) inside its group. */
export function replaceRoute(design: ApiDesign, groupId: string, routeId: string, next: DesignRoute): void {
  assignDesignSection(design, 'routeGroups', design.routeGroups.map((g) => (
    g.id === groupId ? { ...g, routes: g.routes.map((r) => (r.id === routeId ? next : r)) } : g
  )))
}

/**
 * Set a template's GLOBAL variable values for one scope (the "Variables
 * générales" master-detail): `design.codegen.templates[id].variables[scope]`.
 * Empty scopes are pruned, and an empty `variables` object is dropped entirely,
 * so the persisted design stays free of `{}` cruft.
 */
export function setTemplateScopeVariables(
  design: ApiDesign,
  templateId: string,
  scope: TemplateVariableScope,
  values: Record<string, string>
): void {
  const templates = (design.codegen?.templates ?? []).map((template) => {
    if (template.id !== templateId) return template
    const nextVars: TemplateVarValues = {}
    for (const s of ['project', 'model', 'property', 'route'] as const) {
      const v = s === scope ? values : template.variables?.[s]
      if (v !== undefined && Object.keys(v).length > 0) nextVars[s] = v
    }
    const { variables: _dropped, ...rest } = template
    return Object.keys(nextVars).length > 0 ? { ...rest, variables: nextVars } : rest
  })
  assignDesignSection(design, 'codegen', { ...design.codegen, templates })
}

/** A name of the form `base`, `base2`, `base3`… unused by any model or
 * enum (they share the spec's component namespace). */
export function uniqueComponentName(design: ApiDesign, base: string): string {
  const taken = new Set<string>([
    ...design.models.map((m) => m.doc.name),
    ...design.enums.map((e) => e.doc.name)
  ])
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`
    if (!taken.has(candidate)) return candidate
  }
}
