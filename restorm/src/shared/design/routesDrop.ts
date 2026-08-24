/**
 * Pure drag-&-drop transforms for the Routes tree (groups + routes).
 *
 * The Routes section lets the user reorder route groups and routes, nest a
 * group under another (sub-groups, `parentId`), and move a route between
 * groups — all by dragging. The ECUI ListView reports a drop as a
 * `(source, target, position)` triple; these helpers turn that triple into a
 * validity check and a fresh `routeGroups` array, with NO React or reactive
 * proxy involved so the logic is unit-testable in isolation.
 *
 * `into` reparents (a group under the target group) / moves (a route into the
 * target group); `before`/`after` reorders among siblings. Cycle-, self- and
 * orphan-guarded — a group can never become its own descendant.
 */

import type { DesignRoute, DesignRouteGroup } from '../types/apiDesign'

export type RoutesDropPosition = 'before' | 'after' | 'into'

export interface RoutesDropRequest {
  sourceId: string
  targetId: string
  position: RoutesDropPosition
}

const findGroup = (groups: readonly DesignRouteGroup[], id: string): DesignRouteGroup | undefined =>
  groups.find((g) => g.id === id)

const findRouteWithGroup = (
  groups: readonly DesignRouteGroup[],
  id: string
): { group: DesignRouteGroup; route: DesignRoute } | undefined => {
  for (const group of groups) {
    const route = group.routes.find((r) => r.id === id)
    if (route !== undefined) return { group, route }
  }
  return undefined
}

/** Is `candidateId` the group `ancestorId` itself or one of its descendants? */
const isSelfOrDescendant = (groups: readonly DesignRouteGroup[], candidateId: string, ancestorId: string): boolean => {
  let current = findGroup(groups, candidateId)
  const seen = new Set<string>()
  while (current !== undefined && !seen.has(current.id)) {
    if (current.id === ancestorId) return true
    seen.add(current.id)
    current = current.parentId !== undefined ? findGroup(groups, current.parentId) : undefined
  }
  return false
}

/** A copy of the group with no `parentId` — a group promoted back to a root. */
const dropParentId = (group: DesignRouteGroup): DesignRouteGroup => {
  const { parentId: _dropped, ...rest } = group
  return rest
}

/**
 * Whether a drop is allowed — the drag-over guard AND the final drop guard both
 * consult this. A group nests INTO another (never itself or a descendant) or
 * reorders BEFORE/AFTER a sibling; a route moves INTO a group or reorders
 * BEFORE/AFTER another route.
 */
export function canRoutesDrop(groups: readonly DesignRouteGroup[], req: RoutesDropRequest): boolean {
  const { sourceId, targetId, position } = req
  const srcGroup = findGroup(groups, sourceId)
  const tgtGroup = findGroup(groups, targetId)
  if (srcGroup !== undefined) {
    if (position === 'into') return tgtGroup !== undefined && !isSelfOrDescendant(groups, tgtGroup.id, srcGroup.id)
    if (tgtGroup === undefined || tgtGroup.id === srcGroup.id) return false
    return tgtGroup.parentId === undefined || !isSelfOrDescendant(groups, tgtGroup.parentId, srcGroup.id)
  }
  if (findRouteWithGroup(groups, sourceId) !== undefined) {
    return position === 'into' ? tgtGroup !== undefined : findRouteWithGroup(groups, targetId) !== undefined
  }
  return false
}

/**
 * Apply a drop, returning a fresh `routeGroups` array — or `null` when the drop
 * is invalid (mirrors {@link canRoutesDrop}) so the caller writes nothing. Never
 * mutates its input.
 */
export function applyRoutesDrop(
  groups: readonly DesignRouteGroup[],
  req: RoutesDropRequest
): DesignRouteGroup[] | null {
  const { sourceId, targetId, position } = req

  const srcGroup = findGroup(groups, sourceId)
  if (srcGroup !== undefined) {
    const rest = groups.filter((g) => g.id !== srcGroup.id)
    let moved: DesignRouteGroup
    let insertAt: number
    if (position === 'into') {
      const tgt = findGroup(groups, targetId)
      if (tgt === undefined || isSelfOrDescendant(groups, tgt.id, srcGroup.id)) return null
      moved = { ...srcGroup, parentId: tgt.id }
      insertAt = rest.length
    } else {
      const tgt = findGroup(groups, targetId)
      const ti = rest.findIndex((g) => g.id === targetId)
      if (tgt === undefined || ti < 0) return null
      moved = tgt.parentId !== undefined ? { ...srcGroup, parentId: tgt.parentId } : dropParentId(srcGroup)
      insertAt = position === 'before' ? ti : ti + 1
    }
    const next = [...rest]
    next.splice(insertAt, 0, moved)
    return next
  }

  const srcRW = findRouteWithGroup(groups, sourceId)
  if (srcRW === undefined) return null
  let targetGroupId: string
  let anchorRouteId: string | null // insert BEFORE this route, null = append
  if (position === 'into') {
    const tgt = findGroup(groups, targetId)
    if (tgt === undefined) return null
    targetGroupId = tgt.id
    anchorRouteId = null
  } else {
    const tw = findRouteWithGroup(groups, targetId)
    if (tw === undefined) return null
    targetGroupId = tw.group.id
    if (position === 'before') anchorRouteId = targetId
    else {
      const idx = tw.group.routes.findIndex((r) => r.id === targetId)
      anchorRouteId = tw.group.routes[idx + 1]?.id ?? null
    }
  }
  const route = srcRW.route
  return groups.map((group) => {
    let routes = group.id === srcRW.group.id ? group.routes.filter((r) => r.id !== sourceId) : group.routes
    if (group.id === targetGroupId) {
      const arr = [...routes]
      const at = anchorRouteId === null ? arr.length : arr.findIndex((r) => r.id === anchorRouteId)
      arr.splice(at < 0 ? arr.length : at, 0, route)
      routes = arr
    }
    return routes === group.routes ? group : { ...group, routes }
  })
}
