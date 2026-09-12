/**
 * Resolves a {@link DesignIssue} — whose `path` is a chain of runtime ids into
 * an ephemeral {@link ApiDesign} — into a CONCRETE, human-readable identity of
 * the specific entity it is about: a real route ("GET /items/{id}"), a model /
 * enum / group name, or "Model.property".
 *
 * The background validation pass (main process) discards the ephemeral design
 * after validating, so it enriches every issue with this the moment it has the
 * design in hand — the renderer never sees the runtime ids, only the resolved
 * label (and, for a route, the method + pattern it needs to pull the route's
 * documentation slice).
 */
import type { ApiDesign } from '../types/apiDesign'
import type { DesignIssue } from './validateApiDesign'
import { composeRoutePath, groupChainBasePath } from './apiDesignDoc'

/**
 * A {@link DesignIssue} enriched for display: the raw issue plus the concrete
 * identity of the faulty entity, resolved against the (now discarded) design.
 * This is what crosses the IPC boundary and feeds the reusable issues list.
 */
export interface DesignIssueView extends DesignIssue {
  /** Concrete offender label — see {@link DesignIssueSubject.label}. */
  subjectLabel?: string
  /** Route locator for a route issue — see {@link DesignIssueSubject.route}. */
  route?: { method: string; pattern: string }
}

export interface DesignIssueSubject {
  /** Concrete identity of the faulty entity — e.g. "GET /items/{id}",
   * "User", or "User.email". Absent when the id no longer resolves. */
  label?: string
  /** Present only for a route issue: the HTTP method and the restorm-style
   * composed path pattern (e.g. `/items/{{id}}`) — enough for the UI to find
   * the operation and render its documentation slice. */
  route?: { method: string; pattern: string }
}

/** `/items/{{id}}` → `/items/{id}` for display. */
export function designPathForDisplay(pattern: string): string {
  return pattern.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '{$1}')
}

export function describeDesignIssue(design: ApiDesign, issue: DesignIssue): DesignIssueSubject {
  const id = issue.path[issue.path.length - 1]
  if (id === undefined) return {}

  // Route (path ends at a route id) — the richest case: method + composed path,
  // and the pattern the renderer matches back to the documentation operation.
  for (const group of design.routeGroups) {
    const route = group.routes.find((r) => r.id === id)
    if (route !== undefined) {
      const method = (route.doc.match.method ?? 'GET').toUpperCase()
      // Compose the SAME surface `validateApiDesign` keys collisions on: the
      // group base path, but NOT the design server base path. The renderer
      // matches this pattern back to the documentation operation, whose
      // `match.urlPattern` is the raw spec path with no server base — including
      // the base here would make every route offender fail to resolve its
      // operation (no expandable doc) whenever the spec declares a server path.
      const pattern = composeRoutePath(
        { groupBasePath: groupChainBasePath(design, group) },
        route.doc.match.urlPattern
      )
      return { label: `${method} ${designPathForDisplay(pattern)}`, route: { method, pattern } }
    }
    if (group.id === id) return { label: group.doc.name }
  }

  const model = design.models.find((m) => m.id === id)
  if (model !== undefined) return { label: model.doc.name }
  const enumEntity = design.enums.find((e) => e.id === id)
  if (enumEntity !== undefined) return { label: enumEntity.doc.name }

  // Property (path ends at a property id, parent is its model).
  const parentId = issue.path[issue.path.length - 2]
  const parentModel = design.models.find((m) => m.id === parentId)
  if (parentModel !== undefined) {
    const prop = parentModel.properties.find((p) => p.id === id)
    if (prop !== undefined) {
      const name = prop.doc.name !== '' ? prop.doc.name : '(unnamed)'
      return { label: `${parentModel.doc.name}.${name}` }
    }
  }
  return {}
}
