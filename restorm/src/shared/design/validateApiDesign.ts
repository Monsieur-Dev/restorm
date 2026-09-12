/**
 * Structural validation of an API design.
 *
 * Issues are DATA (stable codes + the IDs of the entities involved), not
 * messages: the Design tab renders them on the faulty row and in the
 * sidebar error indicator, and the design server / code generation
 * refuse to run a design that has any. Localization happens at render
 * time from the code.
 */

import type { ApiDesign, DesignModel } from '../types/apiDesign'
import { composeRoutePath, groupChainBasePath } from './apiDesignDoc'

export type DesignIssueCode =
  /** A property has an empty name. */
  | 'propertyNameEmpty'
  /** Two sibling properties spell the same name. */
  | 'propertyNameDuplicate'
  /** A property re-declares a name an inherited property already has. */
  | 'propertyShadowsParent'
  /** A model has an empty name. */
  | 'modelNameEmpty'
  /** An enum has an empty name. */
  | 'enumNameEmpty'
  /** A route group has an empty name. */
  | 'groupNameEmpty'
  /** Two models spell the same name (spec component names collide). */
  | 'modelNameDuplicate'
  /** Two enums spell the same name. */
  | 'enumNameDuplicate'
  /** A model and an enum share a name — they project into ONE spec
   * component namespace, so one would silently overwrite the other. */
  | 'componentNameCollision'
  /** Two route groups spell the same name (one would overwrite the
   * other in the projected `groups` / Swagger tags). */
  | 'groupNameDuplicate'
  /** `inheritsFrom` points at no model in this design. */
  | 'inheritanceTargetUnknown'
  /** Following `inheritsFrom` links returns to the starting model. */
  | 'inheritanceCycle'
  /** A property reference points at no model/enum in this design. */
  | 'referenceTargetUnknown'
  /** `identifier.propertyId` points at no property of the model. */
  | 'identifierPropertyUnknown'
  /** A route's parameter link points at no model/property. */
  | 'paramLinkTargetUnknown'
  | 'paramEnumRefUnknown'
  /** A route's body model points at no model in this design. */
  | 'bodyModelUnknown'
  /** A response's model points at no model in this design. */
  | 'responseModelUnknown'
  /** A response serves a named example its model does not declare. */
  | 'responseExampleUnknown'
  /** A property constraint pattern is not a valid regular expression. */
  | 'constraintPatternInvalid'
  /** A property's min bound exceeds its max (length or value). */
  | 'constraintMinAboveMax'
  /** A route declares no response at all. OpenAPI requires at least
   * one per operation — exporting would synthesize a 200 the design
   * never declared. */
  | 'routeResponsesMissing'
  /** Two routes resolve to the same METHOD + composed path (e.g. two
   * groups sharing a base path) — the exported `paths` map and the
   * served route table can only keep one. */
  | 'routePathDuplicate'
  /** A route's served path collides with a path the design server
   * reserves (`/swagger.json`, or an enabled projection's endpoint:
   * `/graphql`, `/soap`, `/odata`) — the route would never answer. */
  | 'routePathReserved'

export interface DesignIssue {
  code: DesignIssueCode
  /** ID path from the design root down to the faulty entity — enough
   * for the UI to focus the row and for the sidebar to mark the
   * sections on the way. */
  path: string[]
  /** The contested name/value, when one exists (duplicate names,
   * dangling reference IDs). */
  subject?: string
  /** For a NAME/PATH collision: the entity IDs of the OTHER members of the
   * same collision group (same component name, same route surface). Every
   * member of the group carries an issue — each listing the others — so the
   * sidebar marks all of them and the editor can render a clickable "collides
   * with" list without recomputing. Absent for non-collision issues. */
  collisionWith?: string[]
}

/** Group items by a string key, preserving first-seen order of the groups. */
function groupByKey<T>(items: readonly T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const bucket = groups.get(k)
    if (bucket !== undefined) bucket.push(item)
    else groups.set(k, [item])
  }
  return [...groups.values()]
}

/** `true` when the design has no blocking issues — the gate the design
 * server and the code generators consult before running. */
export function isDesignValid(design: ApiDesign): boolean {
  return validateApiDesign(design).length === 0
}

// Per-design cache for the render-hot paths (the sidebar rebuild validates once
// in the tree builder and again for each section, plus the section-root
// listing). Every mutation goes through `assignDesignSection`, which REPLACES
// the relevant top-level array, so the three array identities are a sound cache
// key: if none changed, the validation result is unchanged. Kept out of
// `validateApiDesign` itself so the server / codegen callers stay purely
// functional. WeakMap → no leak when a design closes.
const validationCache = new WeakMap<ApiDesign, { models: unknown; enums: unknown; routeGroups: unknown; issues: DesignIssue[] }>()

/** Memoized {@link validateApiDesign} for hot UI paths — see the cache note. */
export function validateApiDesignCached(design: ApiDesign): DesignIssue[] {
  const cached = validationCache.get(design)
  if (cached !== undefined) {
    if (cached.models === design.models && cached.enums === design.enums && cached.routeGroups === design.routeGroups) return cached.issues
  }
  const issues = validateApiDesign(design)
  validationCache.set(design, { models: design.models, enums: design.enums, routeGroups: design.routeGroups, issues })
  return issues
}

