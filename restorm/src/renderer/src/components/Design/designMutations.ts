/**
 * The one mutation door of the Design tab: write a top-level design
 * section through the REACTIVE proxy — its set trap emits
 * `DESIGN_UPDATED` into the standard dirty / autosave pipeline. Every
 * design editing surface routes here; a mutation done any other way
 * (deep in-place write) would be stored silently and lost on close.
 */

import type { ApiDesign, DesignModel, DesignProperty, DesignRoute, DesignRouteGroup } from '../../../../shared/types/collections'
import type { TemplateVariableScope, TemplateVarValues } from '../../../../shared/design/templateVariables'
import type { DesignEntitySection } from '../../../../shared/design/designSections'
import { removeModelFromDesign, removeEnumFromDesign } from '../../../../shared/design/designUsages'

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

/** Delete a batch of model / enum / route(-group) entities in one pass, each
 * with the SAME pruning its single-delete path applies: a model drops its
 * inheritance/usages, an enum strips the references that pointed at it, a group
 * takes its whole sub-tree, a route leaves its group. Ids already gone (e.g. a
 * route whose group is also in the batch) are skipped. Powers multi-select
 * delete from the sidebar. */
export function deleteDesignEntities(design: ApiDesign, entries: readonly { section: DesignEntitySection; entityId: string }[]): void {
  for (const { section, entityId } of entries) {
    if (section === 'models') {
      if (!design.models.some((m) => m.id === entityId)) continue
      const next = removeModelFromDesign(design, entityId)
      assignDesignSection(design, 'models', next.models)
      assignDesignSection(design, 'routeGroups', next.routeGroups)
    } else if (section === 'enums') {
      if (!design.enums.some((e) => e.id === entityId)) continue
      const pruned = removeEnumFromDesign(design, entityId)
      assignDesignSection(design, 'enums', design.enums.filter((e) => e.id !== entityId))
      assignDesignSection(design, 'models', pruned.models)
      assignDesignSection(design, 'routeGroups', pruned.routeGroups)
    } else {
      const group = design.routeGroups.find((g) => g.id === entityId)
      if (group !== undefined) {
        // A group takes its descendant sub-groups (their dangling parentId would
        // orphan them otherwise).
        const doomed = new Set<string>([group.id])
        let grew = true
        while (grew) {
          grew = false
          for (const g of design.routeGroups) {
            if (g.parentId !== undefined && doomed.has(g.parentId) && !doomed.has(g.id)) { doomed.add(g.id); grew = true }
          }
        }
        assignDesignSection(design, 'routeGroups', design.routeGroups.filter((g) => !doomed.has(g.id)))
      } else {
        const owner = design.routeGroups.find((g) => g.routes.some((r) => r.id === entityId))
        if (owner !== undefined) replaceGroup(design, owner.id, { ...owner, routes: owner.routes.filter((r) => r.id !== entityId) })
      }
    }
  }
}

/** Rename a model / enum / route(-group) by id (the one door for the sidebar
 * node rename, the breadcrumb title rename, and any other rename surface). An
 * empty name is allowed — the label surfaces render it as a muted "<sans nom>"
 * placeholder — so clearing the field commits, it does not revert. */
export function renameDesignEntity(design: ApiDesign, section: 'models' | 'enums' | 'routes', entityId: string, newName: string): void {
  const trimmed = newName.trim()
  if (section === 'models') {
    const m = design.models.find((x) => x.id === entityId)
    if (m !== undefined) patchModel(design, entityId, { doc: { ...m.doc, name: trimmed } })
    return
  }
  if (section === 'enums') {
    assignDesignSection(design, 'enums', design.enums.map((e) => (e.id === entityId ? { ...e, doc: { ...e.doc, name: trimmed } } : e)))
    return
  }
  const group = design.routeGroups.find((g) => g.id === entityId)
  if (group !== undefined) {
    assignDesignSection(design, 'routeGroups', design.routeGroups.map((g) => (g.id === entityId ? { ...g, doc: { ...g.doc, name: trimmed } } : g)))
    return
  }
  const owner = design.routeGroups.find((g) => g.routes.some((r) => r.id === entityId))
  if (owner !== undefined) {
    replaceGroup(design, owner.id, { ...owner, routes: owner.routes.map((r) => (r.id === entityId ? { ...r, doc: { ...r.doc, summary: trimmed } } : r)) })
  }
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
