/**
 * The one mutation door of the Design tab: write a top-level design
 * section through the REACTIVE proxy — its set trap emits
 * `DESIGN_UPDATED` into the standard dirty / autosave pipeline. Every
 * design editing surface routes here; a mutation done any other way
 * (deep in-place write) would be stored silently and lost on close.
 */

import type { ApiDesign, DesignModel, DesignRoute, DesignRouteGroup } from '../../../../shared/types/collections'
import type { TemplateVariableScope, TemplateVarValues } from '../../../../shared/design/templateVariables'

export function assignDesignSection<K extends keyof ApiDesign>(design: ApiDesign, key: K, value: ApiDesign[K]): void {
  design[key] = value
}

/** Replace one model (by id) in the design's `models` array. */
export function replaceModel(design: ApiDesign, modelId: string, next: DesignModel): void {
  assignDesignSection(design, 'models', design.models.map((m) => (m.id === modelId ? next : m)))
}

/** Patch one model (by id) — shallow merge of top-level model fields. */
export function patchModel(design: ApiDesign, modelId: string, patch: Partial<DesignModel>): void {
  assignDesignSection(design, 'models', design.models.map((m) => (m.id === modelId ? { ...m, ...patch } : m)))
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
    for (const s of ['project', 'model', 'route'] as const) {
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