export function validateApiDesign(design: ApiDesign): DesignIssue[] {
  const issues: DesignIssue[] = []
  const modelById = new Map(design.models.map((m) => [m.id, m]))
  const enumIds = new Set(design.enums.map((e) => e.id))

  // Models and enums share ONE component namespace (both project under the
  // spec's model names). Every member of a same-name group is flagged (not just
  // the trailing ones), each carrying the others' ids: a same-kind group keeps
  // its specific duplicate code, a cross-kind group (a model AND an enum share a
  // name — one would silently overwrite the other) gets `componentNameCollision`.
  const componentEntries: { id: string; name: string; kind: 'model' | 'enum' }[] = [
    ...design.models.map((m) => ({ id: m.id, name: m.doc.name, kind: 'model' as const })),
    ...design.enums.map((e) => ({ id: e.id, name: e.doc.name, kind: 'enum' as const }))
  ]
  for (const entry of componentEntries) {
    if (entry.name === '') {
      issues.push({ code: entry.kind === 'model' ? 'modelNameEmpty' : 'enumNameEmpty', path: [design.id, entry.id] })
    }
  }
  for (const group of groupByKey(componentEntries.filter((e) => e.name !== ''), (e) => e.name)) {
    if (group.length < 2) continue
    const mixed = group.some((e) => e.kind === 'model') && group.some((e) => e.kind === 'enum')
    for (const entry of group) {
      issues.push({
        code: mixed ? 'componentNameCollision' : (entry.kind === 'model' ? 'modelNameDuplicate' : 'enumNameDuplicate'),
        path: [design.id, entry.id],
        subject: entry.name,
        collisionWith: group.filter((o) => o.id !== entry.id).map((o) => o.id)
      })
    }
  }

  for (const group of design.routeGroups) {
    if (group.doc.name === '') issues.push({ code: 'groupNameEmpty', path: [design.id, group.id] })
  }
  for (const named of groupByKey(design.routeGroups.filter((g) => g.doc.name !== ''), (g) => g.doc.name)) {
    if (named.length < 2) continue
    for (const group of named) {
      issues.push({
        code: 'groupNameDuplicate',
        path: [design.id, group.id],
        subject: group.doc.name,
        collisionWith: named.filter((o) => o.id !== group.id).map((o) => o.id)
      })
    }
  }

  for (const model of design.models) {
    const path = [design.id, model.id]

    const parent = model.design?.inheritsFrom
    if (parent !== undefined && !modelById.has(parent)) {
      issues.push({ code: 'inheritanceTargetUnknown', path, subject: parent })
    }
    if (parent !== undefined && detectInheritanceCycle(model, modelById)) {
      issues.push({ code: 'inheritanceCycle', path })
    }

    const inheritedNames = inheritedPropertyNames(model, modelById)
    const seenNames = new Set<string>()
    for (const property of model.properties) {
      const propertyPath = [...path, property.id]
      const name = property.doc.name
      if (name === '') {
        issues.push({ code: 'propertyNameEmpty', path: propertyPath })
      } else if (seenNames.has(name)) {
        issues.push({ code: 'propertyNameDuplicate', path: propertyPath, subject: name })
      } else if (inheritedNames.has(name)) {
        issues.push({ code: 'propertyShadowsParent', path: propertyPath, subject: name })
      }
      seenNames.add(name)

      const reference = property.design?.reference
      if (reference !== undefined) {
        const known = reference.target === 'model' ? modelById.has(reference.refId) : enumIds.has(reference.refId)
        if (!known) {
          issues.push({ code: 'referenceTargetUnknown', path: propertyPath, subject: reference.refId })
        }
      }

      const constraints = property.doc.constraints
      if (constraints !== undefined) {
        if (typeof constraints.pattern === 'string' && constraints.pattern !== '') {
          try {
            new RegExp(constraints.pattern)
          } catch {
            issues.push({ code: 'constraintPatternInvalid', path: propertyPath, subject: constraints.pattern })
          }
        }
        const lengthInverted = typeof constraints.minLength === 'number' && typeof constraints.maxLength === 'number' &&
          constraints.minLength > constraints.maxLength
        const valueInverted = typeof constraints.minimum === 'number' && typeof constraints.maximum === 'number' &&
          constraints.minimum > constraints.maximum
        if (lengthInverted || valueInverted) {
          issues.push({ code: 'constraintMinAboveMax', path: propertyPath, subject: name })
        }
      }
    }

    const identifier = model.design?.identifier
    if (identifier !== undefined && !model.properties.some((p) => p.id === identifier.propertyId)) {
      issues.push({ code: 'identifierPropertyUnknown', path, subject: identifier.propertyId })
    }
  }

  // One HTTP surface per METHOD + composed path across ALL groups: the
  // exported `paths[path][method]` and the served route table both key on it,
  // and would silently drop the second claimant. The design base path is
  // omitted — it prefixes every route equally. Parameter names are NOT part of
  // the surface (`/u/{{id}}` and `/u/{{userId}}` are the same templated path,
  // which OpenAPI forbids), so they normalize to a fixed token. Every route in
  // a colliding surface group is flagged (each listing the others), so all get
  // the sidebar mark + the editor's twin list — not just the trailing claimant.
  const routeSurfaceEntries = design.routeGroups.flatMap((group) =>
    group.routes.map((route) => ({
      id: route.id,
      groupId: group.id,
      surface: `${route.doc.match.method ?? 'GET'} ${composeRoutePath({ groupBasePath: groupChainBasePath(design, group) }, route.doc.match.urlPattern).replace(/\{\{[^{}]*\}\}/g, '{*}')}`
    }))
  )
  for (const surfaceGroup of groupByKey(routeSurfaceEntries, (r) => r.surface)) {
    if (surfaceGroup.length < 2) continue
    for (const entry of surfaceGroup) {
      issues.push({
        code: 'routePathDuplicate',
        path: [design.id, entry.groupId, entry.id],
        subject: entry.surface,
        collisionWith: surfaceGroup.filter((o) => o.id !== entry.id).map((o) => o.id)
      })
    }
  }

  for (const group of design.routeGroups) {
    for (const route of group.routes) {
      const path = [design.id, group.id, route.id]

      if (Object.keys(route.doc.responses ?? {}).length === 0) {
        issues.push({ code: 'routeResponsesMissing', path })
      }

      // The design server owns some paths on the port: the descriptor
      // (`{basePath}/swagger.json`, with the root `/swagger.json` kept as a
      // discovery alias) always, each projection's endpoint when enabled. A
      // route that composes onto one of them (WITH the design base path — the
      // served table binds full paths) would be shadowed by the dispatcher
      // and never answer.
      const served = composeRoutePath({
        ...(design.server?.basePath !== undefined ? { designBasePath: design.server.basePath } : {}),
        groupBasePath: groupChainBasePath(design, group)
      }, route.doc.match.urlPattern)
      const swaggerUnderBase = composeRoutePath({
        ...(design.server?.basePath !== undefined ? { designBasePath: design.server.basePath } : {})
      }, 'swagger.json')
      const protocols = design.serving?.protocols ?? []
      const reserved =
        served === '/swagger.json' ||
        served === swaggerUnderBase ||
        (protocols.includes('graphql') && served === '/graphql') ||
        (protocols.includes('soap') && served === '/soap') ||
        (protocols.includes('odata') && (served === '/odata' || served.startsWith('/odata/')))
      if (reserved) {
        issues.push({ code: 'routePathReserved', path, subject: served })
      }

      for (const [paramName, link] of Object.entries(route.design?.paramLinks ?? {})) {
        const model = modelById.get(link.modelId)
        const property = model?.properties.find((p) => p.id === link.propertyId)
        if (model === undefined || property === undefined) {
          issues.push({ code: 'paramLinkTargetUnknown', path, subject: paramName })
        }
      }

      for (const [paramName, enumId] of Object.entries(route.design?.paramEnumRefs ?? {})) {
        if (!enumIds.has(enumId)) {
          issues.push({ code: 'paramEnumRefUnknown', path, subject: paramName })
        }
      }

      const bodyModelId = route.design?.body?.modelId
      if (bodyModelId !== undefined && !modelById.has(bodyModelId)) {
        issues.push({ code: 'bodyModelUnknown', path, subject: bodyModelId })
      }

      for (const [code, response] of Object.entries(route.design?.responses ?? {})) {
        const model = response.modelId !== undefined ? modelById.get(response.modelId) : undefined
        if (response.modelId !== undefined && model === undefined) {
          issues.push({ code: 'responseModelUnknown', path, subject: code })
          continue
        }
        if (response.exampleId !== undefined) {
          const examples = model?.examples ?? []
          if (!examples.some((e) => e.id === response.exampleId)) {
            issues.push({ code: 'responseExampleUnknown', path, subject: code })
          }
        }
      }
    }
  }

  return issues
}

/** Property names visible on a model through its inheritance chain
 * (cycle-tolerant: a cycle is reported separately, the name walk just
 * stops instead of spinning). */
function inheritedPropertyNames(model: DesignModel, modelById: Map<string, DesignModel>): Set<string> {
  const names = new Set<string>()
  const visited = new Set<string>([model.id])
  let parentId = model.design?.inheritsFrom
  while (parentId !== undefined && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = modelById.get(parentId)
    if (parent === undefined) break
    for (const property of parent.properties) names.add(property.doc.name)
    parentId = parent.design?.inheritsFrom
  }
  return names
}

function detectInheritanceCycle(model: DesignModel, modelById: Map<string, DesignModel>): boolean {
  const visited = new Set<string>([model.id])
  let parentId = model.design?.inheritsFrom
  while (parentId !== undefined) {
    if (visited.has(parentId)) return true
    visited.add(parentId)
    parentId = modelById.get(parentId)?.design?.inheritsFrom
  }
  return false
}
